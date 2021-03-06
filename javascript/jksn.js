/*
  Copyright (c) 2014 StarBrilliant <m13253@hotmail.com>
  All rights reserved.

  Redistribution and use in source and binary forms are permitted
  provided that the above copyright notice and this paragraph are
  duplicated in all such forms and that any documentation,
  advertising materials, and other materials related to such
  distribution and use acknowledge that the software was developed by
  StarBrilliant.
  The name of StarBrilliant may not be used to endorse or promote
  products derived from this software without specific prior written
  permission.

  THIS SOFTWARE IS PROVIDED ``AS IS'' AND WITHOUT ANY EXPRESS OR
  IMPLIED WARRANTIES, INCLUDING, WITHOUT LIMITATION, THE IMPLIED
  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.
*/
/*
  JKSN JavaScript reference implementation
  https://github.com/m13253/JKSN
  @license BSD license
*/
(function(window) {
"use strict";
function unspecifiedValue() {
}
function JKSNEncoder() {
    var lastint = null;
    var texthash = new Array(256);
    var blobhash = new Array(256);
    function JKSNProxy(origin, control, data, buf) {
        if(!(control >= 0 && control <= 255))
            throw "Assertion failed: control >= 0 && control <= 255";
        return {
            "origin": origin,
            "control": control,
            "data": data || "",
            "buf": buf || "",
            "children": [],
            "output": function output(buf, offset, recursive) {
                buf[offset++] = this.control;
                for(var i = 0; i < this.data.length; i++)
                    buf[offset++] = this.data.charCodeAt(i);
                for(var i = 0; i < this.buf.length; i++)
                    buf[offset++] = this.buf.charCodeAt(i);
                if(recursive !== false)
                    for(var i = 0; i < this.children.length; i++)
                        offset = this.children[i].output(buf, offset);
                return offset;
            },
            "toString": function toString(recursive) {
                var result = [String.fromCharCode(this.control), this.data, this.buf];
                if(recursive !== false)
                    result.push.apply(result, this.children);
                return result.join("");
            },
            "getSize": function getSize(depth) {
                var result = 1 + this.data.length + this.buf.length;
                if(depth === undefined)
                    depth = 0;
                if(depth == 0)
                    result = this.children.reduce(function (a, b) { return a + b.getSize(0); }, result);
                else if(depth != 1)
                    result = this.children.reduce(function (a, b) { return a + b.getSize(depth-1); }, result);
                return result;
            }
        };
    }
    function dumpToProxy(obj) {
        return optimize(dumpValue(obj));
    }
    function dumpValue(obj) {
        if(obj === undefined)
            return JKSNProxy(obj, 0x00);
        else if(obj === null)
            return JKSNProxy(obj, 0x01);
        else if(obj === false)
            return JKSNProxy(obj, 0x02);
        else if(obj === true)
            return JKSNProxy(obj, 0x03);
        else if(obj instanceof unspecifiedValue)
            return JKSNProxy(obj, 0xa0);
        else if(typeof obj === "number")
            return dumpNumber(obj);
        else if(typeof obj === "string")
            return dumpString(obj);
        else if(obj instanceof ArrayBuffer)
            return dumpBuffer(obj);
        else if(Array.isArray(obj))
            return dumpArray(obj);
        else
            return dumpObject(obj);
    }
    function dumpNumber(obj) {
        if(isNaN(obj))
            return JKSNProxy(obj, 0x20);
        else if(!isFinite(obj))
            return JKSNProxy(obj, obj >= 0 ? 0x2f : 0x2e);
        else if((obj | 0) === obj)
            if(obj >= 0 && obj <= 0xa)
                return JKSNProxy(obj, 0x10 | obj);
            else if(obj >= -0x80 && obj <= 0x7f)
                return JKSNProxy(obj, 0x1d, encodeInt(obj, 1));
            else if(obj >= -0x8000 && obj <= 0x7fff)
                return JKSNProxy(obj, 0x1c, encodeInt(obj, 2));
            else if((obj >= -0x80000000 && obj <= -0x200000) || (obj >= 0x200000 && obj <= 0x7fffffff))
                return JKSNProxy(obj, 0x1b, encodeInt(obj, 4));
            else if(obj >= 0)
                return JKSNProxy(obj, 0x1f, encodeInt(obj, 0));
            else
                return JKSNProxy(obj, 0x1e, -encodeInt(obj, 0));
        else {
            var f64buf = new DataView(new ArrayBuffer(8));
            f64buf.setFloat64(0, obj, false);
            return JKSNProxy(obj, 0x2c, encodeInt(f64buf.getUint32(0, false), 4)+encodeInt(f64buf.getUint32(4, false), 4));
        }
    }
    function dumpString(obj) {
        var obj_utf8 = unescape(encodeURIComponent(obj));
        var obj_utf16 = new Uint8Array(obj.length << 1);
        for(var i = 0, j = 0, k = 1; i < obj.length; i++, j += 2, k += 2) {
            var charCodeI = obj.charCodeAt(i);
            obj_utf16[j] = charCodeI;
            obj_utf16[k] = charCodeI >>> 8;
        }
        obj_utf16 = String.fromCharCode.apply(null, obj_utf16);
        if(obj_utf16.length < obj_utf8.length) {
            var obj_short = obj_utf16;
            var control = 0x30;
            var strlen = obj_utf16.length >>> 1;
        } else {
            var obj_short = obj_utf8;
            var control = 0x40;
            var strlen = obj_utf8.length;
        }
        if(strlen <= (control == 0x40 ? 0xc : 0xb))
            var result = JKSNProxy(obj, control | strlen, "", obj_short);
        else if(strlen <= 0xff)
            var result = JKSNProxy(obj, control | 0xe, encodeInt(strlen, 1), obj_short);
        else if(strlen <= 0xffff)
            var result = JKSNProxy(obj, control | 0xd, encodeInt(strlen, 2), obj_short);
        else
            var result = JKSNProxy(obj, control | 0xf, encodeInt(strlen, 0), obj_short);
        result.hash = DJBHash(obj_short);
        return result;
    }
    function dumpBuffer(obj) {
        var strbuf = new Uint8Array(obj);
        var str = String.fromCharCode.apply(null, strbuf);
        var strlen = str.length;
        if(strlen <= 0xb)
            var result = JKSNProxy(obj, 0x50 | strlen, "", str);
        else if(strlen <= 0xff)
            var result = JKSNProxy(obj, 0x5e, encodeInt(strlen, 1), str);
        else if(strlen <= 0xffff)
            var result = JKSNProxy(obj, 0x5e, encodeInt(strlen, 2), str);
        else
            var result = JKSNProxy(obj, 0x5e, encodeInt(strlen, 0), str);
        result.hash = DJBHash(strbuf);
        return result;
    }
    function dumpArray(obj) {
        function testSwapAvailability(obj) {
            var columns = false;
            for(var row = 0; row < obj.length; row++)
                if(typeof obj[row] !== "object" || obj[row] === undefined || obj[row] === null || obj[row] instanceof unspecifiedValue)
                    return false;
                else
                    for(var key in obj[row]) {
                        columns = true;
                        break;
                    }
            return columns;
        }
        function encodeStraightArray(obj) {
            var objlen = obj.length;
            if(objlen <= 0xc)
                var result = JKSNProxy(obj, 0x80 | objlen);
            else if(objlen <= 0xff)
                var result = JKSNProxy(obj, 0x8e, encodeInt(objlen, 1));
            else if(objlen <= 0xffff)
                var result = JKSNProxy(obj, 0x8d, encodeInt(objlen, 2));
            else
                var result = JKSNProxy(obj, 0x8f, encodeInt(objlen, 0));
            result.children = obj.map(dumpValue);
            if(result.children.length != objlen)
                throw "Assertion failed: result.children.length == objlen";
            return result;
        }
        function encodeSwappedArray(obj) {
            var columns = [];
            var columns_set = {};
            for(var row = 0; row < obj.length; row++)
                for(var column in obj[row])
                    if(!columns_set[column]) {
                        columns.push(column)
                        columns_set[column] = true;
                    }
            var collen = columns.length;
            if(collen <= 0xc)
                var result = JKSNProxy(obj, 0xa0 | collen);
            else if(collen <= 0xff)
                var result = JKSNProxy(obj, 0xae, encodeInt(collen, 1));
            else if(collen <= 0xffff)
                var result = JKSNProxy(obj, 0xad, encodeInt(collen, 2));
            else
                var result = JKSNProxy(obj, 0xaf, encodeInt(collen, 0));
            for(var column = 0; column < collen; column++) {
                var columns_value = new Array(obj.length);
                for(var row = 0; row < obj.length; row++)
                    columns_value[row] = (obj[row][columns[column]] !== undefined ? obj[row][columns[column]] : new unspecifiedValue())
                result.children.push(dumpValue(columns[column]), dumpArray(columns_value));
            }
            if(result.children.length != collen * 2)
                throw "Assertion failed: result.children.length == columns.length * 2";
            return result;
        }
        var result = encodeStraightArray(obj);
        if(testSwapAvailability(obj)) {
            var resultSwapped = encodeSwappedArray(obj);
            if(resultSwapped.getSize(3) < result.getSize(3))
                result = resultSwapped;
        }
        return result;
    }
    function dumpObject(obj) {
        var objlen = 0;
        var children = [];
        for(var key in obj) {
            objlen++;
            children.push(dumpValue(key), dumpValue(obj[key]));
        }
        if(objlen <= 0xc)
            var result = JKSNProxy(obj, 0x90 | objlen);
        else if(objlen <= 0xff)
            var result = JKSNProxy(obj, 0x9e, encodeInt(objlen, 1));
        else if(objlen <= 0xffff)
            var result = JKSNProxy(obj, 0x9d, encodeInt(objlen, 2));
        else
            var result = JKSNProxy(obj, 0x9f, encodeInt(objlen, 0));
        result.children = children;
        return result;
    }
    function optimize(obj) {
        var control = obj.control & 0xf0;
        switch(control) {
        case 0x10:
            if(lastint !== null) {
                var delta = obj.origin - lastint;
                if(Math.abs(delta) < Math.abs(obj.origin)) {
                    if(delta >= 0 && delta <= 0x5) {
                        var newControl = 0xd0 | delta;
                        var newData = "";
                    } else if(delta >= -0x5 && delta <= -0x1) {
                        var newControl = 0xd0 | (delta+11);
                        var newData = "";
                    } else if(delta >= -0x80 && delta <= 0x7f) {
                        var newControl = 0xdd;
                        var newData = encodeInt(delta, 1);
                    } else if(delta >= -0x8000 && delta <= 0x7fff) {
                        var newControl = 0xdc;
                        var newData = encodeInt(delta, 2);
                    } else if((delta >= -0x80000000 && delta <= -0x200000) || (delta >= 0x200000 && delta <= 0x7fffffff)) {
                        var newControl = 0xdb;
                        var newData = encodeInt(delta, 4);
                    } else if(delta >= 0) {
                        var newControl = 0xdf;
                        var newData = encodeInt(delta, 0);
                    } else {
                        var newControl = 0xde;
                        var newData = encodeInt(-delta, 0);
                    }
                    if(newData.length < obj.data.length) {
                        obj.control = newControl;
                        obj.data = newData;
                    }
                }
            }
            lastint = obj.origin;
            break;
        case 0x30:
        case 0x40:
            if(obj.buf.length > 1)
                if(texthash[obj.hash] == obj.buf) {
                    obj.control = 0x3c;
                    obj.data = encodeInt(obj.hash, 1);
                    obj.buf = "";
                } else
                    texthash[obj.hash] = obj.buf;
            break;
        case 0x50:
            if(obj.buf.length > 1)
                if(blobhash[obj.hash] == obj.buf) {
                    obj.control = 0x5c;
                    obj.data = encodeInt(obj.hash, 1);
                    obj.buf = "";
                } else
                    blobhash[obj.hash] = obj.buf;
            break;
        default:
            for(var i = 0; i < obj.children.length; i++)
                optimize(obj.children[i]);
        }
        return obj;
    }
    function encodeInt(number, size) {
        switch(size) {
        case 1:
            return String.fromCharCode(number & 0xff);
        case 2:
            return String.fromCharCode((number >>> 8) & 0xff, number & 0xff);
        case 4:
            return String.fromCharCode((number >>> 24) & 0xff, (number >>> 16) & 0xff, (number >>> 8) & 0xff, number & 0xff);
        case 0:
            if(!(number >= 0))
                throw "Assertion failed: number >= 0";
            var result = [number & 0x7f];
            number >>>= 7;
            while(number != 0) {
                result.unshift((number & 0x7f) | 0x80);
                number >>>= 7;
            }
            return String.fromCharCode.apply(null, result);
        default:
            throw "Assertion failed: size in [1, 2, 4, 0]";
        }
    }
    return {
        "stringifyToArrayBuffer": function stringifyToArrayBuffer(obj, header) {
            var result = dumpToProxy(obj);
            var result_size = result.getSize();
            var buf = new ArrayBuffer(header !== false ? result_size + 3 : result_size);
            var bufview = new Uint8Array(buf);
            if(header !== false) {
                bufview[0] = 106;
                bufview[1] = 107;
                bufview[2] = 33;
                if(result.output(bufview, 3) != result_size+3)
                    throw "Assersion failed: result.output(bufview, 3) != result.getSize()+3"
            } else
                if(result.output(bufview, 0) != result_size)
                    throw "Assersion failed: result.output(bufview, 0) != result.getSize()"
            return buf;
        },
        "stringifyToString": function stringifyToString(obj, header) {
            return String.fromCharCode.apply(null, new Uint8Array(this.stringifyToArrayBuffer(obj, header)));
        }
    };
}
function JKSNDecoder() {
    var lastint = null;
    var texthash = new Array(256);
    var blobhash = new Array(256);
    var offset = 0;
    function loadValue(buf) {
        for(;;) {
            var control = buf.getUint8(offset++);
            var ctrlhi = control & 0xf0;
            switch(ctrlhi) {
            /* Special values */
            case 0x00:
                switch(control) {
                case 0x00:
                    return undefined;
                case 0x01:
                    return null;
                case 0x02:
                    return false;
                case 0x03:
                    return true;
                case 0x0f:
                    var s = loadValue(fp);
                    if(typeof s !== "string")
                        throw "JKSNDecodeError: JKSN value 0x0f requires a string but found "+s;
                    return JSON.parse(s);
                }
                break;
            /* Integers */
            case 0x10:
                switch(control) {
                case 0x1b:
                    lastint = buf.getInt32(offset, false);
                    offset += 4;
                    break;
                case 0x1c:
                    lastint = buf.getInt16(offset, false);
                    offset += 2;
                    break;
                case 0x1d:
                    lastint = buf.getInt8(offset++);
                    break;
                case 0x1e:
                    lastint = -decodeInt(buf);
                    break;
                case 0x1f:
                    lastint = decodeInt(buf);
                    break;
                default:
                    lastint = control & 0xf;
                }
                return lastint;
            /* Floating point numbers */
            case 0x20:
                switch(control) {
                case 0x20:
                    return NaN;
                case 0x2b:
                    throw "JKSNDecodeError: This JKSN decoder does not support long double numbers.";
                case 0x2c:
                    var result = buf.getFloat64(offset, false);
                    offset += 8;
                    return result;
                case 0x2d:
                    var result = buf.getFloat32(offset, false);
                    offset += 4;
                    return result;
                case 0x2e:
                    return -Infinity;
                case 0x2f:
                    return Infinity;
                }
                break;
            /* UTF-16 strings */
            case 0x30:
                var strlen;
                switch(control) {
                case 0x3c:
                    var hashvalue = buf.getUint8(offset++);
                    if(texthash[hashvalue] !== undefined)
                        return texthash[hashvalue];
                    else
                        throw "JKSNDecodeError: JKSN stream requires a non-existing hash: "+hashvalue;
                case 0x3d:
                    strlen = buf.getUint16(offset, false);
                    offset += 2;
                    break;
                case 0x3e:
                    strlen = buf.getUint8(offset++);
                    break;
                case 0x3f:
                    strlen = decodeInt(buf);
                    break;
                default:
                    strlen = control & 0xf;
                }
                strlen *= 2;
                var strbuf = new Uint8Array(buf.buffer, offset, strlen);
                var result = String.fromCharCode.apply(null, LittleEndianUint16FromUint8Array(strbuf));
                texthash[DJBHash(strbuf)] = result;
                offset += strlen;
                return result;
            /* UTF-8 strings */
            case 0x40:
                var strlen;
                switch(control) {
                case 0x4d:
                    strlen = buf.getUint16(offset, false);
                    offset += 2;
                    break;
                case 0x4e:
                    strlen = buf.getUint8(offset++);
                    break;
                case 0x4f:
                    strlen = decodeInt(buf);
                    break;
                default:
                    strlen = control & 0xf;
                }
                var strbuf = new Uint8Array(buf.buffer, offset, strlen);
                var result = decodeURIComponent(escape(String.fromCharCode.apply(null, strbuf)));
                texthash[DJBHash(strbuf)] = result;
                offset += strlen;
                return result;
            /* Blob strings */
            case 0x50:
                var strlen;
                switch(control) {
                case 0x5d:
                    strlen = buf.getUint16(offset, false);
                    offset += 2;
                    break;
                case 0x5e:
                    strlen = buf.getUint8(offset++);
                    break;
                case 0x5f:
                    strlen = decodeInt(buf);
                    break;
                default:
                    strlen = control & 0xf;
                }
                var strbuf = new Uint8Array(new Uint8Array(buf.buffer, offset, strlen));
                var result = strbuf.buffer;
                blobhash[DJBHash(strbuf)] = result;
                offset += strlen;
                return result;
            /* Hashtable refreshers */
            case 0x70:
                var objlen;
                switch(control) {
                case 0x70:
                    self.texthash = new Array(256);
                    self.blobhash = new Array(256);
                    continue;
                case 0x7d:
                    objlen = buf.getUint16(offset, false);
                    offset += 2;
                    break;
                case 0x7e:
                    objlen = buf.getUint8(offset++);
                    break;
                case 0x7f:
                    objlen = decodeInt(buf);
                    break;
                default:
                    objlen = control & 0xf;
                }
                for(; objlen > 0; objlen--)
                    loadValue(buf);
                continue;
            /* Arrays */
            case 0x80:
                var objlen;
                switch(control) {
                case 0x8d:
                    objlen = buf.getUint16(offset, false);
                    offset += 2;
                    break;
                case 0x8e:
                    objlen = buf.getUint8(offset++);
                    break;
                case 0x8f:
                    objlen = decodeInt(buf);
                    break;
                default:
                    objlen = control & 0xf;
                }
                var result = new Array(objlen);
                for(var i = 0; i < objlen; i++)
                    result[i] = loadValue(buf);
                return result;
            /* Objects */
            case 0x90:
                var objlen;
                switch(control) {
                case 0x9d:
                    objlen = buf.getUint16(offset, false);
                    offset += 2;
                    break;
                case 0x9e:
                    objlen = buf.getUint8(offset++);
                    break;
                case 0x9f:
                    objlen = decodeInt(buf);
                    break;
                default:
                    objlen = control & 0xf;
                }
                var result = {};
                for(; objlen > 0; objlen--) {
                    var key = loadValue(buf);
                    result[key] = loadValue(buf);
                }
                return result;
            /* Row-col swapped arrays */
            case 0xa0:
                var collen;
                switch(control) {
                case 0xa0:
                    return new unspecifiedValue();
                case 0xad:
                    collen = buf.getUint16(offset, false);
                    offset += 2;
                    break;
                case 0xae:
                    collen = buf.getUint8(offset++);
                    break;
                case 0xaf:
                    collen = decodeInt(buf);
                    break;
                default:
                    collen = control & 0xf;
                }
                var result = [];
                for(var i = 0; i < collen; i++) {
                    var column_name = loadValue(buf);
                    var column_values = loadValue(buf);
                    if(column_values.length === undefined)
                        throw "JKSNDecodeError: JKSN row-col swapped array requires an array but found "+column_values;
                    for(var row = 0; row < column_values.length; row++) {
                        if(row == result.length)
                            result.push({});
                        if(!(column_values[row] instanceof unspecifiedValue))
                            result[row][column_name] = column_values[row];
                    }
                }
                return result;
            /* Lengthless arrays */
            case 0xc0:
                switch(control) {
                case 0xc8:
                    var result = new Array();
                    for(;;) {
                        var item = loadValue(buf);
                        if(!(item instanceof unspecifiedValue))
                            result.push(item);
                        else
                            return result;
                    }
                }
                break;
            /* Delta encoded integers */
            case 0xd0:
                var delta;
                switch(control) {
                case 0xd0: case 0xd1: case 0xd2: case 0xd3: case 0xd4: case 0xd5:
                    delta = control & 0xf;
                    break;
                case 0xd6: case 0xd7: case 0xd8: case 0xd9: case 0xda:
                    delta = (control & 0xf)-11;
                    break;
                case 0xdb:
                    delta = buf.getInt32(offset, false);
                    offset += 4;
                    break;
                case 0xdc:
                    delta = buf.getInt16(offset, false);
                    offset += 2;
                    break;
                case 0xdd:
                    delta = buf.getInt8(offset++);
                    break;
                case 0xde:
                    delta = -decodeInt(buf);
                    break;
                case 0xdf:
                    delta = decodeInt(buf);
                    break;
                }
                if(lastint !== null)
                    return (lastint += delta);
                else
                    throw "JKSNDecodeError: JKSN stream contains an invalid delta encoded integer"
            case 0xf0:
                /* Ignore checksums */
                if(control <= 0xf5 || (control >= 0xf8 && control <= 0xfd)) {
                    console.warn("JKSNDecodeWarning: checksum is not supported")
                    switch(control) {
                    case 0xf0:
                        offset++;
                        continue;
                    case 0xf1:
                        offset += 4;
                        continue;
                    case 0xf2:
                        offset += 16;
                        continue;
                    case 0xf3:
                        offset += 20;
                        continue;
                    case 0xf4:
                        offset += 32;
                        continue;
                    case 0xf5:
                        offset += 64;
                        continue;
                    }
                    continue;
                /* Ignore pragmas */
                } else if(control == 0xff) {
                    loadValue(buf);
                    continue;
                }
                break;
            }
            throw "JKSNDecodeError: cannot decode JKSN from byte "+control;
        }
    }
    function decodeInt(buf) {
        var result = 0;
        var thisbyte;
        do {
            thisbyte = buf.getUint8(offset++);
            result = (result*128) + (thisbyte & 0x7f);
        } while(thisbyte & 0x80);
        return result;
    }
    function LittleEndianUint16FromUint8Array(arr) {
        var result = new Uint16Array(arr.length >>> 1);
        for(var i = 0, j = 1, k = 0; j < arr.length; i += 2, j += 2, k++)
            result[k] = arr[i] | (arr[j] << 8);
        return result;
    }
    return {
        "parseFromArrayBuffer": function parseFromArrayBuffer(buf) {
            var headerbuf = new Uint8Array(buf, 0, 3);
            if(headerbuf[0] == 106 && headerbuf[1] == 107 && headerbuf[2] == 33)
                offset = 3;
            return loadValue(new DataView(buf));
        },
        "parseFromString": function parseFromString(str) {
            var buf = new ArrayBuffer(str.length);
            var bufview = new Uint8Array(buf);
            for(var i = 0; i < str.length; i++)
                bufview[i] = str.charCodeAt(i);
            return this.parseFromArrayBuffer(buf);
        }
    };
}
function DJBHash(arr) {
    var result = 0;
    if(arr.charCodeAt)
        for(var i = 0; i < arr.length; i++)
            result += (result << 5) + arr.charCodeAt(i);
    else
        for(var i = 0; i < arr.length; i++)
            result += (result << 5) + arr[i];
    return result & 0xff;
}
var JKSN = {
    "encoder": JKSNEncoder,
    "decoder": JKSNDecoder,
    "parseFromArrayBuffer": function parseFromArrayBuffer(buf) {
        return new JKSN.decoder().parseFromArrayBuffer(buf);
    },
    "parseFromString": function parseFromString(buf) {
        return new JKSN.decoder().parseFromString(buf);
    },
    "stringifyToArrayBuffer": function stringifyToArrayBuffer(obj, header) {
        return new JKSN.encoder().stringifyToArrayBuffer(obj, header);
    },
    "stringifyToString": function stringifyToString(obj, header) {
        return new JKSN.encoder().stringifyToString(obj, header);
    }
}
window.JKSN = JKSN;
}(this));
