var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { ESError, TestFailed } from "./errors.js";
import { run } from "./index.js";
import { Context } from "./context.js";
import { global } from "./constants.js";
export class TestResult {
    constructor() {
        this.time = 0;
        this.failed = 0;
        this.passed = 0;
        this.fails = [];
    }
    register(res) {
        if (typeof res === 'boolean') {
            if (res)
                this.passed++;
            else
                this.failed++;
            return;
        }
        if (res instanceof ESError) {
            this.failed++;
            this.fails.push(res);
            return;
        }
        this.failed += res.failed;
        this.passed += res.passed;
    }
    str() {
        return `
            ---   TEST REPORT   ---
                ${this.failed} tests failed
                ${this.passed} tests passed
                
            In ${this.time}ms
            
            ${this.failed === 0 ? 'All tests passed!' : ''}
            
            ${this.fails.map(error => `\n-----------------\n${error.str}\n`)}
        `;
    }
}
export class Test {
    constructor(test, id = 'test') {
        this.id = id;
        this.test = test;
    }
    run(env) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.test(env);
        });
    }
    static test(test) {
        Test.tests.push(new Test(test, Test.tests.length));
    }
    static testAll() {
        return __awaiter(this, void 0, void 0, function* () {
            const res = new TestResult();
            const time = performance.now();
            for (let test of Test.tests) {
                global.resetAsGlobal();
                const testEnv = new Context();
                testEnv.parent = global;
                res.register(yield test.run(testEnv));
            }
            res.time = Math.round(performance.now() - time);
            return res;
        });
    }
}
Test.tests = [];
function arraysSame(arr1, arr2) {
    if (!Array.isArray(arr1) || !Array.isArray(arr2))
        return false;
    if (arr1.length !== arr2.length)
        return false;
    for (let i = 0; i < arr1.length; i++) {
        if (Array.isArray(arr1[i])) {
            if (!Array.isArray(arr1[i]))
                return false;
            return arraysSame(arr1[i], arr2[i]);
        }
        if (arr1[i] !== arr2[i])
            return false;
    }
    return true;
}
export function expect(expected, from) {
    Test.test((env) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        let result = yield run(from, env);
        if (result.error && Array.isArray(expected))
            return new TestFailed(`Unexpected error encountered when running test. Expected '${expected}' but got error: 
${result.error.str}
with code 
'${from}'\n`);
        if (Array.isArray(result.val))
            for (let i = 0; i < result.val.length; i++) {
                if (typeof result.val[i] === 'object' && !Array.isArray(result.val[i]))
                    result.val[i] = (_b = (_a = result.val[i]) === null || _a === void 0 ? void 0 : _a.constructor) === null || _b === void 0 ? void 0 : _b.name;
            }
        function test() {
            var _a, _b, _c;
            if (result.error || typeof expected === 'string') {
                if (!result.error)
                    return false;
                if (Array.isArray(expected))
                    return false;
                return ((_c = (_b = (_a = result === null || result === void 0 ? void 0 : result.error) === null || _a === void 0 ? void 0 : _a.constructor) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : '') === expected;
            }
            return arraysSame(expected, result.val);
        }
        const res = test();
        if (res)
            return true;
        const val = result.error || result.val;
        console.log(expected, val);
        return new TestFailed(`Expected '${expected}' but got '${val}' instead from test with code \n'${from}'\n`);
    }));
}
