/*jslint node: true */
"use strict";

let webHelper = require("./webhelper");


let currencyUrl  = "api.coindog.com/api/v1/currency/ranks";
let newsDataUrl  = "www.liankeplus.com/linker/content/article/list";
let newsInfoUrl  = "www.liankeplus.com/linker/content/article/info/";
let quickdataUrl = "www.liankeplus.com/linker/content/dataquick/list";


var currencyData = {};


/**
 * 获取行情信息
 * @param cb
 */
function getCurrencyData(cb) {
     webHelper.httpGet(currencyUrl ,null,  cb);
}



function getNewsData(limit,page,status,cb) {
    limit = limit == null ? 20 : limit;
    page = page == null ? 1 : page;
    status = status == null ? 2 : status;

    newsDataUrl += "?" + "limit=" + limit +"&page="+page + "&status=" + status;
    webHelper.httpGet(newsDataUrl ,null, cb);
}

function getNewsInfo(id ,cb) {
    newsInfoUrl += id;
    webHelper.httpGet(newsInfoUrl,null,cb);
}

function getQuickData(limit,sidx,order,cb) {
    limit = limit == null ? 20 : limit;
    sidx = sidx == null ? "createTime" : sidx;
    order = order == null ? "desc" : order;
    quickdataUrl +=  "?" + "limit=" + limit +"&sidx="+sidx + "&order=" + order;
    webHelper.httpGet(quickdataUrl,null,cb);
}

// exports.currencyData = function() {return currencyData};
// exports.init = init;
exports.getCurrencyData = getCurrencyData;
exports.getNewsData = getNewsData;
exports.getNewsInfo = getNewsInfo;
exports.getQuickData = getQuickData;
