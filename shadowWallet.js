/*jslint node: true */
"use strict";

var verificationQRCode;
var signatureCode;
var signatureDetlCode;

var db = require('./db');
var crypto = require("crypto");

//生成冷钱包
exports.getVerificationQRCode = function(address){
    var pub;
    db.query("SELECT extended_pubkey FROM extended_pubkeys LEFT  JOIN  my_addresses on extended_pubkeys.wallet=my_addresses.wallet where my_addresses.address=?",
        [address],
        function (result) {
            if(result == 1)
                pub = result[0].extended_pubkey;
    });

    var random = crypto.random(6);

    verificationQRCode =
    "{\n" +
    "    \"type\": \"shadow\",\n" +
    "    \"name\": \"shadow\",\n" +
    "    \"pub\": \""+ pub +"\",\n" +
    "    \"num\": 0,\n" +
    "    \"random\": 5339\n" +
    "}\n";

    return verificationQRCode;
};


//生成授权签名
exports.getSignatureCode = function(verificationQRCode){

    signatureCode =
        "{\n" +
        "    \"name\": \"shadow\",\n" +
        "    \"type\": \"sign\",\n" +
        "    \"addr\": \"4VT3FOIUHX4AZZDTBJDP7EV3CGVIB3GB\",\n" +
        "    \"random\": 5339\n" +
        "}\n";


    return signatureCode;
};

//生成授权签名详情
exports.getSignatureDetlCode = function(signatureCode){

    signatureDetlCode =
        "{\n" +
        "    \"name\": \"shadow\",\n" +
        "    \"type\": \"signDetl\",\n" +
        "    \"signature\": \"QPP1enI5vc6hzFigAPNCUDQYfuvNzQk6A9uhtTDGr00pJte9Fsri4FEIbLIfKni9oY1/FdPaq6lT\\r\\ny+CfO+ckyQ==\",\n" +
        "    \"random\": 5339\n" +
        "}\n";

    return signatureDetlCode;
};



//生成授权签名详情
exports.generateShadowWallet = function(){
    var flag = true;


    return flag;
};


