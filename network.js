/*jslint node: true */
"use strict";
var WebSocket = process.browser ? global.WebSocket : require('ws');
var _ = require('lodash');
var async = require('async');
var db = require('./db.js');
var storage = require('./storage.js');
var joint_storage = require('./joint_storage.js');
var validation = require('./validation.js');
var ValidationUtils = require("./validation_utils.js");
var conf = require('./conf.js');
var mutex = require('./mutex.js');
var catchup = require('./catchup.js');
var privatePayment = require('./private_payment.js');
var objectHash = require('./object_hash.js');
var eventBus = require('./event_bus.js');
var light = require('./light.js');
var device = require('./device.js');
var breadcrumbs = require('./breadcrumbs.js');
var hashnethelper = require('./hashnethelper');
var FORWARDING_TIMEOUT = 10 * 1000; // don't forward if the joint was received more than FORWARDING_TIMEOUT ms ago
var STALLED_TIMEOUT = 5000; // a request is treated as stalled if no response received within STALLED_TIMEOUT ms
var RESPONSE_TIMEOUT = 300 * 1000; // after this timeout, the request is abandoned

var wss;
var arrOutboundPeers = [];
var assocConnectingOutboundWebsockets = {};
var assocUnitsInWork = {};
var assocRequestedUnits = {};
var bCatchingUp = false;
var bWaitingForCatchupChain = false;
var bWaitingTillIdle = false;
var coming_online_time = Date.now();
var assocReroutedConnectionsByTag = {};
var arrWatchedAddresses = []; // does not include my addresses, therefore always empty
var last_hearbeat_wake_ts = Date.now();
var peer_events_buffer = [];
var assocKnownPeers = {};
var exchangeRates = {};

if (process.browser) { // browser
    console.log("defining .on() on ws");
    WebSocket.prototype.on = function (event, callback) {
        var self = this;
        if (event === 'message') {
            this['on' + event] = function (event) {
                callback.call(self, event.data);
            };
            return;
        }
        if (event !== 'open') {
            this['on' + event] = callback;
            return;
        }
        // allow several handlers for 'open' event
        if (!this['open_handlers'])
            this['open_handlers'] = [];
        this['open_handlers'].push(callback);
        this['on' + event] = function () {
            self['open_handlers'].forEach(function (cb) {
                cb();
            });
        };
    };
    WebSocket.prototype.once = WebSocket.prototype.on;
    WebSocket.prototype.setMaxListeners = function () {
    };
}

// if not using a hub and accepting messages directly (be your own hub)
var my_device_address;
var objMyTempPubkeyPackage;

function setMyDeviceProps(device_address, objTempPubkey) {
    my_device_address = device_address;
    objMyTempPubkeyPackage = objTempPubkey;
}

exports.light_vendor_url = null;

// general network functions

//TODO delete底层
function sendMessage(ws, type, content) {
    var message = JSON.stringify([type, content]);
    if (ws.readyState !== ws.OPEN)
        return console.log("readyState=" + ws.readyState + ' on peer ' + ws.peer + ', will not send ' + message);
    console.log("SENDING " + message + " to " + ws.peer);
    ws.send(message);
}


//TODO delete
function sendJustsaying(ws, subject, body) {
    sendMessage(ws, 'justsaying', {subject: subject, body: body});
}

function sendAllInboundJustsaying(subject, body) {
    wss.clients.forEach(function (ws) {
        sendMessage(ws, 'justsaying', {subject: subject, body: body});
    });
}

function sendError(ws, error) {
    sendJustsaying(ws, 'error', error);
}

function sendInfo(ws, content) {
    sendJustsaying(ws, 'info', content);
}

function sendResult(ws, content) {
    sendJustsaying(ws, 'result', content);
}

function sendErrorResult(ws, unit, error) {
    sendResult(ws, {unit: unit, result: 'error', error: error});
}

function sendResponse(ws, tag, response) {
    delete ws.assocInPreparingResponse[tag];
    sendMessage(ws, 'response', {tag: tag, response: response});
}

// if a 2nd identical request is issued before we receive a response to the 1st request, then:
// 1. its responseHandler will be called too but no second request will be sent to the wire
// 2. bReroutable flag must be the same
function sendRequest(ws, command, params, bReroutable, responseHandler) {
    var request = {command: command};
    if (params)
        request.params = params;
    var content = _.clone(request);
    var tag = objectHash.getBase64Hash(request);
    //if (ws.assocPendingRequests[tag]) // ignore duplicate requests while still waiting for response from the same peer
    //    return console.log("will not send identical "+command+" request");
    if (ws.assocPendingRequests[tag]) {
        console.log('already sent a ' + command + ' request to ' + ws.peer + ', will add one more response handler rather than sending a duplicate request to the wire');
        ws.assocPendingRequests[tag].responseHandlers.push(responseHandler);
    }
    else {
        content.tag = tag;
        // after STALLED_TIMEOUT, reroute the request to another peer
        // it'll work correctly even if the current peer is already disconnected when the timeout fires
        var reroute = !bReroutable ? null : function () {
            console.log('will try to reroute a ' + command + ' request stalled at ' + ws.peer);
            if (!ws.assocPendingRequests[tag])
                return console.log('will not reroute - the request was already handled by another peer');
            ws.assocPendingRequests[tag].bRerouted = true;
            findNextPeer(ws, function (next_ws) { // the callback may be called much later if findNextPeer has to wait for connection
                if (!ws.assocPendingRequests[tag])
                    return console.log('will not reroute after findNextPeer - the request was already handled by another peer');
                if (next_ws === ws || assocReroutedConnectionsByTag[tag] && assocReroutedConnectionsByTag[tag].indexOf(next_ws) >= 0) {
                    console.log('will not reroute ' + command + ' to the same peer, will rather wait for a new connection');
                    eventBus.once('connected_to_source', function () { // try again
                        console.log('got new connection, retrying reroute ' + command);
                        reroute();
                    });
                    return;
                }
                console.log('rerouting ' + command + ' from ' + ws.peer + ' to ' + next_ws.peer);
                ws.assocPendingRequests[tag].responseHandlers.forEach(function (rh) {
                    sendRequest(next_ws, command, params, bReroutable, rh);
                });
                if (!assocReroutedConnectionsByTag[tag])
                    assocReroutedConnectionsByTag[tag] = [ws];
                assocReroutedConnectionsByTag[tag].push(next_ws);
            });
        };
        var reroute_timer = !bReroutable ? null : setTimeout(reroute, STALLED_TIMEOUT);
        var cancel_timer = bReroutable ? null : setTimeout(function () {
            ws.assocPendingRequests[tag].responseHandlers.forEach(function (rh) {
                rh(ws, request, {error: "[internal] response timeout"});
            });
            delete ws.assocPendingRequests[tag];
        }, RESPONSE_TIMEOUT);
        ws.assocPendingRequests[tag] = {
            request: request,
            responseHandlers: [responseHandler],
            reroute: reroute,
            reroute_timer: reroute_timer,
            cancel_timer: cancel_timer
        };
        sendMessage(ws, 'request', content);
    }
}


