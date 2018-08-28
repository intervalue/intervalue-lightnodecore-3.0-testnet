/*jslint node: true */
"use strict";

var getSourceString = require('./string_utils').getSourceString;
var Mnemonic = require('bitcore-mnemonic');
var Bitcore = require('bitcore-lib');

var crypto = require('crypto');
var objectHash = require('./object_hash.js');
var signature = require('./signature');


var signatureCode;
var signatureDetlCode;

var RANDOM;


//热钱包 生成授权签名-扫描地址
exports.getSignatureCode = function(address,cb){

    RANDOM = crypto.randomBytes(4).toString("hex");
    // random = 'ac4ca8';
    console.log(RANDOM);
    // var db = require("./db");
    // db.query("",[],function () {
    //
    // });
    signatureCode =
        {
            "name":"shadow",
            "type":"sign",
            "addr":""+address+"",
            "random":RANDOM
        };

    return cb(signatureCode);
};

//冷钱包  生成授权签名详情
exports.getSignatureDetlCode = function(signatureCode,words, cb){
    var json;
    switch(typeof signatureCode) {
        case "string":
            json = JSON.parse(signatureCode);
            break;
        case "object":
            json = signatureCode;
            break;
        default:
            cb(false);
            break;
    }

    var buf_to_sign = crypto.createHash("sha256").update(getSourceString(json), "utf8").digest();

    console.log(buf_to_sign.toString("hex"));
    var mnemonic = new Mnemonic(words);
    var xPrivKey = mnemonic.toHDPrivateKey("");


    var path = "m/44'/0'/0'/0/0";
    var privateKey = xPrivKey.derive(path).privateKey.bn.toBuffer({size:32});
    var sign_64 = signature.sign(buf_to_sign, privateKey);

    var path2 = "m/44'/0'/0'";
    var privateKey2 = xPrivKey.derive(path2);
    var xpubkey = Bitcore.HDPublicKey(privateKey2).xpubkey;

    var pubkey = derivePubkey(xpubkey ,"m/0/0");

    signatureDetlCode =
        {
          "name":"shadow",
          "type":"signDetl",
          "signature":""+sign_64+"",
          "random":""+json.random+"",
          "expub":""+ xpubkey +"",
          "addr":json.addr,
          "pubkey":pubkey
        };

    return cb(signatureDetlCode);
};
function derivePubkey(xPubKey, path) {
    var hdPubKey = new Bitcore.HDPublicKey(xPubKey);
    return hdPubKey.derive(path).publicKey.toBuffer().toString("base64");
}


//生成热钱包
exports.generateShadowWallet = function(signatureDetlCode,cb){
    if(!RANDOM) {
        return cb("random failed");
    }
    var json;
    switch(typeof signatureDetlCode) {
        case "string":
            json = JSON.parse(signatureDetlCode);
            break;
        case "object":
            json = signatureDetlCode;
            break;
        default:
            cb(false);
            break;
    }
    if(RANDOM != json.random) {
        return cb("random failed");
    }

    var addr = json.addr;
    var sign = json.signature;
    var xpub = json.expub;
    var pubkey = json.pubkey;
    var result = {
        'addr':addr,
        'sign':sign,
        'xpub':xpub,
        'pubkey':pubkey
    };


    var buf_to_sign = crypto.createHash("sha256").update(getSourceString(signatureCode), "utf8").digest();

    var pub1 = signature.recover(buf_to_sign,sign,1).toString("base64");
    var pub2 = signature.recover(buf_to_sign,sign,0).toString("base64");
    var definition1 = ["sig",{"pubkey":pub1}];
    var definition2 = ["sig",{"pubkey":pub2}];
    var address1 = objectHash.getChash160(definition1);
    var address2 = objectHash.getChash160(definition2);
    // var flag = false;

    if(address1 === addr  || address2 == addr) {
        cb(result);
    } else
        cb(false);



};


//查找钱包
exports.getWallets = function (cb) {
    var data = [];

    var db = require('./db');
    db.query("select address,wallet from my_addresses",function (result) {
        if(result.length > 0) {
            var n = 1;
            result.forEach(function(r) {
                var addr = r.address;
                var wallet = r.wallet;
                var obj = {
                    "name": n++,
                    "addr":addr,
                    "amount":0,
                    "walletId":wallet
                };

                data.push(obj);
            });
            cb(data);
        }
    });
};








