/*jslint node: true */
"use strict";
var async = require('async');
var _ = require('lodash');
var db = require('./db.js');
var constants = require('./constants.js');
var conf = require('./conf.js');
var objectHash = require('./object_hash.js');
var ecdsaSig = require('./signature.js');
var network = require('./network.js');
var storage = require('./storage.js');
var device = require('./device.js');
var walletGeneral = require('./wallet_general.js');
var walletDefinedByKeys = require('./wallet_defined_by_keys.js');
var walletDefinedByAddresses = require('./wallet_defined_by_addresses.js');
var eventBus = require('./event_bus.js');
var ValidationUtils = require("./validation_utils.js");
var composer = require('./composer.js');
var indivisibleAsset = require('./indivisible_asset.js');
var divisibleAsset = require('./divisible_asset.js');
var profiler = require('./profiler.js');
var balances = require('./balances');
var Mnemonic = require('bitcore-mnemonic');
var inputs = require('./inputs.js');
var light = require('./light.js');
var message_counter = 0;
var assocLastFailedAssetMetadataTimestamps = {};
var ASSET_METADATA_RETRY_PERIOD = 3600 * 1000;



// eventBus.on("message_from_hub", handleJustsaying);
// eventBus.on("message_for_light", handleJustsaying);





// called from UI after user confirms signing request initiated from another device, initiator device being the recipient of this message
function sendSignature(device_address, signed_text, signature, signing_path, address) {
    device.sendMessageToDevice(device_address, "signature", { signed_text: signed_text, signature: signature, signing_path: signing_path, address: address });
}


function handlePrivatePaymentChains(ws, body, from_address, callbacks) {
    var arrChains = body.chains;
    if (!ValidationUtils.isNonemptyArray(arrChains))
        return callbacks.ifError("no chains found");
    profiler.increment();

    if (conf.bLight)
        network.requestUnfinishedPastUnitsOfPrivateChains(arrChains); // it'll work in the background

    var assocValidatedByKey = {};
    var bParsingComplete = false;
    var cancelAllKeys = function () {
        for (var key in assocValidatedByKey)
            eventBus.removeAllListeners(key);
    };

    var current_message_counter = ++message_counter;

    var checkIfAllValidated = function () {
        if (!assocValidatedByKey) // duplicate call - ignore
            return console.log('duplicate call of checkIfAllValidated');
        for (var key in assocValidatedByKey)
            if (!assocValidatedByKey[key])
                return console.log('not all private payments validated yet');
        eventBus.emit('all_private_payments_handled', from_address);
        eventBus.emit('all_private_payments_handled-' + arrChains[0][0].unit);
        assocValidatedByKey = null; // to avoid duplicate calls
        if (!body.forwarded) {
            if (from_address) emitNewPrivatePaymentReceived(from_address, arrChains, current_message_counter);
            // note, this forwarding won't work if the user closes the wallet before validation of the private chains
            var arrUnits = arrChains.map(function (arrPrivateElements) { return arrPrivateElements[0].unit; });
            db.query("SELECT address FROM unit_authors WHERE unit IN(?)", [arrUnits], function (rows) {
                var arrAuthorAddresses = rows.map(function (row) { return row.address; });
                // if the addresses are not shared, it doesn't forward anything
                forwardPrivateChainsToOtherMembersOfSharedAddresses(arrChains, arrAuthorAddresses, from_address, true);
            });
        }
        profiler.print();
    };

    async.eachSeries(
        arrChains,
        function (arrPrivateElements, cb) { // validate each chain individually
            var objHeadPrivateElement = arrPrivateElements[0];
            if (!!objHeadPrivateElement.payload.denomination !== ValidationUtils.isNonnegativeInteger(objHeadPrivateElement.output_index))
                return cb("divisibility doesn't match presence of output_index");
            var output_index = objHeadPrivateElement.payload.denomination ? objHeadPrivateElement.output_index : -1;
            var payload_hash = objectHash.getBase64Hash(objHeadPrivateElement.payload);
            var key = 'private_payment_validated-' + objHeadPrivateElement.unit + '-' + payload_hash + '-' + output_index;
            assocValidatedByKey[key] = false;
            network.handleOnlinePrivatePayment(ws, arrPrivateElements, true, {
                ifError: function (error) {
                    console.log("handleOnlinePrivatePayment error: " + error);
                    cb("an error"); // do not leak error message to the hub
                },
                ifValidationError: function (unit, error) {
                    console.log("handleOnlinePrivatePayment validation error: " + error);
                    cb("an error"); // do not leak error message to the hub
                },
                ifAccepted: function (unit) {
                    console.log("handleOnlinePrivatePayment accepted");
                    assocValidatedByKey[key] = true;
                    cb(); // do not leak unit info to the hub
                },
                // this is the most likely outcome for light clients
                ifQueued: function () {
                    console.log("handleOnlinePrivatePayment queued, will wait for " + key);
                    eventBus.once(key, function (bValid) {
                        if (!bValid)
                            return cancelAllKeys();
                        assocValidatedByKey[key] = true;
                        if (bParsingComplete)
                            checkIfAllValidated();
                        else
                            console.log('parsing incomplete yet');
                    });
                    cb();
                }
            });
        },
        function (err) {
            bParsingComplete = true;
            if (err) {
                cancelAllKeys();
                return callbacks.ifError(err);
            }
            checkIfAllValidated();
            callbacks.ifOk();
            // forward the chains to other members of output addresses
            if (!body.forwarded)
                forwardPrivateChainsToOtherMembersOfOutputAddresses(arrChains);
        }
    );
}


