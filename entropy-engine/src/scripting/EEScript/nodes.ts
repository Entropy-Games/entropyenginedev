import {tokenTypeString, tt} from "./tokens.js";
import {Token} from "./tokens.js";
import {ESError, InvalidSyntaxError, ReferenceError, TypeError} from "./errors.js";
import {Context} from "./context.js";
import {Position} from "./position.js";
import {None, now, Undefined} from "./constants.js";
import {Entity} from "../../ECS/entity.js";
import {Transform} from "../../components/transform.js";
import {Script} from "../../components/scriptComponent.js";
import {publicField, publicFieldConfig} from "../../publicField.js";
import {v3} from "../../maths/v3.js";
import {v2} from "../../maths/v2.js";

export class interpretResult {
    val: any | undefined;
    error: ESError | undefined;
    funcReturn: any | undefined;
    shouldBreak = false;
    shouldContinue = false;
}

export abstract class Node {
    startPos: Position;
    endPos: Position;
    isTerminal;

    static interprets = 0;
    static totalTime = 0;
    static maxTime = 0;


    protected constructor (startPos: Position, endPos: Position, isTerminal= false) {
        this.endPos = endPos;
        this.startPos = startPos;
        this.isTerminal = isTerminal;
    }
    abstract interpret_ (context: Context): any;

    interpret (context: Context): interpretResult {
        const start = now();
        const res = new interpretResult();
        const val = this.interpret_(context);

        if (val instanceof ESError)
            res.error = val;

        else if (val instanceof interpretResult) {
            res.val = val.val;
            res.error = val.error;
            res.funcReturn = val.funcReturn;
            res.shouldBreak = val.shouldBreak;
            res.shouldContinue = val.shouldContinue;

        } else
            res.val = val;

        let time = now() - start;
        Node.interprets++;
        Node.totalTime += time;
        if (time > Node.maxTime) Node.maxTime = time;
        return res;
    }
}


// --- NON-TERMINAL NODES ---

export class N_binOp extends Node {
    left: Node;
    right: Node;
    opTok: Token;

    constructor (startPos: Position, endPos: Position, left: Node, opTok: Token, right: Node) {
        super(startPos, endPos);
        this.left = left;
        this.opTok = opTok;
        this.right = right;
    }

     interpret_(context: Context) {
        const left = this.left.interpret(context);
        const right = this.right.interpret(context);

        if (left.error) return left;
        if (right.error) return right;

        const l = left.val;
        const r = right.val;

        switch (this.opTok.type) {
            case tt.ADD:
                return l + r;
            case tt.DIV:
                return l / r;
            case tt.MUL:
                return l * r;
            case tt.SUB:
                return l - r;
            case tt.POW:
                return l ** r;
            case tt.LTE:
                return l <= r;
            case tt.GTE:
                return l >= r;
            case tt.GT:
                return l > r;
            case tt.LT:
                return l < r;
            case tt.EQUALS:
                return l === r;
            case tt.NOTEQUALS:
                return l !== r;
            case tt.AND:
                return l && r;
            case tt.OR:
                return l || r;

            default:
                return 0;
        }
    }
}

export class N_unaryOp extends Node {
    a: Node;
    opTok: Token;

    constructor (startPos: Position, endPos: Position, a: Node, opTok: Token) {
        super(startPos, endPos);
        this.a = a;
        this.opTok = opTok;
    }

    interpret_(context: Context) {
        const res = this.a.interpret(context);
        if (res.error) return res;

        switch (this.opTok.type) {
            case tt.SUB:
                return -res.val;
            case tt.ADD:
                return res.val;
            case tt.NOT:
                if (res.val instanceof Undefined)
                    return true;
                return !res.val;
            default:
                return new InvalidSyntaxError(
                    this.opTok.startPos,
                    this.opTok.endPos,
                    `Invalid unary operator: ${tokenTypeString[this.opTok.type]}`
                );

        }
    }
}

export class N_varAssign extends Node {
    value: Node;
    varNameTok: Token;
    isGlobal: boolean;
    isConstant: boolean;
    assignType: string;

    constructor(startPos: Position, endPos: Position, varNameTok: Token, value: Node, assignType='=', isGlobal=false, isConstant=false) {
        super(startPos, endPos);
        this.value = value;
        this.varNameTok = varNameTok;
        this.isGlobal = isGlobal;
        this.assignType = assignType;
        this.isConstant = isConstant;
    }

