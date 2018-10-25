/*jslint node: true */
"use strict";

let webHelper = require("./webhelper");

//行情接口coindog
let coindog         = "api.coindog.com";
//所有行情
let currencysUrl1   = "/api/v1/currency/ranks";
//单个行情
let tickUrl         = "/api/v1/tick/";

//huobi接口
let huobi           = "api.huobipro.com";
//所有行情
let currencysUrl2   = "/market/tickers";

//Fcoin 接口
let fcoin           = 'api.fcoin.com';
//行情
let inveCurrencyUrl = "/v2/market/ticker/";

//coinex接口
let coinex          = "api.coinex.com";
//所有行情
let currencysUrl3   = "/v1/market/ticker/all";



//*************************************************************************
//linker接口
// let linkUrl = 'www.liankeplus.com';
let link            = 'test.inve.zhang123.vip';
//最新新闻
let newsDataUrl     = "/linker/content/article/list";
//新闻详情
let newsInfoUrl     = "/linker/content/article/info/";
//快讯
let quickdataUrl    = "/linker/content/dataquick/list";
//所有行情
let currencysLink   = "/linker1/content/api/coindog2";
//inve行情
let currencyInve    = "/linker1/content/api/inve";



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
    webHelper.httpGet(getUrl(coindog,subrul),null,cb)

}

/**
 * 获取行情信息
 * @param cb
 */
function getCurrencyData(cb) {
    let data = {
        totalPages:100,
        page:{
            list:{
                BTC :{name:"比特币",newPrice:"100" , market:"+7.89%" ,cnyPrice: "46,789", oldPrice:"100",value:"4524", sname: 'btc'},
                ETH :{name:"以太坊",newPrice:"100" , market:"+7.89%" ,cnyPrice: "46,789", oldPrice:"100",value:"368", sname: 'h'},
                EOS :{name:"瑞博币",newPrice:"100" , market:"+7.89%" ,cnyPrice: "46,789", oldPrice:"100",value:"6/9", sname: 'bt3r2c'},
                ETC :{name:"以太坊",newPrice:"100" , market:"+7.89%" ,cnyPrice: "46,789", oldPrice:"100",value:"35", sname: 'we'},
                LTC :{name:"比特币",newPrice:"100" , market:"-7.89%" ,cnyPrice: "46,789", oldPrice:"100",value:"10990", sname: 'btewrwc'},
                HT  :{name:"瑞博币",newPrice:"100" , market:"+7.89%" ,cnyPrice: "46,789", oldPrice:"100",value:"63859", sname: 'fdsf'},
                BTM :{name:"比特币",newPrice:"100" , market:"+7.89%" ,cnyPrice: "46,789", oldPrice:"100",value:"83", sname: 'hjyj'}
            }
        }
    };


    cb(data);
    // let subrul = currencysLink;
    // webHelper.httpGet(getUrl(link,subrul,"https") ,null,  function (err, res) {
    //     if(err) {
    //         console.log("error:"+err);
    //         cb(null);
    //         return;
    //     }
    //     res = JSON.parse(res);
    //     if(!!res && res.code == 0) {
    //         // console.log(res);
    //         let source = res.data.ticker;
    //
    //         //行情数据 价格(默认美刀) 涨幅 人民币 市值
    //         let data = {
    //             BTC :{newPrice:"-" , market:"-" ,cnyPrice: "-", oldPrice:"-",value:"-"},
    //             ETH :{newPrice:"-" , market:"-" ,cnyPrice: "-", oldPrice:"-",value:"-"},
    //             EOS :{newPrice:"-" , market:"-" ,cnyPrice: "-", oldPrice:"-",value:"-"},
    //             ETC :{newPrice:"-" , market:"-" ,cnyPrice: "-", oldPrice:"-",value:"-"},
    //             LTC :{newPrice:"-" , market:"-" ,cnyPrice: "-", oldPrice:"-",value:"-"},
    //             HT  :{newPrice:"-" , market:"-" ,cnyPrice: "-", oldPrice:"-",value:"-"},
    //             BTM :{newPrice:"-" , market:"-" ,cnyPrice: "-", oldPrice:"-",value:"-"}
    //         };
    //
    //
    //         cb(data);
    //     }
    // });
}

