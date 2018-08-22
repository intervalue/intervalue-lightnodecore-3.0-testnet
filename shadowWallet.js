/*jslint node: true */
"use strict";

var getSourceString = require('./string_utils').getSourceString;
var Mnemonic = require('bitcore-mnemonic');
var Bitcore = require('bitcore-lib');

var crypto = require('crypto');
var objectHash = require('./object_hash.js');
var signature = require('./signature');


var verificationQRCode;
var signatureCode;
var signatureDetlCode;


//冷钱包 生成热钱包（接口暂时没用）
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
exports.getSignatureCode = function(address,cb){
    // var json;
    // switch(typeof verificationQRCode) {
    //     case "string":
    //         json = JSON.parse(verificationQRCode);
    //         break;
    //     case "object":
    //         json = verificationQRCode;
    //         break;
    //     default:
    //         cb(false);
    //         break;
    // }
    // var definition = ["sig",{"pubkey":json.pub}];
    // var address = objectHash.getChash160(definition);

    var random = crypto.randomBytes(4).toString("hex");
    signatureCode =
        {
            "name":"shadow",
            "type":"sign",
            "addr":""+address+"",
            "random":""+random+""
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
    var sign_64 = signature.sign(buf_to_sign, privateKey);

    var path2 = "m/44'/0'/0'";
    var privateKey2 = xPrivKey.derive(path2);
    var xpubkey = Bitcore.HDPublicKey(privateKey2).xpubkey;

    signatureDetlCode =
        {
          "name":"shadow",
          "type":"signDetl",
          "signature":""+sign_64+"",
          "random":""+json.random+"",
          "expub":""+ xpubkey +"",
          "addr":json.addr
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
    var addr = json.addr;
    var sign = json.signature;
    var xpub = json.expub;

    var buf_to_sign = crypto.createHash("sha256").update(getSourceString(signatureCode), "utf8").digest();

    var pub = signature.recover(buf_to_sign,sign,1).toString("base64");
    var definition = ["sig",{"pubkey":pub}];
    var address = objectHash.getChash160(definition);
    var flag = false;

    if(address == addr) {
        flag = true;
    }

    // flag = signature.verify(buf_to_sign,sign,pub);


    createWallet(xpub, function(){
        console.log("创建成功");
    });

    return cb(flag);
};


//交易签名

//創建錢包
function createWallet(strXPubKey, onDone){


    // var devicePrivKey = xPrivKey.derive("m/1'").privateKey.bn.toBuffer({size:32});
    //
    var device = require('intervaluecore/device.js');
    device.setDevicePublicKey(strXPubKey); // we need device address before creating a wallet
    //
    // var strXPubKey = Bitcore.HDPublicKey(xPrivKey.derive("m/44'/0'/0'")).toString();
    //
    // console.log(strXPubKey);


    var walletDefinedByKeys = require('./wallet_defined_by_keys.js');

    // we pass isSingleAddress=false because this flag is meant to be forwarded to cosigners and headless wallet doesn't support multidevice
    walletDefinedByKeys.createWalletByDevices(strXPubKey, 0, 1, [], 'any walletName', false, function(wallet_id){
        walletDefinedByKeys.issueNextAddress(wallet_id, 0, function(addressInfo){
            onDone();
        });
    });
}