function forwardPrivateChainsToOtherMembersOfOutputAddresses(arrChains, conn, onSaved) {
    console.log("forwardPrivateChainsToOtherMembersOfOutputAddresses", arrChains);
    var assocOutputAddresses = {};
    arrChains.forEach(function (arrPrivateElements) {
        var objHeadPrivateElement = arrPrivateElements[0];
        var payload = objHeadPrivateElement.payload;
        payload.outputs.forEach(function (output) {
            if (output.address)
                assocOutputAddresses[output.address] = true;
        });
        if (objHeadPrivateElement.output && objHeadPrivateElement.output.address)
            assocOutputAddresses[objHeadPrivateElement.output.address] = true;
    });
    var arrOutputAddresses = Object.keys(assocOutputAddresses);
    console.log("output addresses", arrOutputAddresses);
    conn = conn || db;
    if (!onSaved)
        onSaved = function () { };
    readWalletsByAddresses(conn, arrOutputAddresses, function (arrWallets) {
        if (arrWallets.length === 0) {
            //	breadcrumbs.add("forwardPrivateChainsToOtherMembersOfOutputAddresses: " + JSON.stringify(arrChains)); // remove in livenet
            //	eventBus.emit('nonfatal_error', "not my wallet? output addresses: "+arrOutputAddresses.join(', '), new Error());
            //	throw Error("not my wallet? output addresses: "+arrOutputAddresses.join(', '));
        }
        var arrFuncs = [];
        if (arrWallets.length > 0)
            arrFuncs.push(function (cb) {
                walletDefinedByKeys.forwardPrivateChainsToOtherMembersOfWallets(arrChains, arrWallets, conn, cb);
            });
        arrFuncs.push(function (cb) {
            walletDefinedByAddresses.forwardPrivateChainsToOtherMembersOfAddresses(arrChains, arrOutputAddresses, conn, cb);
        });
        async.series(arrFuncs, onSaved);
    });
}



function readWalletsByAddresses(conn, arrAddresses, handleWallets) {
    conn.query("SELECT DISTINCT wallet FROM my_addresses WHERE address IN(?)", [arrAddresses], function (rows) {
        var arrWallets = rows.map(function (row) { return row.wallet; });
        conn.query("SELECT DISTINCT address FROM shared_address_signing_paths WHERE shared_address IN(?)", [arrAddresses], function (rows) {
            if (rows.length === 0)
                return handleWallets(arrWallets);
            var arrNewAddresses = rows.map(function (row) { return row.address; });
            readWalletsByAddresses(conn, arrNewAddresses, function (arrNewWallets) {
                handleWallets(_.union(arrWallets, arrNewWallets));
            });
        });
    });
}

/**
 * 根据walletId查找地址
 * @param walletId
 * @param cb
 */
function readAddressByWallet(walletId , cb) {
    db.query("select address from my_addresses where wallet = ?" ,[walletId] ,function (rows) {
        if(rows.length === 1) {
            cb(rows[0].address);
        }else {
            cb(false);
        }
    })
}

/**
 * 发送交易
 * @param opts
 * @param handleResult
 * @returns {Promise<*>}
 */
async function sendMultiPayment(opts, handleResult) {
    if(opts.name == "isHot") {
        //不做处理
    }else {
        opts.findAddressForJoint = findAddressForJoint;
        //判断发送方是否等于接收方，不允许发送给自己
        if (opts.change_address == opts.to_address) {
            return handleResult("to_address and from_address is same"
            );
        }
        //判断金额是否正常
        if (typeof opts.amount !== 'number')
            return handleResult('amount must be a number');
        if (opts.amount <= 0)
            return handleResult('amount must be positive');

    }
    //往共识网发送交易并更新数据库
    await composer.writeTran(opts, handleResult);
}

/**
 * 获取设备钱包信息
 * @param cb
 */
function getWalletsInfo(cb) {
    db.query("select address,wallet, (ifnull(sumto.total,0) - ifnull(sumfrom.total,0)) stable ,ifnull(sumto.total,0) receive , ifnull(sumfrom.total,0) sent from my_addresses  \n\
        left join  \n\
        ( select addressTo, sum(amount) total  from transactions where result='good' group by addressTo ) sumto on sumto.addressTo = my_addresses.address \n\
        left join \n\
        (select addressFrom ,sum(amount + fee) total from transactions where (result = 'good' or result = 'pending') and id <>'QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ' group by addressFrom) sumfrom \n\
        on my_addresses.address = sumfrom.addressFrom",function (result) {
        if(result.length > 0 ) {
            let trans = [];
            result.forEach(function(tran){
                trans.push({address : tran.address,
                    wallet  : tran.wallet,
                    stables  : tran.stable
                });
            });
            cb(trans);
        }else {
            cb(false);
        }
    })
}

