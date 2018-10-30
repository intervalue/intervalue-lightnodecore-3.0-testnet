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
let currencysLink   = "/linker1/content/api/coindog";
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
function getCurrencyData(limit,page ,fields,cb) {
    // let data = {
    //     totalPages:100,
    //     page:{
    //         list:{ //name:名称 price:价格 quote_change:涨跌幅 volume:交易量 quantity:流通数量 value:流通市值 time_stamp:时间戳(10位int保存) source:来源网站
    //             BTC :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:4524, quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             ETH :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:368,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             EOS :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:6.9,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             ETC :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:35,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             LTC :{name:"BTC",price:100 , quote_change:-7.89,   cnyPrice: 46.789, volume:"100",value:10990,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             HT  :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:63859,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             BTM :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:83,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             BTC1 :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:4524, quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             ETH2 :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:368,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             EOS3 :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:6.9,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             ETC4 :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:35,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             LTC5 :{name:"BTC",price:100 , quote_change:-7.89,   cnyPrice: 46.789, volume:"100",value:10990,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             HT6  :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:63859,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             BTM7 :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:83,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             BTC8 :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:4524, quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             ETH9 :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:368,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             EOS0 :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:6.9,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             ETC11 :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:35,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             LTC22 :{name:"BTC",price:100 , quote_change:-7.89,   cnyPrice: 46.789, volume:"100",value:10990,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             HT33  :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:63859,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             BTM44 :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:83,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             BTC55 :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:4524, quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             ETH66 :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:368,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             EOS77 :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:6.9,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             E1TC :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:35,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             LT2C :{name:"BTC",price:100 , quote_change:-7.89,   cnyPrice: 46.789, volume:"100",value:10990,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             H3T  :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:63859,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             B44TM :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:83,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             BT3C :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:4524, quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             ET45H :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:368,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             EO34S :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:6.9,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             ET54C :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:35,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             LT765C :{name:"BTC",price:100 , quote_change:-7.89,   cnyPrice: 46.789, volume:"100",value:10990,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             HasdT  :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:63859,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             BTsdM :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:83,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             BTsC :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:4524, quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             ETsdH :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:368,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             EqOS :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:6.9,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             EhTC :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:35,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             LhTC :{name:"BTC",price:100 , quote_change:-7.89,   cnyPrice: 46.789, volume:"100",value:10990,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             HhT  :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:63859,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             BhTM :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:83,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             BhTC :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:4524, quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             EhTH :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:368,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             EghOS :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:6.9,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             EgTC :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:35,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             LfTC :{name:"BTC",price:100 , quote_change:-7.89,   cnyPrice: 46.789, volume:"100",value:10990,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             HddT  :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:63859,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             BdTM :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:83,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             BsTC :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:4524, quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             EzTH :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:368,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             EaOS :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:6.9,  quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             EtTC :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:35,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             LrTC :{name:"BTC",price:100 , quote_change:-7.89,   cnyPrice: 46.789, volume:"100",value:10990,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             HeT  :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:63859,quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"},
    //             BTwM :{name:"BTC",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:83,   quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"}
    //         }
    //         }
    //     };
    //
    // cb(data);


    let subrul = currencysLink;
    webHelper.httpGet(getUrl(link,subrul,"https") ,null,  function (err, res) {
        if(err) {
            console.log("error:"+err);
            cb(null);
            return;
        }
        res = JSON.parse(res);
        if(!!res && res.code == 0) {
            // console.log(res);
            let list = res.list;

            //行情数据 价格(默认美刀) 涨幅 人民币 市值
            let data = {
                totalPages: list.length,
                page: {
                    list
                }
            };

            cb(data);
        }
    });
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
    // let data = {
    //     totalPages:100,
    //     page:{
    //         list:{
    //             INVE :{name:"INVE",price:100 , quote_change:7.89 ,   cnyPrice: 46.789, volume:"100",value:4524, quantity:10000000, c_name: '比特币',time_stamp:"1123123",source:"www.baidu.com"}
    //         }
    //     }
    // };
    // cb(data);

    let suburul = inveCurrencyUrl + "inveusdt";
    // let suburul = currencyInve;
    //美刀汇率
    let rate = 6.9291;
    webHelper.httpGet(getUrl(fcoin,suburul,"https") ,null,  function (err,res) {
        if(err) {
            console.log("error:"+err);
            cb(null);
            return;
        }
        // res = JSON.parse(res);
        // if(!!res && res.code == 0) {
        //     //最新成交价 usdt
        //     var newPrice = res.data.ticker[0];
        //     //最新成交价 cny
        //     var cnyPrice = newPrice * rate;
        //     var oldPrice = res.data.ticker[6]
        //
        //     //涨幅
        //     var market  = (newPrice - oldPrice) / oldPrice;
        //
        //     var data    = { newPrice , cnyPrice ,oldPrice ,market};
        //     cb(data);
        // }
        res = JSON.parse(res);
        if(!!res && res.status == 0) {
            //最新成交价 usdt
            var newPrice = res.data.ticker[0];
            //最新成交价 cny
            var cnyPrice = newPrice * rate;
            var oldPrice = res.data.ticker[6]

            //涨幅
            var market  = (newPrice - oldPrice) / oldPrice;

            var list    = { newPrice , cnyPrice ,oldPrice ,market};
            let data = {
                totalPages: 1,
                page: {//name:名称 price:价格 quote_change:涨跌幅 volume:交易量 quantity:流通数量 value:流通市值 time_stamp:时间戳(10位int保存) source:来源网站
                    INVE:{name:"INVE",price:newPrice , quote_change:market , cnyPrice: cnyPrice, volume:"-",value:"-", quantity:"-", c_name: 'INVE币',time_stamp:"-",source:"www.fcoin.com"}
        }
            };


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