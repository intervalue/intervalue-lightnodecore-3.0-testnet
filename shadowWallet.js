/*jslint node: true */
"use strict";

var verificationQRCode;
var signatureCode;
var signatureDetlCode;

var db = require('./db');
var rdm = require('crypto');

//生成冷钱包
exports.getVerificationQRCode = function(address ,cb){
    db.query("SELECT definition FROM my_addresses where address = ?",
        [address],
        function (result) {
            if(result.length == 1) {
                var definition = result[0].extended_pubkey;

                var definitionJSN = JSON.parse(definition);
                var pub = definitionJSN.pubkey;


                var random = rdm.randomBytes(4).toString("hex");

                verificationQRCode =
                    "{\n" +
                    "    \"type\":\"shadow\",\n" +
                    "    \"name\":\"shadow\",\n" +
                    "    \"pub\":\""+ pub +"\",\n" +
                    "    \"num\":0,\n" +
                    "    \"random\":"+random+"\n" +
                    "}\n";

                return cb(verificationQRCode);
            }else {
                console.error("query failed~!");
                return cb(false);
            }

    });

};

function derivePubkey(xPubKey, path){
    var hdPubKey = new Bitcore.HDPublicKey(xPubKey);
    var hdPubKeybuf = hdPubKey.toBuffer();
    var pubkey = hdPubKey.derive(path).publicKey.toBuffer();

    return hdPubKey.derive(path).publicKey.toBuffer().toString("base64");
}

//生成授权签名
exports.getSignatureCode = function(verificationQRCode,cb){



    var random = rdm.randomBytes(4).toString("hex");
    signatureCode =
        "{\n" +
        "    \"name\":\"shadow\",\n" +
        "    \"type\":\"sign\",\n" +
        "    \"addr\":\"4VT3FOIUHX4AZZDTBJDP7EV3CGVIB3GB\",\n" +
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