// event emitted in two cases:
// 1. if I received private payloads via direct connection, not through a hub
// 2. (not true any more) received private payload from anywhere, didn't handle it immediately, saved and handled later
eventBus.on("new_direct_private_chains", forwardPrivateChainsToOtherMembersOfOutputAddresses);


function emitNewPrivatePaymentReceived(payer_device_address, arrChains, message_counter) {
    console.log('emitNewPrivatePaymentReceived');
    walletGeneral.readMyAddresses(function (arrAddresses) {
        var assocAmountsByAsset = {};
        var assocMyReceivingAddresses = {};
        arrChains.forEach(function (arrPrivateElements) {
            var objHeadPrivateElement = arrPrivateElements[0];
            var payload = objHeadPrivateElement.payload;
            var asset = payload.asset || 'base';
            if (!assocAmountsByAsset[asset])
                assocAmountsByAsset[asset] = 0;
            payload.outputs.forEach(function (output) {
                if (output.address && arrAddresses.indexOf(output.address) >= 0) {
                    assocAmountsByAsset[asset] += output.amount;
                    assocMyReceivingAddresses[output.address] = true;
                }
            });
            // indivisible
            var output = objHeadPrivateElement.output;
            if (output && output.address && arrAddresses.indexOf(output.address) >= 0) {
                assocAmountsByAsset[asset] += payload.outputs[objHeadPrivateElement.output_index].amount;
                assocMyReceivingAddresses[output.address] = true;
            }
        });
        console.log('assocAmountsByAsset', assocAmountsByAsset);
        var arrMyReceivingAddresses = Object.keys(assocMyReceivingAddresses);
        if (arrMyReceivingAddresses.length === 0)
            return;
        db.query("SELECT 1 FROM shared_addresses WHERE shared_address IN(?)", [arrMyReceivingAddresses], function (rows) {
            var bToSharedAddress = (rows.length > 0);
            for (var asset in assocAmountsByAsset)
                if (assocAmountsByAsset[asset])
                    eventBus.emit('received_payment', payer_device_address, assocAmountsByAsset[asset], asset, message_counter, bToSharedAddress);
        });
    });
}


async function findAddressForJoint(address) {
    let row = await db.first(
        "SELECT wallet, account, is_change, address_index,definition \n\
        FROM my_addresses JOIN wallets USING(wallet) \n\
        WHERE address=? ", address);
    return {
        definition: JSON.parse(row.definition),
        wallet: row.wallet,
        account: row.account,
        is_change: row.is_change,
        address_index: row.address_index
    };
}

function findAddress(address, signing_path, callbacks, fallback_remote_device_address) {
    db.query(
        "SELECT wallet, account, is_change, address_index, full_approval_date, device_address \n\
        FROM my_addresses JOIN wallets USING(wallet) JOIN wallet_signing_paths USING(wallet) \n\
        WHERE address=? AND signing_path=?",
        [address, signing_path],
        function (rows) {
            if (rows.length > 1)
                throw Error("more than 1 address found");
            if (rows.length === 1) {
                var row = rows[0];
                if (!row.full_approval_date)
                    return callbacks.ifError("wallet of address " + address + " not approved");
                if (row.device_address !== device.getMyDeviceAddress())
                    return callbacks.ifRemote(row.device_address);
                var objAddress = {
                    address: address,
                    wallet: row.wallet,
                    account: row.account,
                    is_change: row.is_change,
                    address_index: row.address_index
                };
                callbacks.ifLocal(objAddress);
                return;
            }
            db.query(
                //	"SELECT address, device_address, member_signing_path FROM shared_address_signing_paths WHERE shared_address=? AND signing_path=?",
                // look for a prefix of the requested signing_path
                "SELECT address, device_address, signing_path FROM shared_address_signing_paths \n\
                WHERE shared_address=? AND signing_path=SUBSTR(?, 1, LENGTH(signing_path))",
                [address, signing_path],
                function (sa_rows) {
                    if (rows.length > 1)
                        throw Error("more than 1 member address found for shared address " + address + " and signing path " + signing_path);
                    if (sa_rows.length === 0) {
                        if (fallback_remote_device_address)
                            return callbacks.ifRemote(fallback_remote_device_address);
                        return callbacks.ifUnknownAddress();
                    }
                    var objSharedAddress = sa_rows[0];
                    var relative_signing_path = 'r' + signing_path.substr(objSharedAddress.signing_path.length);
                    var bLocal = (objSharedAddress.device_address === device.getMyDeviceAddress()); // local keys
                    if (objSharedAddress.address === '') {
                        return callbacks.ifMerkle(bLocal);
                    } else if (objSharedAddress.address === 'secret') {
                        return callbacks.ifSecret();
                    }
                    findAddress(objSharedAddress.address, relative_signing_path, callbacks, bLocal ? null : objSharedAddress.device_address);
                }
            );
        }
    );
}

function readSharedBalance(wallet, handleBalance) {
    balances.readSharedBalance(wallet, function (assocBalances) {
        if (conf.bLight) { // make sure we have all asset definitions available
            var arrAssets = Object.keys(assocBalances).filter(function (asset) { return (asset !== 'base'); });
            if (arrAssets.length === 0)
                return handleBalance(assocBalances);
            network.requestProofsOfJointsIfNewOrUnstable(arrAssets, function () { handleBalance(assocBalances) });
        } else {
            handleBalance(assocBalances);
        }
    });
}

