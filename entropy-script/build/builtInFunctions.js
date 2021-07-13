var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { Undefined } from "./constants.js";
export const builtInFunctions = {
    'range': (context) => __awaiter(void 0, void 0, void 0, function* () {
        let start = context.get('start');
        let stop = context.get('stop');
        const step = context.get('step') || 1;
        const res = [];
        if (!stop && stop !== 0) {
            for (let i = 0; i < start; i++) {
                res.push(i);
            }
            return res;
        }
        if (start > stop)
            return res;
        for (let i = start; i < stop; i += step) {
            res.push(i);
        }
        return res;
    }),
    'log': (context) => __awaiter(void 0, void 0, void 0, function* () {
        const msg = context.get('message') || '';
        console.log(msg);
        return msg;
    }),
    'str': (context) => __awaiter(void 0, void 0, void 0, function* () {
        let val = context.get('val');
        let result = '';
        if (val instanceof Undefined) {
            return 'Undefined';
        }
        if (typeof val === 'object') {
            result += val.constructor.name;
            result += ': ';
            if (Array.isArray(val)) {
                result += '[';
                for (let item of val) {
                    result += `${yield builtInFunctions.str(item)}, `;
                }
                result = result.substring(0, result.length - 2);
                result += ']';
            }
            else {
                result += '{';
                for (let item in val) {
                    if (val.hasOwnProperty(item))
                        result += `${item}: ${yield builtInFunctions.str(val[item])}, `;
                }
                result = result.substring(0, result.length - 2);
                result += '}';
            }
        }
        else {
            result = `${val}`;
        }
        return result;
    })
};
export const builtInArgs = {
    'add': ['a', 'b'],
    'range': ['start', 'stop', 'step'],
    'log': ['message'],
    'str': ['val'],
};