// peers

function findNextPeer(ws, handleNextPeer) {
    tryFindNextPeer(ws, function (next_ws) {
        if (next_ws)
            return handleNextPeer(next_ws);
        var peer = ws ? ws.peer : '[none]';
        console.log('findNextPeer after ' + peer + ' found no appropriate peer, will wait for a new connection');
        eventBus.once('connected_to_source', function (new_ws) {
            console.log('got new connection, retrying findNextPeer after ' + peer);
            findNextPeer(ws, handleNextPeer);
        });
    });
}

//TODO delete 删除
function tryFindNextPeer(ws, handleNextPeer) {
    var arrOutboundSources = arrOutboundPeers.filter(function (outbound_ws) {
        return outbound_ws.bSource;
    });
    var len = arrOutboundSources.length;
    if (len > 0) {
        var peer_index = arrOutboundSources.indexOf(ws); // -1 if it is already disconnected by now, or if it is inbound peer, or if it is null
        var next_peer_index = (peer_index === -1) ? getRandomInt(0, len - 1) : ((peer_index + 1) % len);
        handleNextPeer(arrOutboundSources[next_peer_index]);
    }
    else
        findRandomInboundPeer(handleNextPeer);
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max + 1 - min)) + min;
}


//TODO delete 底层
function findRandomInboundPeer(handleInboundPeer) {
    var arrInboundSources = wss.clients.filter(function (inbound_ws) {
        return inbound_ws.bSource;
    });
    if (arrInboundSources.length === 0)
        return handleInboundPeer(null);
    var arrInboundHosts = arrInboundSources.map(function (ws) {
        return ws.host;
    });
    // filter only those inbound peers that are reversible
    db.query(
        "SELECT peer_host FROM peer_host_urls JOIN peer_hosts USING(peer_host) \n\
        WHERE is_active=1 AND peer_host IN(?) \n\
            AND (count_invalid_joints/count_new_good_joints<? \n\
            OR count_new_good_joints=0 AND count_nonserial_joints=0 AND count_invalid_joints=0) \n\
        ORDER BY (count_new_good_joints=0), " + db.getRandom() + " LIMIT 1",
        [arrInboundHosts, conf.MAX_TOLERATED_INVALID_RATIO],
        function (rows) {
            console.log(rows.length + " inbound peers");
            if (rows.length === 0)
                return handleInboundPeer(null);
            var host = rows[0].peer_host;
            console.log("selected inbound peer " + host);
            var ws = arrInboundSources.filter(function (ws) {
                return (ws.host === host);
            })[0];
            if (!ws)
                throw Error("inbound ws not found");
            handleInboundPeer(ws);
        }
    );
}



//TODO delete 底层
function getHostByPeer(peer) {
    var matches = peer.match(/^wss?:\/\/(.*)$/i);
    if (matches)
        peer = matches[1];
    matches = peer.match(/^(.*?)[:\/]/);
    return matches ? matches[1] : peer;
}

//TODO delete 底层
function addPeerHost(host, onDone) {
    db.query("INSERT " + db.getIgnore() + " INTO peer_hosts (peer_host) VALUES (?)", [host], function () {
        if (onDone)
            onDone();
    });
}

//TODO delete
function addPeer(peer) {
    return;
    if (assocKnownPeers[peer])
        return;
    assocKnownPeers[peer] = true;
    var host = getHostByPeer(peer);
    addPeerHost(host, function () {
        console.log("will insert peer " + peer);
        db.query("INSERT " + db.getIgnore() + " INTO peers (peer_host, peer) VALUES (?,?)", [host, peer]);
    });
}

//TODO delete 底层
function getOutboundPeerWsByUrl(url) {
    console.log("outbound peers: " + arrOutboundPeers.map(function (o) {
        return o.peer;
    }).join(", "));
    for (var i = 0; i < arrOutboundPeers.length; i++)
        if (arrOutboundPeers[i].peer === url)
            return arrOutboundPeers[i];
    return null;
}

function getPeerWebSocket(peer) {
    for (var i = 0; i < arrOutboundPeers.length; i++)
        if (arrOutboundPeers[i].peer === peer)
            return arrOutboundPeers[i];
    for (var i = 0; i < wss.clients.length; i++)
        if (wss.clients[i].peer === peer)
            return wss.clients[i];
    return null;
}

//TODO delete
function findOutboundPeerOrConnect(url, onOpen) {
    return;
    if (!url)
        throw Error('no url');
    if (!onOpen)
        onOpen = function () {
        };
    url = url.toLowerCase();
    var ws = getOutboundPeerWsByUrl(url);
    if (ws)
        return onOpen(null, ws);
    // check if we are already connecting to the peer
    ws = assocConnectingOutboundWebsockets[url];
    if (ws) { // add second event handler
        breadcrumbs.add('already connecting to ' + url);
        return eventBus.once('open-' + url, function secondOnOpen(err) {
            console.log('second open ' + url + ", err=" + err);
            if (err)
                return onOpen(err);
            if (ws.readyState === ws.OPEN)
                onOpen(null, ws);
            else {
                // can happen e.g. if the ws was abandoned but later succeeded, we opened another connection in the meantime,
                // and had another_ws_to_same_peer on the first connection
                console.log('in second onOpen, websocket already closed');
                onOpen('[internal] websocket already closed');
            }
        });
    }
    console.log("will connect to " + url);
}


function requestFromLightVendor(command, params, responseHandler) {
    if (!exports.light_vendor_url) {
        console.log("light_vendor_url not set yet");
        return setTimeout(function () {
            requestFromLightVendor(command, params, responseHandler);
        }, 1000);
    }
}

function requestFromLightVendorForJoint(command, params, responseHandler) {
    if (!exports.light_vendor_url) {
        console.log("light_vendor_url not set yet");
        return setTimeout(function () {
            requestFromLightVendorForJoint(command, params, responseHandler);
        }, 1000);
    }
}



// joints

