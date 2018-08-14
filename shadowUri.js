/*jslint node: true */
"use strict";

function shadowParseUri(uri,cb) {
    var  arrMatches = uri.match('shadow');
    if(!arrMatches){
        return cb.ifError("is not shadow!!!");
    }
    return cb.ifOk(uri);
}

exports.shadowParseUri = shadowParseUri;