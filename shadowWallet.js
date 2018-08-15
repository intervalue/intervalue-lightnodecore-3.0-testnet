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


//生成冷钱包
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

//生成授权签名
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
    //
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

//生成授权签名详情
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


    signatureDetlCode =
        {
          "name":"shadow",
          "type":"signDetl",
          "signature":""+signature+"",
          "random":""+json.random+""
        };

    return cb(signatureDetlCode);
};



//生成热钱包
exports.generateShadowWallet = function(signatureDetlCode,cb){
    var flag = true;


    return cb(flag);
};


function derivePubkey(xPubKey, path){
    var hdPubKey = new Bitcore.HDPublicKey(xPubKey);
    var hdPubKeybuf = hdPubKey.toBuffer();
    var pubkey = hdPubKey.derive(path).publicKey.toBuffer({size:32});

    return hdPubKey.derive(path).publicKey.toBuffer().toString("base64");
}