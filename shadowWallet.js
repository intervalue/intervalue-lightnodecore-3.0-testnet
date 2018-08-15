/*jslint node: true */
"use strict";



var objectHash = require('./object_hash.js');
var sign = require('./signature');
var crypto = require('crypto');
var getSourceString = require('./string_utils').getSourceString;
var Mnemonic = require('bitcore-mnemonic');
var Bitcore = require('bitcore-lib');


var verificationQRCode;
var signatureCode;
var signatureDetlCode;


//冷钱包 生成热钱包
exports.getVerificationQRCode = function(address ,cb){
    var db = require('./db');
    db.query("SELECT definition FROM my_addresses where address = ?",
        [address],
        function (result) {
            if(result.length == 1) {
                var definition = result[0].definition;

                var definitionJSN = JSON.parse(definition.toString());
                var pub = definitionJSN[1].pubkey;

                var random = crypto.randomBytes(4).toString("hex");

                var num = 0;

                verificationQRCode =
                    {
                        "type":"shadow",
                        "name":"shadow",
                        "pub":""+ pub +"",
                        "num":num,
                        "random":""+random+""
                    };

                return cb(verificationQRCode);
            }else {
                console.error("query failed~!");
                return cb(false);
            }
        });
};

//热钱包 生成授权签名
exports.getSignatureCode = function(verificationQRCode,cb){
    var json;
    switch(typeof verificationQRCode) {
        case "string":
            json = JSON.parse(verificationQRCode);
            break;
        case "object":
            json = verificationQRCode;
            break;
        default:
            cb(false);
            break;
    }
    var definition = ["sig",{"pubkey":json.pub}];
    var address = objectHash.getChash160(definition);


    signatureCode =
        {
            "name":"shadow",
            "type":"sign",
            "addr":""+address+"",
            "random":""+json.random+""
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


    var mnemonic = new Mnemonic(words);
    var xPrivKey = mnemonic.toHDPrivateKey("");


    var path = "m/44'/0'/0'/0/0";
    var privateKey = xPrivKey.derive(path).privateKey.bn.toBuffer({size:32});
    var signature = sign.sign(buf_to_sign, privateKey);

    var path2 = "m/44'/0'/0'";
    var privateKey2 = xPrivKey.derive(path2);
    var xpubkey = Bitcore.HDPublicKey(privateKey2).xpubkey;

    signatureDetlCode =
        {
          "name":"shadow",
          "type":"signDetl",
          "signature":""+signature+"",
          "random":""+json.random+"",
          "expub":""+ xpubkey +""
        };

    return cb(signatureDetlCode);
};



//生成热钱包
exports.generateShadowWallet = function(signatureDetlCode,cb){
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

    var sign = json.signature;
    var pub = verificationQRCode.pub;

    var buf_to_sign = crypto.createHash("sha256").update(getSourceString(signatureCode), "utf8").digest();

    var flag = signature.verify(buf_to_sign,sign,pub);


    return cb(flag);
};