// sent as justsaying or as response to a request
function sendJoint(ws, objJoint, tag) {
    console.log('sending joint identified by unit ' + objJoint.unit.unit + ' to', ws.peer);
    tag ? sendResponse(ws, tag, {joint: objJoint}) : sendJustsaying(ws, 'joint', objJoint);
}

// sent by light clients to their vendors
function postJointToLightVendor(objJoint, handleResponse) {
    console.log('posing joint identified by unit ' + objJoint.unit.unit + ' to light vendor');
    requestFromLightVendor('post_joint', objJoint, function (ws, request, response) {
        handleResponse(response);
    });
}

// sent by light clients to their vendors
function postJointToLightVendorForJoint(objJoint, handleResponse) {
    console.log('posing joint identified by unit ' + objJoint.unit.unit + ' to light vendor');
    requestFromLightVendorForJoint('post_joint', objJoint, function (ws, request, response) {
        handleResponse(response);
    });
}



function requestFreeJointsFromAllOutboundPeers() {
    for (var i = 0; i < arrOutboundPeers.length; i++)
        sendJustsaying(arrOutboundPeers[i], 'refresh', null);
}



//TODO delete
function requestNewMissingJoints(ws, arrUnits) {
    var arrNewUnits = [];
    async.eachSeries(
        arrUnits,
        function (unit, cb) {
            if (assocUnitsInWork[unit])
                return cb();
            if (havePendingJointRequest(unit)) {
                console.log("unit " + unit + " was already requested");
                return cb();
            }
            joint_storage.checkIfNewUnit(unit, {
                ifNew: function () {
                    arrNewUnits.push(unit);
                    cb();
                },
                ifKnown: function () {
                    console.log("known");
                    cb();
                }, // it has just been handled
                ifKnownUnverified: function () {
                    console.log("known unverified");
                    cb();
                }, // I was already waiting for it
                ifKnownBad: function (error) {
                    throw Error("known bad " + unit + ": " + error);
                }
            });
        },
        function () {
            //console.log(arrNewUnits.length+" of "+arrUnits.length+" left", assocUnitsInWork);
            // filter again as something could have changed each time we were paused in checkIfNewUnit
            arrNewUnits = arrNewUnits.filter(function (unit) {
                return (!assocUnitsInWork[unit] && !havePendingJointRequest(unit));
            });
            if (arrNewUnits.length > 0)
                requestJoints(ws, arrNewUnits);
        }
    );
}

function requestJoints(ws, arrUnits) {
    if (arrUnits.length === 0)
        return;
    arrUnits.forEach(function (unit) {
        if (assocRequestedUnits[unit]) {
            var diff = Date.now() - assocRequestedUnits[unit];
            // since response handlers are called in nextTick(), there is a period when the pending request is already cleared but the response
            // handler is not yet called, hence assocRequestedUnits[unit] not yet cleared
            if (diff <= STALLED_TIMEOUT)
                return console.log("unit " + unit + " already requested " + diff + " ms ago, assocUnitsInWork=" + assocUnitsInWork[unit]);
            //	throw new Error("unit "+unit+" already requested "+diff+" ms ago, assocUnitsInWork="+assocUnitsInWork[unit]);
        }
        if (ws.readyState === ws.OPEN)
            assocRequestedUnits[unit] = Date.now();
        // even if readyState is not ws.OPEN, we still send the request, it'll be rerouted after timeout
        sendRequest(ws, 'get_joint', unit, true, handleResponseToJointRequest);
    });
}

function handleResponseToJointRequest(ws, request, response) {
    delete assocRequestedUnits[request.params];
    if (!response.joint) {
        var unit = request.params;
        if (response.joint_not_found === unit) {
            if (conf.bLight) // we trust the light vendor that if it doesn't know about the unit after 1 day, it doesn't exist
                db.query("DELETE FROM unhandled_private_payments WHERE unit=? AND creation_date<" + db.addTime('-1 DAY'), [unit]);
            if (!bCatchingUp)
                return console.log("unit " + unit + " does not exist"); // if it is in unhandled_joints, it'll be deleted in 1 hour
            //	return purgeDependenciesAndNotifyPeers(unit, "unit "+unit+" does not exist");
            db.query("SELECT 1 FROM hash_tree_balls WHERE unit=?", [unit], function (rows) {
                if (rows.length === 0)
                    return console.log("unit " + unit + " does not exist (catching up)");
                //	return purgeDependenciesAndNotifyPeers(unit, "unit "+unit+" does not exist (catching up)");
                findNextPeer(ws, function (next_ws) {
                    breadcrumbs.add("found next peer to reroute joint_not_found " + unit + ": " + next_ws.peer);
                    requestJoints(next_ws, [unit]);
                });
            });
        }
        // if it still exists, we'll request it again
        // we requst joints in two cases:
        // - when referenced from parents, in this case we request it from the same peer who sent us the referencing joint,
        //   he should know, or he is attempting to DoS us
        // - when catching up and requesting old joints from random peers, in this case we are pretty sure it should exist
        return;
    }
    var objJoint = response.joint;
    if (!objJoint.unit || !objJoint.unit.unit)
        return sendError(ws, 'no unit');
    var unit = objJoint.unit.unit;
    if (request.params !== unit)
        return sendError(ws, "I didn't request this unit from you: " + unit);
    if (conf.bLight && objJoint.ball && !objJoint.unit.content_hash) {
        // accept it as unfinished (otherwise we would have to require a proof)
        delete objJoint.ball;
        delete objJoint.skiplist_units;
    }
    conf.bLight ? handleLightOnlineJoint(ws, objJoint) : handleOnlineJoint(ws, objJoint);
}


//TODO delete 底层
function havePendingJointRequest(unit) {
    var arrPeers = wss.clients.concat(arrOutboundPeers);
    for (var i = 0; i < arrPeers.length; i++) {
        var assocPendingRequests = arrPeers[i].assocPendingRequests;
        for (var tag in assocPendingRequests) {
            var request = assocPendingRequests[tag].request;
            if (request.command === 'get_joint' && request.params === unit)
                return true;
        }
    }
    return false;
}


function purgeJointAndDependenciesAndNotifyPeers(objJoint, error, onDone) {
    if (error.indexOf('is not stable in view of your parents') >= 0) { // give it a chance to be retried after adding other units
        eventBus.emit('nonfatal_error', "error on unit " + objJoint.unit.unit + ": " + error + "; " + JSON.stringify(objJoint), new Error());
        return onDone();
    }
    joint_storage.purgeJointAndDependencies(
        objJoint,
        error,
        // this callback is called for each dependent unit
        function (purged_unit, peer) {
            var ws = getPeerWebSocket(peer);
            if (ws)
                sendErrorResult(ws, purged_unit, "error on (indirect) parent unit " + objJoint.unit.unit + ": " + error);
        },
        onDone
    );
}


