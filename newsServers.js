/*jslint node: true */
"use strict";

let webHelper = require("./webhelper");

let timeout = 5 * 1000;

let currencyUrl = "api.coindog.com/api/v1/currency/ranks";



var currencyData = {};



function init(){
    // currencyData = {js:1};
    getCurrencyData();
}


function getCurrencyData(cb) {
     webHelper.httpGet(currencyUrl ,null,  cb);
}


exports.currencyData = function() {return currencyData};

exports.init = init;
exports.getCurrencyData = getCurrencyData;

