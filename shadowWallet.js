/*jslint node: true */
"use strict";

var verificationQRCode;
var signatureCode;
var signatureDetlCode;


var objectHash = require('./object_hash.js');
var sign = require('./signature');
var crypto = require('crypto');
var getSourceString = require('./string_utils').getSourceString;

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
                    "{\n" +
                    "    \"type\":\"shadow\",\n" +
                    "    \"name\":\"shadow\",\n" +
                    "    \"pub\":\""+ pub +"\",\n" +
                    "    \"num\":"+num+",\n" +
                    "    \"random\":\""+random+"\"\n" +
                    "}\n";

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
        "{\n" +
        "    \"name\":\"shadow\",\n" +
        "    \"type\":\"sign\",\n" +
        "    \"addr\":\""+address+"\",\n" +
        "    \"random\":\""+json.random+"\"\n" +
        "}\n";


    return cb(signatureCode);
};

//生成授权签名详情
exports.getSignatureDetlCode = function(signatureCode,xPriKey, cb){
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

    var signature = sign.sign(buf_to_sign, xPriKey);


    signatureDetlCode =
        "{\n" +
        "    \"name\":\"shadow\",\n" +
        "    \"type\":\"signDetl\",\n" +
        "    \"signature\":\""+signature+"\",\n" +
        "    \"random\":\""+json.random+"\"\n" +
        "}\n";

    return cb(signatureDetlCode);
};



//生成热钱包
exports.generateShadowWallet = function(signatureDetlCode,cb){
    var flag = true;


    return cb(flag);
};