function forwardJoint(ws, objJoint) {
    wss.clients.concat(arrOutboundPeers).forEach(function (client) {
        if (client != ws && client.bSubscribed)
            sendJoint(client, objJoint);
    });
}

function handleJoint(ws, objJoint, bSaved, callbacks) {
    var unit = objJoint.unit.unit;

    if (assocUnitsInWork[unit])
        return callbacks.ifUnitInWork();
    assocUnitsInWork[unit] = true;

    var validate = function () {
        validation.validate(objJoint, {
            ifUnitError: function (error) {
                console.log(objJoint.unit.unit + " validation failed: " + error);
                callbacks.ifUnitError(error);
                //	throw Error(error);
                purgeJointAndDependenciesAndNotifyPeers(objJoint, error, function () {
                    delete assocUnitsInWork[unit];
                });
                if (ws && error !== 'authentifier verification failed' && !error.match(/bad merkle proof at path/))
                    writeEvent('invalid', ws.host);
                if (objJoint.unsigned)
                    eventBus.emit("validated-" + unit, false);
            },
            ifJointError: function (error) {
                callbacks.ifJointError(error);
                //	throw Error(error);
                db.query(
                    "INSERT INTO known_bad_joints (joint, json, error) VALUES (?,?,?)",
                    [objectHash.getJointHash(objJoint), JSON.stringify(objJoint), error],
                    function () {
                        delete assocUnitsInWork[unit];
                    }
                );
                if (ws)
                    writeEvent('invalid', ws.host);
                if (objJoint.unsigned)
                    eventBus.emit("validated-" + unit, false);
            },
            ifTransientError: function (error) {
                throw Error(error);
                console.log("############################## transient error " + error);
                delete assocUnitsInWork[unit];
            },
            ifNeedHashTree: function () {
                console.log('need hash tree for unit ' + unit);
                if (objJoint.unsigned)
                    throw Error("ifNeedHashTree() unsigned");
                callbacks.ifNeedHashTree();
                // we are not saving unhandled joint because we don't know dependencies
                delete assocUnitsInWork[unit];
            },
            ifNeedParentUnits: callbacks.ifNeedParentUnits,
            ifOk: function (objValidationState, validation_unlock) {
                if (objJoint.unsigned)
                    throw Error("ifOk() unsigned");

                console.log("delete writer.saveJoint")
                // writer.saveJoint(objJoint, objValidationState, null, function () {
                //     validation_unlock();
                //     callbacks.ifOk();
                //     if (ws)
                //         writeEvent((objValidationState.sequence !== 'good') ? 'nonserial' : 'new_good', ws.host);
                //     notifyWatchers(objJoint, ws);
                //     if (!bCatchingUp)
                //         eventBus.emit('new_joint', objJoint);
                // });
            },
            ifOkUnsigned: function (bSerial) {
                if (!objJoint.unsigned)
                    throw Error("ifOkUnsigned() signed");
                callbacks.ifOkUnsigned();
                eventBus.emit("validated-" + unit, bSerial);
            }
        });
    };

    joint_storage.checkIfNewJoint(objJoint, {
        ifNew: function () {
            bSaved ? callbacks.ifNew() : validate();
        },
        ifKnown: function () {
            callbacks.ifKnown();
            delete assocUnitsInWork[unit];
        },
        ifKnownBad: function () {
            callbacks.ifKnownBad();
            delete assocUnitsInWork[unit];
        },
        ifKnownUnverified: function () {
            bSaved ? validate() : callbacks.ifKnownUnverified();
        }
    });
}


//TODO delete 可删除
function handleOnlineJoint(ws, objJoint, onDone) {
    if (!onDone)
        onDone = function () {
        };
    var unit = objJoint.unit.unit;
    delete objJoint.unit.main_chain_index;

    handleJoint(ws, objJoint, false, {
        ifUnitInWork: onDone,
        ifUnitError: function (error) {
            sendErrorResult(ws, unit, error);
            onDone();
        },
        ifJointError: function (error) {
            sendErrorResult(ws, unit, error);
            onDone();
        },
        ifNeedHashTree: function () {
            if (!bCatchingUp && !bWaitingForCatchupChain) ;
            // requestCatchup(ws);
            // we are not saving the joint so that in case requestCatchup() fails, the joint will be requested again via findLostJoints,
            // which will trigger another attempt to request catchup
            onDone();
        },
        ifNeedParentUnits: function (arrMissingUnits) {
            sendInfo(ws, {unit: unit, info: "unresolved dependencies: " + arrMissingUnits.join(", ")});
            joint_storage.saveUnhandledJointAndDependencies(objJoint, arrMissingUnits, ws.peer, function () {
                delete assocUnitsInWork[unit];
            });
            requestNewMissingJoints(ws, arrMissingUnits);
            onDone();
        },
        ifOk: function () {
            sendResult(ws, {unit: unit, result: 'accepted'});

            // forward to other peers
            if (!bCatchingUp && !conf.bLight)
                forwardJoint(ws, objJoint);

            delete assocUnitsInWork[unit];

            // wake up other joints that depend on me
            findAndHandleJointsThatAreReady(unit);
            onDone();
        },
        ifOkUnsigned: function () {
            delete assocUnitsInWork[unit];
            onDone();
        },
        ifKnown: function () {
            if (objJoint.unsigned)
                throw Error("known unsigned");
            sendResult(ws, {unit: unit, result: 'known'});
            writeEvent('known_good', ws.host);
            onDone();
        },
        ifKnownBad: function () {
            sendResult(ws, {unit: unit, result: 'known_bad'});
            writeEvent('known_bad', ws.host);
            if (objJoint.unsigned)
                eventBus.emit("validated-" + unit, false);
            onDone();
        },
        ifKnownUnverified: function () {
            sendResult(ws, {unit: unit, result: 'known_unverified'});
            delete assocUnitsInWork[unit];
            onDone();
        }
    });
}