    interpret_(context: Context) {
        const res = this.value.interpret(context);
        if (res.error) return res;
        if (this.assignType === '=') {
            const setRes = context.set(this.varNameTok.value, res.val, {
                global: this.isGlobal,
                isConstant: this.isConstant
            });
            if (setRes instanceof ESError) return setRes;
        }
        else {
            const currentVal = context.get(this.varNameTok.value);
            if (currentVal instanceof ESError) return currentVal;
            let newVal;
            let assignVal = res.val;

            switch (this.assignType[0]) {
                case '*':
                    newVal = currentVal * assignVal;
                    break;
                case '/':
                    newVal = currentVal / assignVal;
                    break;
                case '+':
                    newVal = currentVal + assignVal;
                    break;
                case '-':
                    newVal = currentVal - assignVal;
                    break;
                default:
                    return new ESError(
                        this.startPos,
                        this.endPos,
                        'AssignError',
                        `Cannot find assignType of ${this.assignType[0]}`
                    );
            }

            let setRes = context.set(this.varNameTok.value, newVal, {
                global: this.isGlobal,
                isConstant: this.isConstant
            });
            if (setRes instanceof ESError) return setRes;
            res.val = newVal;
        }
        return res;
    }
}

export class N_if extends Node {
    comparison: Node;
    ifTrue: Node;
    ifFalse: Node | undefined;

    constructor (startPos: Position, endPos: Position,comparison: Node, ifTrue: Node, ifFalse: Node | undefined) {
        super(startPos, endPos);
        this.comparison = comparison;
        this.ifFalse = ifFalse;
        this.ifTrue = ifTrue;
    }

    interpret_(context: Context) {
        let newContext = new Context(context.get('__name__'));
        newContext.parent = context;
        let res: any = None;

        let compRes = this.comparison.interpret(context);
        if (compRes.error) return compRes;

        if (compRes.val) {
            res = this.ifTrue.interpret(newContext);
            // so that if statements always return a value of None
            res.val = None;
            if (res.error) return res;

        } else if (this.ifFalse) {
            res = this.ifFalse.interpret(newContext);
            // so that if statements always return a value of None
            res.val = None;
            if (res.error) return res;
        }

        return res;
    }
}

export class N_while extends Node {
    comparison: Node;
    loop: Node;

    constructor (startPos: Position, endPos: Position, comparison: Node, loop: Node) {
        super(startPos, endPos);
        this.comparison = comparison;
        this.loop = loop;
    }

    interpret_(context: Context): any {
        let newContext = new Context(context.get('__name__'));
        newContext.parent = context;

        if (this.loop.isTerminal) return;

        while (true) {
            let shouldLoop = this.comparison.interpret(context);
            if (shouldLoop.error) return shouldLoop;

            if (!shouldLoop.val) break;

            let potentialError = this.loop.interpret(newContext)
            if (potentialError.error) return potentialError;
            if (potentialError.shouldBreak) break;
        }

        return None;
    }
}

export class N_for extends Node {
    array: Node;
    body: Node;
    identifier: Token;
    isGlobalId: boolean;
    isConstId: boolean;

    constructor (startPos: Position, endPos: Position, body: Node, array: Node, identifier: Token, isGlobalIdentifier: boolean, isConstIdentifier: boolean) {
        super(startPos, endPos);
        this.body = body;
        this.array = array;
        this.identifier = identifier;
        this.isGlobalId = isGlobalIdentifier;
        this.isConstId = isConstIdentifier;
    }

    interpret_ (context: Context) {
        let newContext = new Context(context.get('__name__'));
        newContext.parent = context;
        let res: any = None;

        const array = this.array.interpret(context);
        if (array.error) return array;


        if (!Array.isArray(array.val) && !['string', 'number', 'object'].includes(typeof array.val)) return new TypeError(
            this.identifier.startPos,
            this.identifier.endPos,
            'array | string',
            typeof array.val
        );

        function iteration (body: Node, id: string, element: any, isGlobal: boolean, isConstant: boolean): 'break' | interpretResult | undefined {
            newContext.set(id, element, {
                global: isGlobal,
                isConstant
            });
            res = body.interpret(newContext);
            if (res.error || (res.funcReturn !== undefined)) return res;
            if (res.shouldBreak) {
                res.shouldBreak = false;
                return 'break';
            }
            if (res.shouldContinue)
                res.shouldContinue = false;
        }

        if (typeof array.val === 'number') {
            for (let i = 0; i < array.val; i++) {
                const res = iteration(this.body, this.identifier.value, i, this.isGlobalId, this.isConstId);
                if (res === 'break') break;
                if (res && (res.error || (res.funcReturn !== undefined))) return res;
            }

        } else if (typeof array.val === 'object' && !Array.isArray(array.val)) {
            for (let element in array.val) {
                const res = iteration(this.body, this.identifier.value, element, this.isGlobalId, this.isConstId);
                if (res === 'break') break;
                if (res && (res.error || (res.funcReturn !== undefined))) return res;
            }
        } else {
            for (let element of array.val) {
                const res = iteration(this.body, this.identifier.value, element, this.isGlobalId, this.isConstId);
                if (res === 'break') break;
                if (res && (res.error || (res.funcReturn !== undefined))) return res;
            }
        }


        return res;
    }
}