function readBalance(wallet, handleBalance) {
    balances.readBalance(wallet, function (assocBalances) {
        if (conf.bLight) { // make sure we have all asset definitions available
            var arrAssets = Object.keys(assocBalances).filter(function (asset) { return (asset !== 'base'); });
            if (arrAssets.length === 0)
                return handleBalance(assocBalances);
            network.requestProofsOfJointsIfNewOrUnstable(arrAssets, function () { handleBalance(assocBalances) });
        } else {
            handleBalance(assocBalances);
        }
    });
}

function readBalancesOnAddresses(walletId, handleBalancesOnAddresses) {
    db.query("SELECT outputs.address, COALESCE(outputs.asset, 'base') as asset, sum(outputs.amount) as amount \n\
	FROM outputs, my_addresses \n\
	WHERE outputs.address = my_addresses.address AND my_addresses.wallet = ? AND outputs.is_spent=0 \n\
	GROUP BY outputs.address, outputs.asset \n\
	ORDER BY my_addresses.address_index ASC", [walletId], function (rows) {
        handleBalancesOnAddresses(rows);
    });
}

function readAssetMetadata(arrAssets, handleMetadata) {
    var sql = "SELECT asset, metadata_unit, name, suffix, decimals FROM asset_metadata";
    if (arrAssets && arrAssets.length)
        sql += " WHERE asset IN (" + arrAssets.map(db.escape).join(', ') + ")";
    db.query(sql, function (rows) {
        var assocAssetMetadata = {};
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var asset = row.asset || "base";
            assocAssetMetadata[asset] = {
                metadata_unit: row.metadata_unit,
                decimals: row.decimals,
                name: row.suffix ? row.name + '.' + row.suffix : row.name
            };
        }
        handleMetadata(assocAssetMetadata);
        // after calling the callback, try to fetch missing data about assets
        if (!arrAssets)
            return;
        var updateAssets = conf.bLight ? network.requestProofsOfJointsIfNewOrUnstable : function (arrAssets, onDone) { onDone(); };
        updateAssets(arrAssets, function () { // make sure we have assets itself
            arrAssets.forEach(function (asset) {
                if (assocAssetMetadata[asset] || asset === 'base' && asset === constants.BLACKBYTES_ASSET)
                    return;
                if ((assocLastFailedAssetMetadataTimestamps[asset] || 0) > Date.now() - ASSET_METADATA_RETRY_PERIOD)
                    return;
                fetchAssetMetadata(asset, function (err, objMetadata) {
                    if (err)
                        return console.log(err);
                    assocAssetMetadata[asset] = {
                        metadata_unit: objMetadata.metadata_unit,
                        decimals: objMetadata.decimals,
                        name: objMetadata.suffix ? objMetadata.name + '.' + objMetadata.suffix : objMetadata.name
                    };
                    eventBus.emit('maybe_new_transactions');
                });
            });
        });
    });
}

function fetchAssetMetadata(asset, handleMetadata) {
    device.requestFromHub('hub/get_asset_metadata', asset, function (err, response) {
        if (err) {
            if (err === 'no metadata')
                assocLastFailedAssetMetadataTimestamps[asset] = Date.now();
            return handleMetadata("error from get_asset_metadata " + asset + ": " + err);
        }
        var metadata_unit = response.metadata_unit;
        var registry_address = response.registry_address;
        var suffix = response.suffix;
        if (!ValidationUtils.isStringOfLength(metadata_unit, constants.HASH_LENGTH))
            return handleMetadata("bad metadata_unit: " + metadata_unit);
        if (!ValidationUtils.isValidAddress(registry_address))
            return handleMetadata("bad registry_address: " + registry_address);
        var fetchMetadataUnit = conf.bLight
            ? function (onDone) {
                network.requestProofsOfJointsIfNewOrUnstable([metadata_unit], onDone);
            }
            : function (onDone) {
                onDone();
            };
        fetchMetadataUnit(function (err) {
            if (err)
                return handleMetadata("fetchMetadataUnit failed: " + err);
            storage.readJoint(db, metadata_unit, {
                ifNotFound: function () {
                    handleMetadata("metadata unit " + metadata_unit + " not found");
                },
                ifFound: function (objJoint) {
                    objJoint.unit.messages.forEach(function (message) {
                        if (message.app !== 'data')
                            return;
                        var payload = message.payload;
                        if (payload.asset !== asset)
                            return;
                        if (!payload.name)
                            return handleMetadata("no name in asset metadata " + metadata_unit);
                        var decimals = (payload.decimals !== undefined) ? parseInt(payload.decimals) : undefined;
                        if (decimals !== undefined && !ValidationUtils.isNonnegativeInteger(decimals))
                            return handleMetadata("bad decimals in asset metadata " + metadata_unit);
                        db.query(
                            "INSERT " + db.getIgnore() + " INTO asset_metadata (asset, metadata_unit, registry_address, suffix, name, decimals) \n\
							VALUES (?,?,?, ?,?,?)",
                            [asset, metadata_unit, registry_address, suffix, payload.name, decimals],
                            function () {
                                var objMetadata = {
                                    metadata_unit: metadata_unit,
                                    suffix: suffix,
                                    decimals: decimals,
                                    name: payload.name
                                };
                                handleMetadata(null, objMetadata);
                            }
                        );
                    });
                }
            });
        });
    });
}