function handleSavedJoint(objJoint, creation_ts, peer) {

    var unit = objJoint.unit.unit;
    var ws = getPeerWebSocket(peer);
    if (ws && ws.readyState !== ws.OPEN)
        ws = null;

    handleJoint(ws, objJoint, true, {
        ifUnitInWork: function () {
        },
        ifUnitError: function (error) {
            if (ws)
                sendErrorResult(ws, unit, error);
        },
        ifJointError: function (error) {
            if (ws)
                sendErrorResult(ws, unit, error);
        },
        ifNeedHashTree: function () {
            throw Error("handleSavedJoint: need hash tree");
        },
        ifNeedParentUnits: function (arrMissingUnits) {
            db.query("SELECT 1 FROM archived_joints WHERE unit IN(?) LIMIT 1", [arrMissingUnits], function (rows) {
                if (rows.length === 0)
                    throw Error("unit " + unit + " still has unresolved dependencies: " + arrMissingUnits.join(", "));
                breadcrumbs.add("unit " + unit + " has unresolved dependencies that were archived: " + arrMissingUnits.join(", "))
                if (ws)
                    requestNewMissingJoints(ws, arrMissingUnits);
                else
                    findNextPeer(null, function (next_ws) {
                        requestNewMissingJoints(next_ws, arrMissingUnits);
                    });
                delete assocUnitsInWork[unit];
            });
        },
        ifOk: function () {
            if (ws)
                sendResult(ws, {unit: unit, result: 'accepted'});

            // forward to other peers
            if (!bCatchingUp && !conf.bLight && creation_ts > Date.now() - FORWARDING_TIMEOUT)
                forwardJoint(ws, objJoint);

            joint_storage.removeUnhandledJointAndDependencies(unit, function () {
                delete assocUnitsInWork[unit];
                // wake up other saved joints that depend on me
                findAndHandleJointsThatAreReady(unit);
            });
        },
        ifOkUnsigned: function () {
            joint_storage.removeUnhandledJointAndDependencies(unit, function () {
                delete assocUnitsInWork[unit];
            });
        },
        // readDependentJointsThatAreReady can read the same joint twice before it's handled. If not new, just ignore (we've already responded to peer).
        ifKnown: function () {
        },
        ifKnownBad: function () {
        },
        ifNew: function () {
            // that's ok: may be simultaneously selected by readDependentJointsThatAreReady and deleted by purgeJunkUnhandledJoints when we wake up after sleep
            delete assocUnitsInWork[unit];
            console.log("new in handleSavedJoint: " + unit);
            //	throw Error("new in handleSavedJoint: "+unit);
        }
    });
}

function handleLightOnlineJoint(ws, objJoint) {
    // the lock ensures that we do not overlap with history processing which might also write new joints
    mutex.lock(["light_joints"], function (unlock) {
        breadcrumbs.add('got light_joints for handleLightOnlineJoint ' + objJoint.unit.unit);
        handleOnlineJoint(ws, objJoint, function () {
            breadcrumbs.add('handleLightOnlineJoint done');
            unlock();
        });
    });
}

function setWatchedAddresses(_arrWatchedAddresses) {
    arrWatchedAddresses = _arrWatchedAddresses;
}

function addWatchedAddress(address) {
    arrWatchedAddresses.push(address);
}

// if any of the watched addresses are affected, notifies:  1. own UI  2. light clients
function notifyWatchers(objJoint, source_ws) {
    var objUnit = objJoint.unit;
    var arrAddresses = objUnit.authors.map(function (author) {
        return author.address;
    });
    if (!objUnit.messages) // voided unit
        return;
    for (var i = 0; i < objUnit.messages.length; i++) {
        var message = objUnit.messages[i];
        if (message.app !== "payment" || !message.payload)
            continue;
        var payload = message.payload;
        for (var j = 0; j < payload.outputs.length; j++) {
            var address = payload.outputs[j].address;
            if (arrAddresses.indexOf(address) === -1)
                arrAddresses.push(address);
        }
    }
    if (_.intersection(arrWatchedAddresses, arrAddresses).length > 0) {
        eventBus.emit("new_my_transactions", [objJoint.unit.unit]);
        eventBus.emit("new_my_unit-" + objJoint.unit.unit, objJoint);
    }
    else
        db.query(
            "SELECT 1 FROM my_addresses WHERE address IN(?) UNION SELECT 1 FROM shared_addresses WHERE shared_address IN(?)",
            [arrAddresses, arrAddresses],
            function (rows) {
                if (rows.length > 0) {
                    eventBus.emit("new_my_transactions", [objJoint.unit.unit]);
                    eventBus.emit("new_my_unit-" + objJoint.unit.unit, objJoint);
                }
            }
        );

    if (conf.bLight)
        return;
    if (objJoint.ball) // already stable, light clients will require a proof
        return;
    // this is a new unstable joint, light clients will accept it without proof
    db.query("SELECT peer FROM watched_light_addresses WHERE address IN(?)", [arrAddresses], function (rows) {
        if (rows.length === 0)
            return;
        objUnit.timestamp = Math.round(Date.now() / 1000); // light clients need timestamp
        rows.forEach(function (row) {
            var ws = getPeerWebSocket(row.peer);
            if (ws && ws.readyState === ws.OPEN && ws !== source_ws)
                sendJoint(ws, objJoint);
        });
    });
}

// eventBus.on('mci_became_stable', notifyWatchersAboutStableJoints);


// from_mci is non-inclusive, to_mci is inclusive


function addLightWatchedAddress(address) {
    if (!conf.bLight || !exports.light_vendor_url)
        return;
}

function flushEvents(forceFlushing) {
    if (peer_events_buffer.length == 0 || (!forceFlushing && peer_events_buffer.length != 100)) {
        return;
    }

    var arrQueryParams = [];
    var objUpdatedHosts = {};
    peer_events_buffer.forEach(function (event_row) {
        var host = event_row.host;
        var event = event_row.event;
        var event_date = event_row.event_date;
        if (event === 'new_good') {
            var column = "count_" + event + "_joints";
            _.set(objUpdatedHosts, [host, column], _.get(objUpdatedHosts, [host, column], 0) + 1);
        }
        arrQueryParams.push("(" + db.escape(host) + "," + db.escape(event) + "," + db.getFromUnixTime(event_date) + ")");
    });

    for (var host in objUpdatedHosts) {
        var columns_obj = objUpdatedHosts[host];
        var sql_columns_updates = [];
        for (var column in columns_obj) {
            sql_columns_updates.push(column + "=" + column + "+" + columns_obj[column]);
        }
        db.query("UPDATE peer_hosts SET " + sql_columns_updates.join() + " WHERE peer_host=?", [host]);
    }

    db.query("INSERT INTO peer_events (peer_host, event, event_date) VALUES " + arrQueryParams.join());
    peer_events_buffer = [];
    objUpdatedHosts = {};
}

