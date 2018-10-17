/*jslint node: true */
"use strict";

let webHelper = require("./webhelper");

//行情接口
let coindogUrl = "api.coindog.com";
//所有行情
let currencyUrl  = "/api/v1/currency/ranks";
//单个行情
let tickUrl = "/api/v1/tick/";


//Fcoin 接口
let inveCurrencyUrl = "api.coindog.com/api/v1/tick/";


/**
 *  获取 指定交易所 指定交易对儿 行情信息
 *  FCOIN:ETHUSDT?unit=cny
 * @param exchange 交易所
 * @param symbol 交易对儿 例如：BITFINEX:BTCUSD HUOBIPRO:BTCUSDT
 * @param unit : 转换价格，默认 CNY (人民币)，可选：base（原价格） usd (美元)
 * @param cb
 */
function getSymbolData(exchange , symbol , unit ,cb) {
    let ticker = exchange.toUpperCase() + ":" + symbol.toUpperCase();
    let subrul = tickUrl + ticker + (unit==null?"":"?unit="+unit );
    webHelper.httpGet(getUrl(coindogUrl,subrul),null,cb)

}

/**
 * 获取行情信息
 * @param cb
 */
function getCurrencyData(cb) {
    let subrul = currencyUrl;
     webHelper.httpGet(getUrl(coindogUrl,subrul) ,null,  cb);
}

//*************************************************************************
//linker接口
let linkUrl = 'www.liankeplus.com';
let newsDataUrl  = "/linker/content/article/list";
let newsInfoUrl  = "/linker/content/article/info/";
let quickdataUrl = "/linker/content/dataquick/list";

/**
 * 获取新闻信息
 * @param limit 每页条数
 * @param page 页码
 * @param status 状态   状态:0置顶 1待审核 2审核通过 3审核未通过 4草稿
 * @param cb
 */
function getNewsData(limit,page,status,cb) {
    limit = limit == null ? 20 : limit;
    page = page == null ? 1 : page;
    status = status == null ? 2 : status;
    let subrul = newsDataUrl + "?" + "limit=" + limit +"&page="+page + "&status=" + status;
    webHelper.httpGet(getUrl(linkUrl ,subrul) ,null, cb);
}

/**
 * 文章的id
 * @param id
 * @param cb
 */
function getNewsInfo(id ,cb) {
    let suburl = newsInfoUrl + id;
    webHelper.httpGet(getUrl(linkUrl,suburl),null,cb);
}

/**
 * 快讯接口
 * @param limit 内容数
 * @param sidx 排序字段
 * @param order 排序顺序
 * @param cb
 */
function getQuickData(limit,sidx,order,cb) {
    limit = limit == null ? 20 : limit;
    sidx = sidx == null ? "createTime" : sidx;
    order = order == null ? "desc" : order;
    let suburl =  quickdataUrl + "?" + "limit=" + limit +"&sidx="+sidx + "&order=" + order;
    webHelper.httpGet(getUrl(linkUrl ,suburl),null,cb);
}


//组装url
function getUrl(url,suburl){
    return 'http://' + url + suburl;
}

exports.getCurrencyData = getCurrencyData;
exports.getNewsData = getNewsData;
exports.getNewsInfo = getNewsInfo;
exports.getQuickData = getQuickData;
exports.getSymbolData = getSymbolData;