function readTransactionHistory(wallet, handleHistory) {
    light.findTranList(wallet,function (cb) {
        return handleHistory(cb);
    })


}

// returns assoc array signing_path => (key|merkle)
function readFullSigningPaths(conn, address, arrSigningDeviceAddresses, handleSigningPaths) {

    var assocSigningPaths = {};

    function goDeeper(member_address, path_prefix, onDone) {
        // first, look for wallet addresses
        var sql = "SELECT signing_path FROM my_addresses JOIN wallet_signing_paths USING(wallet) WHERE address=?";
        var arrParams = [member_address];
        if (arrSigningDeviceAddresses && arrSigningDeviceAddresses.length > 0) {
            sql += " AND device_address IN(?)";
            arrParams.push(arrSigningDeviceAddresses);
        }
        conn.query(sql, arrParams, function (rows) {
            rows.forEach(function (row) {
                assocSigningPaths[path_prefix + row.signing_path.substr(1)] = 'key';
            });
            if (rows.length > 0)
                return onDone();
            // next, look for shared addresses, and search from there recursively
            sql = "SELECT signing_path, address FROM shared_address_signing_paths WHERE shared_address=?";
            arrParams = [member_address];
            if (arrSigningDeviceAddresses && arrSigningDeviceAddresses.length > 0) {
                sql += " AND device_address IN(?)";
                arrParams.push(arrSigningDeviceAddresses);
            }
            conn.query(sql, arrParams, function (rows) {
                if (rows.length > 0) {
                    async.eachSeries(
                        rows,
                        function (row, cb) {
                            if (row.address === '') { // merkle
                                assocSigningPaths[path_prefix + row.signing_path.substr(1)] = 'merkle';
                                return cb();
                            } else if (row.address === 'secret') {
                                assocSigningPaths[path_prefix + row.signing_path.substr(1)] = 'secret';
                                return cb();
                            }

                            goDeeper(row.address, path_prefix + row.signing_path.substr(1), cb);
                        },
                        onDone
                    );
                } else {
                    assocSigningPaths[path_prefix] = 'key';
                    onDone();
                }
            });
        });
    }

    goDeeper(address, 'r', function () {
        handleSigningPaths(assocSigningPaths); // order of signing paths is not significant
    });
}




function sendPaymentFromWallet(
    asset, wallet, to_address, amount, change_address, arrSigningDeviceAddresses, recipient_device_address, signWithLocalPrivateKey, handleResult) {
    sendMultiPayment({
        asset: asset,
        wallet: wallet,
        to_address: to_address,
        amount: amount,
        change_address: change_address,
        arrSigningDeviceAddresses: arrSigningDeviceAddresses,
        recipient_device_address: recipient_device_address,
        signWithLocalPrivateKey: signWithLocalPrivateKey
    }, handleResult);
}


function getSigner(opts, arrSigningDeviceAddresses, signWithLocalPrivateKey) {
    var bRequestedConfirmation = false;
    return {
        readSigningPaths: function (conn, address, handleLengthsBySigningPaths) { // returns assoc array signing_path => length
            readFullSigningPaths(conn, address, arrSigningDeviceAddresses, function (assocTypesBySigningPaths) {
                var assocLengthsBySigningPaths = {};
                for (var signing_path in assocTypesBySigningPaths) {
                    var type = assocTypesBySigningPaths[signing_path];
                    if (type === 'key')
                        assocLengthsBySigningPaths[signing_path] = constants.SIG_LENGTH;
                    else if (type === 'merkle') {
                        if (opts.merkle_proof)
                            assocLengthsBySigningPaths[signing_path] = opts.merkle_proof.length;
                    }
                    else if (type === 'secret') {
                        if (opts.secrets && opts.secrets[signing_path])
                            assocLengthsBySigningPaths[signing_path] = opts.secrets[signing_path].length;
                    }
                    else
                        throw Error("unknown type " + type + " at " + signing_path);
                }
                handleLengthsBySigningPaths(assocLengthsBySigningPaths);
            });
        },
        readDefinition: function (conn, address, handleDefinition) {
            conn.query(
                "SELECT definition FROM my_addresses WHERE address=? UNION SELECT definition FROM shared_addresses WHERE shared_address=?",
                [address, address],
                function (rows) {
                    if (rows.length !== 1)
                        throw Error("definition not found");
                    handleDefinition(null, JSON.parse(rows[0].definition));
                }
            );
        },
        sign: function (objUnsignedUnit, assocPrivatePayloads, address, signing_path, handleSignature) {
            var buf_to_sign = objectHash.getUnitHashToSign(objUnsignedUnit);
            findAddress(address, signing_path, {
                ifError: function (err) {
                    throw Error(err);
                },
                ifUnknownAddress: function (err) {
                    throw Error("unknown address " + address + " at " + signing_path);
                },
                ifLocal: function (objAddress) {
                    signWithLocalPrivateKey(objAddress.wallet, objAddress.account, objAddress.is_change, objAddress.address_index, buf_to_sign, function (sig) {
                        handleSignature(null, sig);
                    });
                },
                ifRemote: function (device_address) {
                    // we'll receive this event after the peer signs
                    eventBus.once("signature-" + device_address + "-" + address + "-" + signing_path + "-" + buf_to_sign.toString("base64"), function (sig) {
                        handleSignature(null, sig);
                        if (sig === '[refused]')
                            eventBus.emit('refused_to_sign', device_address);
                    });
                    console.log("delete walletGeneral.sendOfferToSign");
                    // walletGeneral.sendOfferToSign(device_address, address, signing_path, objUnsignedUnit, assocPrivatePayloads);
                    if (!bRequestedConfirmation) {
                        eventBus.emit("confirm_on_other_devices");
                        bRequestedConfirmation = true;
                    }
                },
                ifMerkle: function (bLocal) {
                    if (!bLocal)
                        throw Error("merkle proof at path " + signing_path + " should be provided by another device");
                    if (!opts.merkle_proof)
                        throw Error("merkle proof at path " + signing_path + " not provided");
                    handleSignature(null, opts.merkle_proof);
                },
                ifSecret: function () {
                    if (!opts.secrets || !opts.secrets[signing_path])
                        throw Error("secret " + signing_path + " not found");
                    handleSignature(null, opts.secrets[signing_path])
                }
            });
        }
    }
}