function writeEvent(event, host) {
    if (event === 'invalid' || event === 'nonserial') {
        var column = "count_" + event + "_joints";
        db.query("UPDATE peer_hosts SET " + column + "=" + column + "+1 WHERE peer_host=?", [host]);
        db.query("INSERT INTO peer_events (peer_host, event) VALUES (?,?)", [host, event]);
        return;
    }
    var event_date = Math.floor(Date.now() / 1000);
    peer_events_buffer.push({host: host, event: event, event_date: event_date});
    flushEvents();
}

// setInterval(function () {
//     flushEvents(true)
// }, 1000 * 60);


function findAndHandleJointsThatAreReady(unit) {
    joint_storage.readDependentJointsThatAreReady(unit, handleSavedJoint);
    handleSavedPrivatePayments(unit);
}

function comeOnline() {
    bCatchingUp = false;
    coming_online_time = Date.now();
    waitTillIdle(function () {
        requestFreeJointsFromAllOutboundPeers();
        setTimeout(cleanBadSavedPrivatePayments, 300 * 1000);
    });
    eventBus.emit('catching_up_done');
}

function isIdle() {
    //console.log(db._freeConnections.length +"/"+ db._allConnections.length+" connections are free, "+mutex.getCountOfQueuedJobs()+" jobs queued, "+mutex.getCountOfLocks()+" locks held, "+Object.keys(assocUnitsInWork).length+" units in work");
    return (db.getCountUsedConnections() === 0 && mutex.getCountOfQueuedJobs() === 0 && mutex.getCountOfLocks() === 0 && Object.keys(assocUnitsInWork).length === 0);
}

function waitTillIdle(onIdle) {
    if (isIdle()) {
        bWaitingTillIdle = false;
        onIdle();
    }
    else {
        bWaitingTillIdle = true;
        setTimeout(function () {
            waitTillIdle(onIdle);
        }, 100);
    }
}

function broadcastJoint(objJoint) {
    if (conf.bLight) // the joint was already posted to light vendor before saving
        return;
    wss.clients.concat(arrOutboundPeers).forEach(function (client) {
        if (client.bSubscribed)
            sendJoint(client, objJoint);
    });
    notifyWatchers(objJoint);
}





// hash tree

function requestNextHashTree(ws) {
    eventBus.emit('catchup_next_hash_tree');
    db.query("SELECT ball FROM catchup_chain_balls ORDER BY member_index LIMIT 2", function (rows) {
        if (rows.length === 0)
            return comeOnline();
        if (rows.length === 1) {
            db.query("DELETE FROM catchup_chain_balls WHERE ball=?", [rows[0].ball], function () {
                comeOnline();
            });
            return;
        }
        var from_ball = rows[0].ball;
        var to_ball = rows[1].ball;

        // don't send duplicate requests
        for (var tag in ws.assocPendingRequests)
            if (ws.assocPendingRequests[tag].request.command === 'get_hash_tree') {
                console.log("already requested hash tree from this peer");
                return;
            }
        sendRequest(ws, 'get_hash_tree', {from_ball: from_ball, to_ball: to_ball}, true, handleHashTree);
    });
}

function handleHashTree(ws, request, response) {
    if (response.error) {
        console.log('get_hash_tree got error response: ' + response.error);
        waitTillHashTreeFullyProcessedAndRequestNext(ws); // after 1 sec, it'll request the same hash tree, likely from another peer
        return;
    }
    var hashTree = response;
    catchup.processHashTree(hashTree.balls, {
        ifError: function (error) {
            sendError(ws, error);
            waitTillHashTreeFullyProcessedAndRequestNext(ws); // after 1 sec, it'll request the same hash tree, likely from another peer
        },
        ifOk: function () {
            requestNewMissingJoints(ws, hashTree.balls.map(function (objBall) {
                return objBall.unit;
            }));
            waitTillHashTreeFullyProcessedAndRequestNext(ws);
        }
    });
}

function waitTillHashTreeFullyProcessedAndRequestNext(ws) {
    setTimeout(function () {
        db.query("SELECT 1 FROM hash_tree_balls LEFT JOIN units USING(unit) WHERE units.unit IS NULL LIMIT 1", function (rows) {
            if (rows.length === 0) {
                findNextPeer(ws, function (next_ws) {
                    requestNextHashTree(next_ws);
                });
            }
            else
                waitTillHashTreeFullyProcessedAndRequestNext(ws);
        });
    }, 1000);
}



function sendPrivatePaymentToWs(ws, arrChains) {
    // each chain is sent as separate ws message
    arrChains.forEach(function (arrPrivateElements) {
        sendJustsaying(ws, 'private_payment', arrPrivateElements);
    });
}

// sends multiple private payloads and their corresponding chains
function sendPrivatePayment(peer, arrChains) {
    var ws = getPeerWebSocket(peer);
    if (ws)
        return sendPrivatePaymentToWs(ws, arrChains);
    findOutboundPeerOrConnect(peer, function (err, ws) {
        if (!err)
            sendPrivatePaymentToWs(ws, arrChains);
    });
}

// handles one private payload and its chain
function handleOnlinePrivatePayment(ws, arrPrivateElements, bViaHub, callbacks) {
    if (!ValidationUtils.isNonemptyArray(arrPrivateElements))
        return callbacks.ifError("private_payment content must be non-empty array");

    var unit = arrPrivateElements[0].unit;
    var message_index = arrPrivateElements[0].message_index;
    var output_index = arrPrivateElements[0].payload.denomination ? arrPrivateElements[0].output_index : -1;

    var savePrivatePayment = function (cb) {
        // we may receive the same unit and message index but different output indexes if recipient and cosigner are on the same device.
        // in this case, we also receive the same (unit, message_index, output_index) twice - as cosigner and as recipient.  That's why IGNORE.
        db.query(
            "INSERT " + db.getIgnore() + " INTO unhandled_private_payments (unit, message_index, output_index, json, peer) VALUES (?,?,?,?,?)",
            [unit, message_index, output_index, JSON.stringify(arrPrivateElements), bViaHub ? '' : ws.peer], // forget peer if received via hub
            function () {
                callbacks.ifQueued();
                if (cb)
                    cb();
            }
        );
    };

    if (conf.bLight && arrPrivateElements.length > 1) {
        savePrivatePayment(function () {
            updateLinkProofsOfPrivateChain(arrPrivateElements, unit, message_index, output_index);
            rerequestLostJointsOfPrivatePayments(); // will request the head element
        });
        return;
    }

    joint_storage.checkIfNewUnit(unit, {
        ifKnown: function () {
            //assocUnitsInWork[unit] = true;
            privatePayment.validateAndSavePrivatePaymentChain(arrPrivateElements, {
                ifOk: function () {
                    //delete assocUnitsInWork[unit];
                    callbacks.ifAccepted(unit);
                    eventBus.emit("new_my_transactions", [unit]);
                },
                ifError: function (error) {
                    //delete assocUnitsInWork[unit];
                    callbacks.ifValidationError(unit, error);
                },
                ifWaitingForChain: function () {
                    savePrivatePayment();
                }
            });
        },
        ifNew: function () {
            savePrivatePayment();
            // if received via hub, I'm requesting from the same hub, thus telling the hub that this unit contains a private payment for me.
            // It would be better to request missing joints from somebody else
            requestNewMissingJoints(ws, [unit]);
        },
        ifKnownUnverified: savePrivatePayment,
        ifKnownBad: function () {
            callbacks.ifValidationError(unit, "known bad");
        }
    });
}