export class N_array extends Node {
    items: Node[];
    constructor(startPos: Position, endPos: Position, items: Node[]) {
        super(startPos, endPos);
        this.items = items;
    }

    interpret_ (context: Context) {
        let interpreted: any[] = [];

        for (let item of this.items) {
            const res = item.interpret(context);
            if (res.error || (res.funcReturn !== undefined)) return res;
            interpreted.push(res.val);
        }

        return interpreted;
    }
}

export class N_objectLiteral extends Node {
    properties: [Node, Node][];
    constructor(startPos: Position, endPos: Position, properties: [Node, Node][]) {
        super(startPos, endPos);
        this.properties = properties;
    }

    interpret_ (context: Context) {
        let interpreted: any = {};

        for (const [keyNode, valueNode] of this.properties) {
            const value = valueNode.interpret(context);
            if (value.error) return value;

            const key = keyNode.interpret(context);
            if (key.error) return key;

            interpreted[key.val] = value.val;
        }

        return interpreted;
    }
}

export class N_emptyObject extends Node {
    constructor(startPos: Position, endPos: Position) {
        super(startPos, endPos);
    }

    interpret_ (context: Context) {
        return {};
    }
}

export class N_statements extends Node {
    items: Node[];
    constructor(startPos: Position, endPos: Position, items: Node[]) {
        super(startPos, endPos);
        this.items = items;
    }

    interpret_ (context: Context) {
        for (let item of this.items) {
            const res = item.interpret(context);
            if (res.error || (res.funcReturn !== undefined) || res.shouldBreak || res.shouldContinue) return res;
        }

        return None;
    }
}

export class N_functionCall extends Node {
    arguments: Node[];
    to: Node;

    constructor (startPos: Position, endPos: Position, to: Node, args: Node[]) {
        super(startPos, endPos);
        this.arguments = args;
        this.to = to;
    }

    interpret_ (context: Context) {

        let func = this.to.interpret(context);
        if (func.error) return func;

        if (func.val instanceof N_function)
            return this.runFunc(func.val, context);

        else if (func.val instanceof N_builtInFunction)
            return this.runBuiltInFunction(func.val, context);

        else if (func.val instanceof N_class)
            return this.runConstructor(func.val, context);

        else if (typeof func.val === 'function') {
            return this.runJSFunction(context, func);

        } else
            return new TypeError(this.startPos, this.endPos, 'function', typeof func.val);
    }

    runJSFunction (context: Context, func: any) {
        let args: any = [];

        for (let arg of this.arguments) {
            let value = arg.interpret(context);
            if (value.error) return value.error;
            args.push(value.val);
        }

        try {
            return func.val(...args);
        } catch (e1) {
            try {
                return new func.val(...args);
            } catch (e2) {
                return new ESError(this.startPos, this.endPos, 'FunctionRunError', `Error running js function: '${e1}' and '${e2}'`)
            }
        }
    }

    genContext (context: Context, paramNames: string[]) {
        const newContext = new Context(context.get('__name__'));
        newContext.parent = context;

        let args = [];

        let max = Math.max(paramNames.length, this.arguments.length);
        for (let i = 0; i < max; i++) {
            let value = None;
            if (this.arguments[i] !== undefined) {
                let res = this.arguments[i].interpret(context);
                if (res.error) return res.error;
                value = res.val ?? None;
            }
            args.push(value);
            if (paramNames[i] !== undefined)
                newContext.set(paramNames[i], value);
        }

        let setRes = newContext.set('args', args);
        if (setRes instanceof ESError) return setRes;
        return newContext;
    }