function forwardPrivateChainsToOtherMembersOfSharedAddresses(arrChainsOfCosignerPrivateElements, arrPayingAddresses, excluded_device_address, bForwarded, conn, onDone) {
    walletDefinedByAddresses.readAllControlAddresses(conn, arrPayingAddresses, function (arrControlAddresses, arrControlDeviceAddresses) {
        arrControlDeviceAddresses = arrControlDeviceAddresses.filter(function (device_address) {
            return (device_address !== device.getMyDeviceAddress() && device_address !== excluded_device_address);
        });
        walletDefinedByKeys.readDeviceAddressesControllingPaymentAddresses(conn, arrControlAddresses, function (arrMultisigDeviceAddresses) {
            arrMultisigDeviceAddresses = _.difference(arrMultisigDeviceAddresses, arrControlDeviceAddresses);
            // counterparties on shared addresses must forward further, that's why bForwarded=false
            console.log("delete walletGeneral.forwardPrivateChainsToDevices");
            // walletGeneral.forwardPrivateChainsToDevices(arrControlDeviceAddresses, arrChainsOfCosignerPrivateElements, bForwarded, conn, function () {
            //     walletGeneral.forwardPrivateChainsToDevices(arrMultisigDeviceAddresses, arrChainsOfCosignerPrivateElements, true, conn, onDone);
            // });
        });
    });
}



function expandMnemonic(mnemonic) {
    var addrInfo = {};
    mnemonic = mnemonic.toLowerCase().split('-').join(' ');
    if ((mnemonic.split(' ').length % 3 !== 0) || !Mnemonic.isValid(mnemonic)) {
        throw new Error("invalid mnemonic: " + mnemonic);
    }
    mnemonic = new Mnemonic(mnemonic);
    addrInfo.xPrivKey = mnemonic.toHDPrivateKey().derive("m/44'/0'/0'/0/0");
    addrInfo.pubkey = addrInfo.xPrivKey.publicKey.toBuffer().toString("base64");
    addrInfo.definition = ["sig", { "pubkey": addrInfo.pubkey }];
    addrInfo.address = objectHash.getChash160(addrInfo.definition);
    return addrInfo;
}