// if unit is undefined, find units that are ready
function handleSavedPrivatePayments(unit) {
    //if (unit && assocUnitsInWork[unit])
    //    return;
    mutex.lock(["saved_private"], function (unlock) {
        var sql = unit
            ? "SELECT json, peer, unit, message_index, output_index, linked FROM unhandled_private_payments WHERE unit=" + db.escape(unit)
            : "SELECT json, peer, unit, message_index, output_index, linked FROM unhandled_private_payments CROSS JOIN units USING(unit)";
        db.query(sql, function (rows) {
            if (rows.length === 0)
                return unlock();
            var assocNewUnits = {};
            async.each( // handle different chains in parallel
                rows,
                function (row, cb) {
                    var arrPrivateElements = JSON.parse(row.json);
                    var ws = getPeerWebSocket(row.peer);
                    if (ws && ws.readyState !== ws.OPEN)
                        ws = null;

                    var validateAndSave = function () {
                        var objHeadPrivateElement = arrPrivateElements[0];
                        var payload_hash = objectHash.getBase64Hash(objHeadPrivateElement.payload);
                        var key = 'private_payment_validated-' + objHeadPrivateElement.unit + '-' + payload_hash + '-' + row.output_index;
                        privatePayment.validateAndSavePrivatePaymentChain(arrPrivateElements, {
                            ifOk: function () {
                                if (ws)
                                    sendResult(ws, {private_payment_in_unit: row.unit, result: 'accepted'});
                                if (row.peer) // received directly from a peer, not through the hub
                                    eventBus.emit("new_direct_private_chains", [arrPrivateElements]);
                                assocNewUnits[row.unit] = true;
                                deleteHandledPrivateChain(row.unit, row.message_index, row.output_index, cb);
                                console.log('emit ' + key);
                                eventBus.emit(key, true);
                            },
                            ifError: function (error) {
                                console.log("validation of priv: " + error);
                                //	throw Error(error);
                                if (ws)
                                    sendResult(ws, {private_payment_in_unit: row.unit, result: 'error', error: error});
                                deleteHandledPrivateChain(row.unit, row.message_index, row.output_index, cb);
                                eventBus.emit(key, false);
                            },
                            // light only. Means that chain joints (excluding the head) not downloaded yet or not stable yet
                            ifWaitingForChain: function () {
                                cb();
                            }
                        });
                    };

                    if (conf.bLight && arrPrivateElements.length > 1 && !row.linked)
                        updateLinkProofsOfPrivateChain(arrPrivateElements, row.unit, row.message_index, row.output_index, cb, validateAndSave);
                    else
                        validateAndSave();

                },
                function () {
                    unlock();
                    var arrNewUnits = Object.keys(assocNewUnits);
                    if (arrNewUnits.length > 0)
                        eventBus.emit("new_my_transactions", arrNewUnits);
                }
            );
        });
    });
}

function deleteHandledPrivateChain(unit, message_index, output_index, cb) {
    db.query("DELETE FROM unhandled_private_payments WHERE unit=? AND message_index=? AND output_index=?", [unit, message_index, output_index], function () {
        cb();
    });
}

// full only
function cleanBadSavedPrivatePayments() {
    if (conf.bLight || bCatchingUp)
        return;
    db.query(
        "SELECT DISTINCT unhandled_private_payments.unit FROM unhandled_private_payments LEFT JOIN units USING(unit) \n\
        WHERE units.unit IS NULL AND unhandled_private_payments.creation_date<" + db.addTime('-1 DAY'),
        function (rows) {
            rows.forEach(function (row) {
                breadcrumbs.add('deleting bad saved private payment ' + row.unit);
                db.query("DELETE FROM unhandled_private_payments WHERE unit=?", [row.unit]);
            });
        }
    );

}

// light only
function rerequestLostJointsOfPrivatePayments() {
    if (!conf.bLight || !exports.light_vendor_url)
        return;
    db.query(
        "SELECT DISTINCT unhandled_private_payments.unit FROM unhandled_private_payments LEFT JOIN units USING(unit) WHERE units.unit IS NULL",
        function (rows) {
            if (rows.length === 0)
                return;
            var arrUnits = rows.map(function (row) {
                return row.unit;
            });
            findOutboundPeerOrConnect(exports.light_vendor_url, function (err, ws) {
                if (err)
                    return;
                requestNewMissingJoints(ws, arrUnits);
            });
        }
    );
}

// light only
function requestUnfinishedPastUnitsOfPrivateChains(arrChains, onDone) {
    if (!onDone)
        onDone = function () {
        };
    privatePayment.findUnfinishedPastUnitsOfPrivateChains(arrChains, true, function (arrUnits) {
        if (arrUnits.length === 0)
            return onDone();
        breadcrumbs.add(arrUnits.length + " unfinished past units of private chains");
        requestHistoryFor(arrUnits, [], onDone);
    });
}

function requestHistoryFor(arrUnits, arrAddresses, onDone) {
    if (!onDone)
        onDone = function () {
        };
    myWitnesses.readMyWitnesses(function (arrWitnesses) {
        var objHistoryRequest = {witnesses: arrWitnesses};
        if (arrUnits.length)
            objHistoryRequest.requested_joints = arrUnits;
        if (arrAddresses.length)
            objHistoryRequest.addresses = arrAddresses;
        requestFromLightVendor('light/get_history', objHistoryRequest, function (ws, request, response) {
            if (response.error) {
                console.log(response.error);
                return onDone(response.error);
            }
            light.processHistory(response, {
                ifError: function (err) {
                    sendError(ws, err);
                    onDone(err);
                },
                ifOk: function () {
                    onDone();
                }
            });
        });
    }, 'wait');
}

