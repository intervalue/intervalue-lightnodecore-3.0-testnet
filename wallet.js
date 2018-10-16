/*jslint node: true */
"use strict";
var async = require('async');
var _ = require('lodash');
var db = require('./db.js');
var constants = require('./constants.js');
var conf = require('./conf.js');
var objectHash = require('./object_hash.js');
var network = require('./network.js');
var storage = require('./storage.js');
var device = require('./device.js');
var eventBus = require('./event_bus.js');
var ValidationUtils = require("./validation_utils.js");
var composer = require('./composer.js');
var balances = require('./balances');
var light = require('./light.js');
var assocLastFailedAssetMetadataTimestamps = {};
var ASSET_METADATA_RETRY_PERIOD = 3600 * 1000;



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
        if(result != null && result.length > 0 ) {
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

function signMessage(from_address, message, arrSigningDeviceAddresses, signWithLocalPrivateKey, handleResult) {
    var signer = getSigner({}, arrSigningDeviceAddresses, signWithLocalPrivateKey);
    composer.signMessage(from_address, message, signer, handleResult);
}




exports.readSharedBalance = readSharedBalance;
exports.readBalance = readBalance;
exports.readAssetMetadata = readAssetMetadata;
exports.readTransactionHistory = readTransactionHistory;
exports.sendMultiPayment = sendMultiPayment;
exports.signMessage = signMessage;
exports.getWalletsInfo = getWalletsInfo ;
exports.readAddressByWallet = readAddressByWallet;