function receiveTextCoin(mnemonic, addressTo, cb) {
    try {
        var addrInfo = expandMnemonic(mnemonic);
    } catch (e) {
        cb(e.message);
        return;
    }
    var signer = {
        readSigningPaths: function (conn, address, handleLengthsBySigningPaths) { // returns assoc array signing_path => length
            var assocLengthsBySigningPaths = {};
            assocLengthsBySigningPaths["r"] = constants.SIG_LENGTH;
            handleLengthsBySigningPaths(assocLengthsBySigningPaths);
        },
        readDefinition: function (conn, address, handleDefinition) {
            handleDefinition(null, addrInfo.definition);
        },
        sign: function (objUnsignedUnit, assocPrivatePayloads, address, signing_path, handleSignature) {
            handleSignature(null, ecdsaSig.sign(objectHash.getUnitHashToSign(objUnsignedUnit), addrInfo.xPrivKey.privateKey.bn.toBuffer({ size: 32 })));
        }
    };
    var opts = {};
    var asset = null;
    opts.signer = signer;
    opts.paying_addresses = [addrInfo.address];
    opts.spend_unconfirmed = 'all';

    opts.callbacks = {
        ifNotEnoughFunds: function (err) {
            cb("This textcoin was already claimed");
        },
        ifError: function (err) {
            if (err.indexOf("some definition changes") == 0)
                return cb("This textcoin was already claimed but not confirmed yet");
            cb(err);
        },
        ifOk: function (objJoint, arrChainsOfRecipientPrivateElements, arrChainsOfCosignerPrivateElements) {
            network.broadcastJoint(objJoint);
            cb(null, objJoint.unit.unit, asset);
        }
    };

    if (conf.bLight) {
        db.query(
            "SELECT 1 \n\
            FROM outputs JOIN units USING(unit) WHERE address=? LIMIT 1",
            [addrInfo.address],
            function (rows) {
                if (rows.length === 0) {
                    network.requestHistoryFor([], [addrInfo.address], checkStability);
                }
                else
                    checkStability();
            }
        );
    }
    else
        checkStability();

    // check stability of payingAddresses
    function checkStability() {
        db.query(
            "SELECT is_stable, asset, is_spent, SUM(amount) as `amount` \n\
            FROM outputs JOIN units USING(unit) WHERE address=? AND sequence='good' GROUP BY asset ORDER BY asset DESC, is_spent ASC LIMIT 1",
            [addrInfo.address],
            function (rows) {
                if (rows.length === 0) {
                    cb("This payment doesn't exist in the network");
                } else {
                    var row = rows[0];
                    if (false && !row.is_stable) {
                        cb("This payment is not confirmed yet, try again later");
                    } else {
                        if (row.asset) { // claiming asset
                            opts.asset = row.asset;
                            opts.amount = row.amount;
                            opts.fee_paying_addresses = [addrInfo.address];
                            storage.readAsset(db, row.asset, null, function (err, objAsset) {
                                if (err && err.indexOf("not found" !== -1)) {
                                    if (!conf.bLight) // full wallets must have this asset
                                        throw Error("textcoin asset " + row.asset + " not found");
                                    return network.requestHistoryFor([opts.asset], [], checkStability);
                                }
                                asset = opts.asset;
                                opts.to_address = addressTo;
                                if (objAsset.fixed_denominations) { // indivisible
                                    opts.tolerance_plus = 0;
                                    opts.tolerance_minus = 0;
                                    indivisibleAsset.composeAndSaveIndivisibleAssetPaymentJoint(opts);
                                }
                                else { // divisible
                                    divisibleAsset.composeAndSaveDivisibleAssetPaymentJoint(opts);
                                }
                            });
                        } else {// claiming bytes
                            opts.send_all = true;
                            opts.outputs = [{ address: addressTo, amount: 0 }];
                            opts.callbacks = composer.getSavingCallbacks(opts.callbacks);
                            composer.composeJoint(opts);
                        }
                    }
                }
            }
        );
    }
}

// if a textcoin was not claimed for 'days' days, claims it back
function claimBackOldTextcoins(to_address, days) {
    db.query(
        "SELECT mnemonic FROM sent_mnemonics LEFT JOIN unit_authors USING(address) \n\
        WHERE mnemonic!='' AND unit_authors.address IS NULL AND creation_date<"+ db.addTime("-" + days + " DAYS"),
        function (rows) {
            async.eachSeries(
                rows,
                function (row, cb) {
                    receiveTextCoin(row.mnemonic, to_address, function (err, unit, asset) {
                        if (err)
                            console.log("failed claiming back old textcoin " + row.mnemonic + ": " + err);
                        else
                            console.log("claimed back mnemonic " + row.mnemonic + ", unit " + unit + ", asset " + asset);
                        cb();
                    });
                }
            );
        }
    );
}

function eraseTextcoin(unit, address) {
    db.query(
        "UPDATE sent_mnemonics \n\
        SET mnemonic='' WHERE unit=? AND address=?",
        [unit, address],
        function () { }
    );
}

function storePrivateAssetPayload(fullPath, cordovaPathObj, mnemonic, chains, cb) {
    var storedObj = {
        mnemonic: mnemonic,
        chains: chains
    };
    var bCordova = (typeof window === 'object' && window.cordova);
    var JSZip = require("jszip");
    var zip = new JSZip();
    zip.file('private_textcoin', JSON.stringify(storedObj));
    var zipParams = { type: "nodebuffer", compression: 'DEFLATE', compressionOptions: { level: 9 } };
    zip.generateAsync(zipParams).then(function (zipFile) {
        if (!bCordova) {
            var fs = require('fs' + '');
            fs.writeFile(fullPath, zipFile, cb);
        } else {
            window.requestFileSystem(LocalFileSystem.TEMPORARY, 0, function (fs) {
                window.resolveLocalFileSystemURL(cordovaPathObj.root, function (dirEntry) {
                    dirEntry.getDirectory(cordovaPathObj.path, { create: true, exclusive: false }, function (dirEntry1) {
                        dirEntry1.getFile(cordovaPathObj.fileName, { create: true, exclusive: false }, function (file) {
                            file.createWriter(function (writer) {
                                writer.onwriteend = function () {
                                    cb(null);
                                };
                                writer.write(zipFile.buffer);
                            }, cb);
                        }, cb);
                    }, cb);
                }, cb);
            }, cb);
        }
    }, cb);
}