function getInveData(cb) {
    //计算人民币
    getSymbolData("fcoin",'ethusdt',"cny",function(err ,res) {
        res = JSON.parse(res);
        if(res != null) {
            getSymbolData("fcoin",'ethusdt',"usdt",function(err2 ,res2) {
                res2 = JSON.parse(res2);
                //汇率
                var rate = res.close / res2.close;
                let suburul = inveCurrencyUrl + "inveusdt";
                webHelper.httpGet(getUrl(fcoin,suburul) ,null,  function (err3,res3) {
                    res3 = JSON.parse(res3);
                    if(res3.status == 0) {
                        //最新成交价 usdt
                        var newPrice = res3.data.ticker[0];
                        //最新成交价 cny
                        var cnyPrice = newPrice * rate;
                        var oldPrice = res3.data.ticker[6]

                        //涨幅
                        var market = (newPrice - oldPrice) / oldPrice;

                        var data = { newPrice , cnyPrice ,oldPrice ,market}
                        cb(data);
                    }
                });

            });
        }
        else {
            console.log("connection error ~!")
        }
    });

}

function getInveData2(cb) {
    let data = {
        totalPages:100,
        page:{
            list:{
                INVE :{naem:"INVE",newPrice:"100" , market:"+100%" ,cnyPrice: "100", oldPrice:"100",value:"100"}
            }
        }
    };
    cb(data);

    // let suburul = inveCurrencyUrl + "inveusdt";
    let suburul = currencyInve;
    //美刀汇率
    let rate = 6.9291;
    webHelper.httpGet(getUrl(link,suburul,"https") ,null,  function (err,res) {
        if(err) {
            console.log("error:"+err);
            cb(null);
            return;
        }
        res = JSON.parse(res);
        if(!!res && res.code == 0) {
            //最新成交价 usdt
            var newPrice = res.data.ticker[0];
            //最新成交价 cny
            var cnyPrice = newPrice * rate;
            var oldPrice = res.data.ticker[6]

            //涨幅
            var market  = (newPrice - oldPrice) / oldPrice;

            var data    = { newPrice , cnyPrice ,oldPrice ,market};
            cb(data);
        }
    });
}









/**
 * 获取新闻信息
 * @param limit 每页条数
 * @param page 页码
 * @param status 状态   状态:0置顶 1待审核 2审核通过 3审核未通过 4草稿
 * @param cb
 */
function getNewsData(limit,page,status,cb) {
    limit       = limit     == null ? 20 : limit;
    page        = page      == null ? 1 : page;
    status      = status    == null ? 2 : status;
    let subrul  = newsDataUrl + "?" + "limit=" + limit +"&page="+page + "&status=" + status;
    webHelper.httpGet(getUrl(link ,subrul,"https") ,null, function(err,res) {
        if(err) {
            console.log("error:"+err);
            cb(null);
            return;
        }
        res = JSON.parse(res);
        if(!!res && res.code == 0) {
            cb(res);
        }
    });
}

/**
 * 文章的id
 * @param id
 * @param cb
 */
function getNewsInfo(id ,cb) {
    let suburl = newsInfoUrl + id;
    webHelper.httpGet(getUrl(link,suburl,"https"),null,function(err,res) {
        if(err) {
            console.log("error:"+err);
            cb(null);
            return;
        }
        res = JSON.parse(res);
        if(!!res && res.code == 0) {
            var content = res.article.content;
            var reg     = /style=\".*?\"/;
            content     = content.replace(reg,"");
            cb(res);
        }
    });
}

/**
 * 快讯接口
 * @param limit 内容数
 * @param sidx 排序字段
 * @param order 排序顺序
 * @param cb
 */
function getQuickData(limit,page,sidx,order,cb) {
    limit   = limit == null ? 20 : limit;
    sidx    = sidx  == null ? "createTime" : sidx;
    order   = order == null ? "desc" : order;
    page    = page  == null ? 1 : page;
    let suburl =  quickdataUrl + "?" + "limit=" + limit +"&sidx="+sidx + "&order=" + order + "&page=" + page;
    webHelper.httpGet(getUrl(link ,suburl,"https"),null,function(err ,res) {
        if(err) {
            console.log("error:"+err);
            cb(null);
            return;
        }
        res = JSON.parse(res);
        if(!!res && res.code == 0) {
            cb(res);
        }
    });
}


//组装url
function getUrl(url,suburl ,https){
    return (!https?'http://':"https://") + url + suburl;
}

exports.getCurrencyData = getCurrencyData;
exports.getNewsData = getNewsData;
exports.getNewsInfo = getNewsInfo;
exports.getQuickData = getQuickData;
exports.getSymbolData = getSymbolData;
exports.getInveData = getInveData;
exports.getInveData2 = getInveData2;