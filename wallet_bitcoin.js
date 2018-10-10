/*jslint node: true */
"use strict";

var Mnemonic = require('bitcore-mnemonic');
var crypto = require('crypto');
var ecdsaSig = require('./signature');
var Bitcore = require('bitcore-lib');
var base58 = require('base-58');


var version = new Buffer([0x00]);
/**
 *  生成比特币钱包地址
 * @param xprikey 扩展主私钥
 * @param acount
 * @param change
 * @param address_index
 *
 * m / purpose' / coin_type' / account' / change / address_index
 */
function getBitAddress(xprikey,account,change,address_index) {
    var hdPriKey = Bitcore.HDPrivateKey.fromString(xprikey);
    var path = "m/44'/0'/"+ account +"'/"+ change +"/"+ address_index;
    var publicKey = hdPriKey.derive(path);
    var pubkey = publicKey.toBuffer();

    var s = crypto.createHash("sha256").update(pubkey).digest();
    var payload = crypto.createHash("ripemd160").update(s).digest();

    var vp = Buffer.concat([version,payload] ,version.length + payload.length);

    var checksum = crypto.createHash("sha256").update(crypto.createHash("sha256").update(vp).digest()).digest();
    var vpc = Buffer.concat([vp,checksum.slice(0,4)] , vp.length+4);

    var address =  base58.encode(vpc);;
    return address;
};




exports.getBitAddress = getBitAddress;