    runFunc (func: N_function, context: Context) {
        const newContext = this.genContext(context, func.arguments);
        if (newContext instanceof ESError) return newContext;
        if (func.this_) {
            if (typeof func.this_ !== 'object')
                return new TypeError(
                    this.startPos,
                    this.endPos,
                    'object',
                    typeof func.this_,
                    func.this_,
                    '\'this\' must be an object'
                );

            let setRes = newContext.setOwn(func.this_, 'this');
            if (setRes instanceof ESError) return setRes;
        }
        if (!newContext.has('this')) {
            newContext.setOwn(None, 'this');
        }

        const res = func.body.interpret(newContext);

        if (res.funcReturn !== undefined) {
            res.val = res.funcReturn;
            res.funcReturn = undefined;
        }
        return res;
    }

    runBuiltInFunction (func: N_builtInFunction, context: Context) {
        const newContext = this.genContext(context, func.argNames);
        if (newContext instanceof ESError) return newContext;
        return func.interpret(newContext);
    }

    runConstructor (constructor: N_class, context: Context) {
        const newContext = this.genContext(context, constructor?.init?.arguments ?? []);
        if (newContext instanceof ESError) return newContext;
        return constructor.genInstance(newContext);
    }
}

export class N_function extends Node {
    body: Node;
    arguments: string[];
    name: string;
    this_: any;

    constructor(startPos: Position, endPos: Position, body: Node, argNames: string[], name = '<anon func>', this_: any = undefined) {
        super(startPos, endPos);
        this.arguments = argNames;
        this.body = body;
        this.name = name;
        this.this_ = this_;
    }

    interpret_ (context: Context): any {
        return this;
    }
}

export class N_builtInFunction extends Node {
    func: ((context: Context) => any) | any;
    argNames: string[];
    constructor(func: ((context: Context) => any) | any, argNames: string[]) {
        super(Position.unknown, Position.unknown);
        this.func = func;
        this.argNames = argNames;
    }

    interpret_ (context: Context) {
        // never called except to execute, so can use this function
        try {
            return this.func(context);
        } catch (e1) {
            try {
                return new this.func(...context.get('args'));
            } catch (e2) {
                return new ESError(this.startPos, this.endPos, 'BuiltInFunctionError', `Error running built-in function: '${e1}' and '${e2}'`)
            }
        }
    }
}

export class N_return extends Node {
    value: Node | undefined;
    constructor(startPos: Position, endPos: Position, value: Node | undefined) {
        super(startPos, endPos);
        this.value = value;
    }

    interpret_ (context: Context) {
        const res = new interpretResult();

        if (this.value === undefined)  {
            res.funcReturn = None;
            return res;
        }

        let val = this.value.interpret(context);
        if (val.error) return val.error;

        res.funcReturn = val.val;
        return res;
    }
}

export class N_yield extends Node {
    value: Node | undefined;
    constructor(startPos: Position, endPos: Position, value: Node | undefined) {
        super(startPos, endPos);
        this.value = value;
    }

    interpret_ (context: Context) {
        const res = new interpretResult();

        if (this.value === undefined)  {
            res.funcReturn = None;
            return res;
        }

        let val = this.value.interpret(context);
        if (val.error) return val.error;
        if (val.val)
            res.funcReturn = val.val;
        return res;
    }
}

export class N_indexed extends Node {
    base: Node;
    index: Node;
    value: Node | undefined;
    assignType: string | undefined;

    constructor(startPos: Position, endPos: Position, base: Node, index: Node) {
        super(startPos, endPos);
        this.base = base;
        this.index = index;
    }

    interpret_ (context: Context) {
        let baseRes = this.base.interpret(context);
        if (baseRes.error) return baseRes;

        let indexRes = this.index.interpret(context);
        if (indexRes.error) return indexRes;

        const index = indexRes.val;
        const base = baseRes.val;

        if (!['string', 'number'].includes(typeof index))
            return new TypeError(
                this.startPos, this.endPos,
                'string | number',
                typeof index,
                index,
                `With base ${base} and index ${index}`
            );

        if (!['object', 'function', 'string'].includes(typeof base))
            return new TypeError(
                this.startPos, this.endPos,
                'object | array | string | function',
                typeof base
            );

        if (this.value !== undefined) {
            let valRes = this.value.interpret(context);
            if (valRes.error) return valRes;

            const currentVal = base[index];
            let newVal;
            let assignVal = valRes.val;
            this.assignType ??= '=';

            switch (this.assignType[0]) {
                case '*':
                    newVal = currentVal * assignVal; break;
                case '/':
                    newVal = currentVal / assignVal; break;
                case '+':
                    newVal = currentVal + assignVal; break;
                case '-':
                    newVal = currentVal - assignVal; break;
                case '=':
                    newVal = assignVal;              break;
                default:
                    return new ESError(
                        this.startPos,
                        this.endPos,
                        'AssignError',
                        `Cannot find assignType of ${this.assignType[0]}`
                    );
            }

            base[index] = newVal ?? None;
        }

        return base[index];
    }
}