function handlePrivatePaymentFile(fullPath, content, cb) {
    var bCordova = (typeof window === 'object' && window.cordova);
    var JSZip = require("jszip");
    var zip = new JSZip();

    var unzip = function (err, data) {
        if (err)
            return cb(err);
        zip.loadAsync(data).then(function (zip) {
            zip.file("private_textcoin").async("string").then(function (data) {
                try {
                    data = JSON.parse(data);
                    var first_chain_unit = data.chains[0][0].unit;
                } catch (err) { return cb(err); }
                device.getHubWs(function (err, ws) {
                    if (err)
                        return cb("no hub connection, try again later:" + err);
                    eventBus.once('all_private_payments_handled-' + first_chain_unit, function () {
                        cb(null, data);
                    });
                    var onDone = function () {
                        handlePrivatePaymentChains(ws, data, null, {
                            ifError: function (err) {
                                cb(err);
                            },
                            ifOk: function () { } // we subscribe to event, not waiting for callback
                        });
                    }
                    // for light wallets request history for mnemonic address, check if already spent
                    if (conf.bLight) {
                        try {
                            var addrInfo = expandMnemonic(data.mnemonic);
                        } catch (e) {
                            return cb(e);
                        }
                        var history_requested = false;
                        var checkAddressTxs = function () {
                            db.query(
                                "SELECT 'in' AS 'action' \n\
                                FROM outputs JOIN units USING(unit) WHERE address=? \n\
                                UNION \n\
                                SELECT 'out' AS 'action' \n\
                                FROM inputs JOIN units USING(unit) WHERE address=?",
                                [addrInfo.address, addrInfo.address],
                                function (rows) {
                                    var actions_count = _.countBy(rows, function (v) { return v.action });
                                    if (rows.length === 0 && !history_requested) {
                                        history_requested = true;
                                        network.requestHistoryFor([], [addrInfo.address], checkAddressTxs);
                                    }
                                    else if (actions_count['in'] === 1 && actions_count['out'] === 1) {
                                        cb("textcoin was already claimed");
                                    } else onDone();
                                }
                            );
                        };
                        checkAddressTxs();
                    } else onDone();
                });
            }).catch(function (err) { cb(err) });
        }).catch(function (err) { cb(err) });
    }

    if (content) {
        unzip(null, content);
        return;
    }

    if (!bCordova) {
        var fs = require('fs' + '');
        fs.readFile(decodeURIComponent(fullPath.replace('file://', '')), unzip);
    } else {
        window.requestFileSystem(LocalFileSystem.TEMPORARY, 0, function (fs) {
            if (fullPath.indexOf('://') == -1) fullPath = 'file://' + fullPath;
            window.resolveLocalFileSystemURL(fullPath, function (fileEntry) {
                fileEntry.file(function (file) {
                    var reader = new FileReader();
                    reader.onloadend = function () {
                        if (this.result == null) {
                            var permissions = cordova.plugins.permissions;
                            permissions.requestPermission(permissions.READ_EXTERNAL_STORAGE, function (status) {
                                if (status.hasPermission) {
                                    handlePrivatePaymentFile(fullPath, null, cb);
                                } else {
                                    cb("no file permissions were given");
                                }
                            }, function () { cb("request for file permissions failed") });
                            return;
                        }
                        var fileBuffer = Buffer.from(new Uint8Array(this.result));
                        unzip(null, fileBuffer);
                    };
                    reader.readAsArrayBuffer(file);
                }, cb);
            }, cb);
        }, cb);
    }
}

function readDeviceAddressesUsedInSigningPaths(onDone) {

    var sql = "SELECT DISTINCT device_address FROM shared_address_signing_paths ";
    sql += "UNION SELECT DISTINCT device_address FROM wallet_signing_paths ";
    sql += "UNION SELECT DISTINCT device_address FROM pending_shared_address_signing_paths";

    db.query(
        sql,
        function (rows) {

            var arrDeviceAddress = rows.map(function (r) { return r.device_address; });

            onDone(arrDeviceAddress);
        }
    );
}

function determineIfDeviceCanBeRemoved(device_address, handleResult) {
    device.readCorrespondent(device_address, function (correspondent) {
        if (!correspondent)
            return handleResult(false);
        readDeviceAddressesUsedInSigningPaths(function (arrDeviceAddresses) {
            handleResult(arrDeviceAddresses.indexOf(device_address) === -1);
        });
    });
};


function signMessage(from_address, message, arrSigningDeviceAddresses, signWithLocalPrivateKey, handleResult) {
    var signer = getSigner({}, arrSigningDeviceAddresses, signWithLocalPrivateKey);
    composer.signMessage(from_address, message, signer, handleResult);
}






exports.sendSignature = sendSignature;
exports.readSharedBalance = readSharedBalance;
exports.readBalance = readBalance;
exports.readBalancesOnAddresses = readBalancesOnAddresses;
exports.readAssetMetadata = readAssetMetadata;
exports.readTransactionHistory = readTransactionHistory;
exports.sendPaymentFromWallet = sendPaymentFromWallet;
exports.sendMultiPayment = sendMultiPayment;
exports.readDeviceAddressesUsedInSigningPaths = readDeviceAddressesUsedInSigningPaths;
exports.determineIfDeviceCanBeRemoved = determineIfDeviceCanBeRemoved;
exports.receiveTextCoin = receiveTextCoin;
exports.claimBackOldTextcoins = claimBackOldTextcoins;
exports.eraseTextcoin = eraseTextcoin;
exports.getSigner = getSigner;
exports.signMessage = signMessage;
exports.storePrivateAssetPayload = storePrivateAssetPayload;
exports.handlePrivatePaymentFile = handlePrivatePaymentFile;
exports.getWalletsInfo = getWalletsInfo ;
exports.readAddressByWallet = readAddressByWallet;