/*jslint node: true */
"use strict";

var verificationQRCode;
var signatureCode;
var signatureDetlCode;

var db = require('./db');
var rdm = require('crypto');
var objectHash = require('./object_hash.js');

//生成冷钱包
exports.getVerificationQRCode = function(address ,cb){
    db.query("SELECT definition FROM my_addresses where address = ?",
        [address],
        function (result) {
            if(result.length == 1) {
                var definition = result[0].definition;

                var definitionJSN = JSON.parse(definition.toString());
                var pub = definitionJSN[1].pubkey;

                var random = rdm.randomBytes(4).toString("hex");

                var num = 0;

                verificationQRCode =
                    "{\n" +
                    "    \"type\":\"shadow\",\n" +
                    "    \"name\":\"shadow\",\n" +
                    "    \"pub\":\""+ pub +"\",\n" +
                    "    \"num\":"+num+",\n" +
                    "    \"random\":"+random+"\n" +
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
    var json = JSON.parse(verificationQRCode.toString());
    var definition = "['sign','pubkey':'"+ json.pub +"'}";
    var address = objectHash.getChash160(definition);


    var random = rdm.randomBytes(4).toString("hex");
    signatureCode =
        "{\n" +
        "    \"name\":\"shadow\",\n" +
        "    \"type\":\"sign\",\n" +
        "    \"addr\":\""+address+"\",\n" +
        "    \"random\":"+random+"\n" +
        "}\n";


    return cb(signatureCode);
};

//生成授权签名详情
exports.getSignatureDetlCode = function(signatureCode , cb){


    var random = rdm.randomBytes(4).toString("hex");

    signatureDetlCode =
        "{\n" +
        "    \"name\":\"shadow\",\n" +
        "    \"type\":\"signDetl\",\n" +
        "    \"signature\":\"QPP1enI5vc6hzFigAPNCUDQYfuvNzQk6A9uhtTDGr00pJte9Fsri4FEIbLIfKni9oY1/FdPaq6lT\\r\\ny+CfO+ckyQ==\",\n" +
        "    \"random\":"+random+"\n" +
        "}\n";

    return cb(signatureDetlCode);
};



//生成授权签名详情
exports.generateShadowWallet = function(cb){
    var flag = true;


    return cb(flag);
};