export class N_class extends Node {

    init: N_function | undefined;
    methods: N_function[];
    name: string;
    extends_: Node | undefined;
    instances: any[];

    constructor(startPos: Position, endPos: Position, methods: N_function[], extends_?: Node, init?: N_function, name = '<anon class>') {
        super(startPos, endPos);
        this.init = init;
        this.methods = methods;
        this.name = name;
        this.extends_ = extends_;
        this.instances = [];
    }

    interpret_ (context: Context) {
        return this;
    }

    genInstance (context: Context, runInit=true, on = {constructor: this})
        : {constructor: N_class } | ESError
    {
        function dealWithExtends(context_: Context, classNode: Node, instance: any) {
            const constructor = instance.constructor;
            const classNodeRes = classNode.interpret(context);
            if (classNodeRes.error) return classNodeRes.error;
            if (!(classNodeRes.val instanceof N_class))
                return new TypeError(
                    classNode.startPos,
                    classNode.endPos,
                    'N_class',
                    typeof classNodeRes.val,
                    classNodeRes.val
                );
            const extendsClass = classNodeRes.val;
            let setRes = context_.setOwn( () => {
                const newContext = new Context(context.get('__name__'));
                newContext.parent = context;
                let setRes = newContext.setOwn(instance, 'this');
                if (setRes instanceof ESError) return setRes;

                if (extendsClass.extends_ !== undefined) {
                    let _a = dealWithExtends(newContext, extendsClass.extends_, instance);
                    if (_a instanceof ESError) return _a;
                }

                const res_ = extendsClass?.init?.body?.interpret(newContext);
                if (res_ && res_.error) return res_;
            }, 'super');
            if (setRes instanceof ESError) return setRes;


            instance = extendsClass.genInstance(context, false, instance);
            if (instance instanceof ESError) return instance;

            // index access to prevent annoying wiggly red line
            instance.constructor = constructor;

            return instance;
        }

        let instance: any = on;

        const newContext = new Context(context.get('__name__'));
        newContext.parent = context;

        if (this.extends_ !== undefined) {
            let _a = dealWithExtends(newContext, this.extends_, instance);
            if (_a instanceof ESError) return _a;
        }

        for (let method of this.methods) {
            // shallow clone of method with instance as this_
            instance[method.name] = new N_function(
                method.startPos,
                method.endPos,
                method.body,
                method.arguments,
                method.name,
                instance
            );
        }

        if (runInit) {
            newContext.setOwn(instance, 'this');

            if (this.init) {
                const res = this.init.body.interpret(newContext);
                // return value of init is ignored
                if (res.error) return res.error;
            }
        }

        this.instances.push(instance);

        return instance;
    }
}

export class N_ESBehaviour extends Node {
    entity: Entity | undefined;
    transform: Transform | undefined;
    component: Script | undefined;
    started: boolean;
    entityNode: undefined | Node;

    tempPublic: publicField<any>[];

    init: N_function | undefined;
    methods: N_function[];
    name: string;

    publicVariables: N_objectLiteral[];

    constructor (startPos: Position, endPos: Position, methods: N_function[], init?: N_function, name = '<anon ESBehaviour>', publicVariables: N_objectLiteral[] = [], entityNode?: Node) {
        super(startPos, endPos);
        this.tempPublic = [];
        this.started = false;
        this.init = init;
        this.methods = methods;
        this.name = name;
        this.publicVariables = publicVariables;
        this.entityNode = entityNode;
    }

    interpret_ (context: Context) {
        if (this.entityNode && !this.entity) {
            let res = this.entityNode.interpret(context);
            if (res.error) return res;
            this.entity = res.val;
        }

        for (let method of this.methods) {
            // @ts-ignore
            this[method.name] = new N_function(
                method.startPos,
                method.endPos,
                method.body,
                method.arguments,
                method.name
            );
        }

        for (let publicVarRaw of this.publicVariables) {
            let res = publicVarRaw.interpret(context);
            if (res.error) return res;
            let type = res?.val?.type || undefined;
            let value = res?.val?.value;
            if (value instanceof v2) type = 'v2';
            else if (value instanceof v3) type = 'v3';
            this.addPublic({
                name: res?.val?.name || '',
                value,
                type,
                array: res?.val?.array || '',
                assetType: res?.val?.assetType || '',
                description: res?.val?.description || '',
                default: res?.val?.default || ''
            });
        }

        return this;
    }

