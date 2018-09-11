
var Mnemonic = require('bitcore-mnemonic');
var Bitcore = require('bitcore-lib');
var getSourceString = require('./string_utils').getSourceString;
var crypto = require('crypto');
var signature = require("./signature");
var objectHash = require('./object_hash.js');

var words = "prevent green zebra prison hidden spare rescue payment prevent zone address champion";

// var sh = require("./shadowWallet");



// var obj = {from:[{address:"SEA5THQUVL24QZDVCDU4CAVVSOMSXFGL",address_index:0,is_change:0,creation_ts:"1535946855"}],to:"KL3M65WEDDZ7VHBB2TT7PSDNBOK4TWAG",amount:1,creation_date:1535946896,isStable:1,isValid:0,fee:122,author:["sig",{"pubkey":"AhE57tO2EGK9SW6wUBWY1z4QswYxBhWKTytTAa8VyWid"}],type:"trading",md5:"747c8090a78b576625ed4f071b6ae31c",name:"isHot"};
// // delete obj.name;
// // delete obj.md5;
// // delete obj.type;
// // delete obj.isHot;
// sh.signTradingUnit(obj,words,function(re) {
//     console.log(re);
// });





var  RANDOM22 = crypto.randomBytes(4).toString("hex");

var aaa = Math.random().toString(36).substr(2);

//

var mnemonic = new Mnemonic(words);
//
var xPrivKey = mnemonic.toHDPrivateKey("");
var path = "m/44'/0'/0'";
var privateKey = xPrivKey.derive(path);
// var prikey = privateKey.privateKey.bn.toBuffer({size:32}); // https://github.com/bitpay/bitcore-lib/issues/47

//签名私钥
var path440000 = "m/44'/0'/0'/0/0";
var privateKey440000 = xPrivKey.derive(path440000);
var prikey = privateKey440000.privateKey.bn.toBuffer({size:32});

console.log(xPrivKey);
//验证公钥
var pubkey = Bitcore.HDPublicKey(privateKey);
var pubkeystr = derivePubkey(pubkey,"m/0/0");

var random = crypto.randomBytes(4).toString("hex");

var sig_buf = crypto.createHash("sha256").update(getSourceString({random}), "utf8").digest();
var sig = signature.sign(sig_buf ,prikey);
var flag = signature.verify(sig_buf,sig,pubkeystr);
var pub = signature.recover(sig_buf,sig,1);
var pub_64 = pub.toString("base64");
if(pub_64 != pubkeystr) {
    console.log("错误");
}
var pub = signature.recover(sig_buf,sig,1);
console.log(pub_64 == pubkeystr);

var definition = ["sig",{"pubkey":pubkeystr}];

var addr = objectHash.getChash160(definition);





//
// sh.getSignatureCode(addr,function(signatureCode) {
//     console.log(signatureCode);
//     console.log("\r\n");
//
//     sh.getSignatureDetlCode(signatureCode,
//         words,
//         function(signatureDetlCode){
//             // var buf_to_sign = crypto.createHash("sha256").update(getSourceString({"type":"shadow","name":"shadow","addr":"3UIGP63WHSQ7H7NEHHBHUF2EASV2J2LR","num":0,"random":"bd067878"}), "utf8").digest();
//             //
//             // var sign = signatureDetlCode.signature;
//             // var flag = signature.verify(buf_to_sign,sign,pubkeystr);
//             console.log(signatureDetlCode);
//             console.log("\r\n");
//
//             sh.generateShadowWallet(signatureDetlCode,function(flag) {
//                 flag;
//                 console.log(flag);
//                 console.log("\r\n");
//
//             });
//
//         } );
//
//
// });
//
//
//
//
//
//
//
function derivePubkey(xPubKey, path){
    var hdPubKey = new Bitcore.HDPublicKey(xPubKey);
    var hdPubKeybuf = hdPubKey.toBuffer();
    var pubkey = hdPubKey.derive(path).publicKey.toBuffer({size:32});

    return hdPubKey.derive(path).publicKey.toBuffer().toString("base64");
}