function requestProofsOfJointsIfNewOrUnstable(arrUnits, onDone) {
    if (!onDone)
        onDone = function () {
        };
    storage.filterNewOrUnstableUnits(arrUnits, function (arrNewOrUnstableUnits) {
        if (arrNewOrUnstableUnits.length === 0)
            return onDone();
        requestHistoryFor(arrUnits, [], onDone);
    });
}

/**
 * 发送交易 到共识网
 * @param unit
 * @returns {Promise<*>}
 */
async function sendTransaction(unit) {
    return await hashnethelper.sendMessage(unit);
}

async function requestTransactionHistory() {
    let {addresses} = await device.getInfo();
    if(addresses.length == 0) {
        return;
    }
    await light.updateHistory(addresses);
}

function initialLocalfullnodeList() {
    hashnethelper.initialLocalfullnodeList();
}


// light only
// Note that we are leaking to light vendor information about the full chain. 
// If the light vendor was a party to any previous transaction in this chain, he'll know how much we received.
function checkThatEachChainElementIncludesThePrevious(arrPrivateElements, handleResult) {
    if (arrPrivateElements.length === 1) // an issue
        return handleResult(true);
    var arrUnits = arrPrivateElements.map(function (objPrivateElement) {
        return objPrivateElement.unit;
    });
    requestFromLightVendor('light/get_link_proofs', arrUnits, function (ws, request, response) {
        if (response.error)
            return handleResult(null); // undefined result
        var arrChain = response;
        if (!ValidationUtils.isNonemptyArray(arrChain))
            return handleResult(null); // undefined result
        light.processLinkProofs(arrUnits, arrChain, {
            ifError: function (err) {
                console.log("linkproof validation failed: " + err);
                throw Error(err);
                handleResult(false);
            },
            ifOk: function () {
                console.log("linkproof validated ok");
                handleResult(true);
            }
        });
    });
}

// light only
function updateLinkProofsOfPrivateChain(arrPrivateElements, unit, message_index, output_index, onFailure, onSuccess) {
    if (!conf.bLight)
        throw Error("not light but updateLinkProofsOfPrivateChain");
    if (!onFailure)
        onFailure = function () {
        };
    if (!onSuccess)
        onSuccess = function () {
        };
    checkThatEachChainElementIncludesThePrevious(arrPrivateElements, function (bLinked) {
        if (bLinked === null)
            return onFailure();
        if (!bLinked)
            return deleteHandledPrivateChain(unit, message_index, output_index, onFailure);
        // the result cannot depend on output_index
        db.query("UPDATE unhandled_private_payments SET linked=1 WHERE unit=? AND message_index=?", [unit, message_index], function () {
            onSuccess();
        });
    });
}

//TODO delete 底层
function initWitnessesIfNecessary(ws, onDone) {
    onDone = onDone || function () {
    };
    myWitnesses.readMyWitnesses(function (arrWitnesses) {
        if (arrWitnesses.length > 0) // already have witnesses
            return onDone();
        sendRequest(ws, 'get_witnesses', null, false, function (ws, request, arrWitnesses) {
            if (arrWitnesses.error) {
                console.log('get_witnesses returned error: ' + arrWitnesses.error);
                return onDone();
            }
            myWitnesses.insertWitnesses(arrWitnesses, onDone);
        });
    }, 'ignore');
}





/**
 * 定时任务：拉取共识网交易记录
 */
function startLightClient() {
    wss = {clients: []};
    // rerequestLostJointsOfPrivatePayments();
    // setInterval(rerequestLostJointsOfPrivatePayments, 5 * 1000);
    // setInterval(handleSavedPrivatePayments, 5 * 1000);
    // setInterval(requestUnfinishedPastUnitsOfSavedPrivateElements, 12 * 1000);
    setInterval(requestTransactionHistory, 5 * 1000);
}

/**
 * 开始从共识网络拉取数据
 */
function start() {
    console.log("starting network");
    startLightClient();
    // setInterval(printConnectionStatus, 6 * 1000);
    // if we have exactly same intervals on two clints, they might send heartbeats to each other at the same time
    // setInterval(heartbeat, 3 * 1000 + getRandomInt(0, 1000));
}

function closeAllWsConnections() {
    arrOutboundPeers.forEach(function (ws) {
        ws.close(1000, 'Re-connect');
    });
}

function isConnected() {
    return (arrOutboundPeers.length + wss.clients.length);
}

function isCatchingUp() {
    return bCatchingUp;
}

start();

exports.start = start;
exports.postJointToLightVendor = postJointToLightVendor;
exports.postJointToLightVendorForJoint = postJointToLightVendorForJoint;
exports.broadcastJoint = broadcastJoint;
exports.sendPrivatePayment = sendPrivatePayment;
exports.requestFromLightVendorForJoint = requestFromLightVendorForJoint;

exports.sendJustsaying = sendJustsaying;
exports.sendAllInboundJustsaying = sendAllInboundJustsaying;
exports.sendError = sendError;
exports.sendRequest = sendRequest;
exports.findOutboundPeerOrConnect = findOutboundPeerOrConnect;
exports.handleOnlineJoint = handleOnlineJoint;

exports.handleOnlinePrivatePayment = handleOnlinePrivatePayment;
exports.requestUnfinishedPastUnitsOfPrivateChains = requestUnfinishedPastUnitsOfPrivateChains;
exports.requestProofsOfJointsIfNewOrUnstable = requestProofsOfJointsIfNewOrUnstable;

exports.requestFromLightVendor = requestFromLightVendor;

exports.addPeer = addPeer;

exports.initWitnessesIfNecessary = initWitnessesIfNecessary;
exports.initialLocalfullnodeList = initialLocalfullnodeList;
exports.setMyDeviceProps = setMyDeviceProps;

exports.setWatchedAddresses = setWatchedAddresses;
exports.addWatchedAddress = addWatchedAddress;
exports.addLightWatchedAddress = addLightWatchedAddress;
exports.sendTransaction = sendTransaction;
exports.closeAllWsConnections = closeAllWsConnections;
exports.isConnected = isConnected;
exports.isCatchingUp = isCatchingUp;
exports.requestHistoryFor = requestHistoryFor;
exports.exchangeRates = exchangeRates;