    get public (): publicField<any>[] {
        return this?.component?.public || [];
    }

    // these are not used internally, but by the user when creating scripts
    public addPublic = <T>(config: publicFieldConfig<T>) => {
        if (!config.name) {
            console.error(`Public fields must have 'name' property`);
            return;
        }

        if (this.hasPublic(config.name)){
            console.error('Cannot add property with existing name: ' + config.name);
            return;
        }

        // @ts-ignore - doesn't like comparison to string
        if (config.value === undefined && config.default === undefined) {
            console.error(`Public fields must have 'value' property`);
            return;
        }

        // @ts-ignore - doesn't like comparison to string
        if (config.value === undefined)
            config.value = config.default;

        const field = new publicField(config);
        this.tempPublic.push(field);

        Object.defineProperty(this, config.name, {
            // so you can loop over it
            enumerable: true,

            get () {
                if (config.overrideGet === undefined)
                    return this.getPublic(config.name)

                return config.overrideGet();
            },
            set (value) {
                if (config.overrideSet === undefined) {
                    this.setPublic(config.name, value);
                    return;
                }

                config.overrideSet(value);
            }
        });

        return field;
    }

    public getPublic = (name: string) => {
        if (this.started)
            return this.component?.getPublic(name);

        for (let field of this.tempPublic) {
            if (field.name === name) {
                return field.value;
            }
        }
    }

    public setPublic = (name: string, value: any) => {
        if (this.started)
            return this.component?.setPublic(name, value);

        for (let field of this.tempPublic) {
            if (field.name === name) {
                field.value = value;
            }
        }
    }

    public hasPublic = (name: string): boolean => {
        if (this.started)
            return !!this.component?.hasPublic(name);


        for (let field of this.public) {
            if (field.name === name) {
                return true;
            }
        }

        return false;
    }
}

// --- TERMINAL NODES ---
export class N_number extends Node {
    a: Token;
    constructor(startPos: Position, endPos: Position, a: Token) {
        super(startPos, endPos, true);
        this.a = a;
    }
    interpret_ (context: Context): number | ESError {
        if (typeof this.a.value !== 'number') return new TypeError(
            this.startPos, this.endPos,
            'number',
            typeof this.a.value
        );

        return this.a.value;
    }
}

export class N_string extends Node {
    a: Token;
    constructor (startPos: Position, endPos: Position, a: Token) {
        super(startPos, endPos, true);
        this.a = a;
    }
    interpret_ (context: Context): string | ESError {
        if (typeof this.a.value !== 'string') return new TypeError(
            this.startPos, this.endPos,
            'string',
            typeof this.a.value
        );

        return this.a.value;
    }
}

export class N_variable extends Node {
    a: Token;
    constructor(startPos: Position, endPos: Position, a: Token) {
        super(startPos, endPos, true);
        this.a = a;
    }

    interpret_ (context: Context) {
        let val = context.get(this.a.value);

        if (val === undefined)
            return new ReferenceError(this.a.startPos, this.a.endPos, this.a.value);

        return val;
    }
}

export class N_undefined extends Node {

    constructor(startPos = Position.unknown, endPos = Position.unknown) {
        super(startPos, endPos, true);
    }

    interpret_ (context: Context) {
        return None;
    }
}

export class N_break extends Node {
    constructor(startPos: Position, endPos: Position) {
        super(startPos, endPos, true);
    }

    interpret_ (context: Context) {
        const res = new interpretResult();
        res.shouldBreak = true;
        return res;
    }
}
export class N_continue extends Node {
    constructor(startPos: Position, endPos: Position) {
        super(startPos, endPos, true);
    }

    interpret_ (context: Context) {
        const res = new interpretResult();
        res.shouldContinue = true;
        return res;
    }
}

export class N_any extends Node {
    val: any;
    constructor(value: any, startPos = Position.unknown, endPos = Position.unknown) {
        super(startPos, endPos, true);
        this.val = value;
    }

    interpret_ (context: Context) {
        return this.val;
    }
}


