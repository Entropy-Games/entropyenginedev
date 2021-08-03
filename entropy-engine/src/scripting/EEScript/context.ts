import {initialise} from "./init.js";
import {ESError, TypeError} from "./errors.js";
import {Position} from "./position.js";

export type symbolOptions = {
    isConstant?: boolean;
    isAccessible?: boolean;
    global?: boolean;
}

export class ESSymbol {
    isConstant: boolean;
    value: any;
    identifier: string;
    isAccessible: boolean;

    constructor (value: any, identifier: string, options: symbolOptions = {}) {
        this.value = value;
        this.identifier = identifier;
        this.isConstant = options.isConstant ?? false;
        this.isAccessible = options.isAccessible ?? true;
    }
}

export class Context {
    private symbolTable: {[identifier: string]: ESSymbol};
    parent: Context | undefined;
    initialisedAsGlobal = false;
    deleted = false;

    constructor (fileName='__main__') {
        this.symbolTable = {
            __name__: new ESSymbol(fileName, '__name__', {
                isConstant: true,
                isAccessible: true,
                global: true
            }),
        };
    }

    has (identifier: string) {
        return this.getSymbol(identifier) !== undefined;
    }

    hasOwn (identifier: string) {
        return this.symbolTable[identifier] instanceof ESSymbol;
    }

    get (identifier: string): undefined | ESError | any {
        let symbol = this.getSymbol(identifier);
        if (symbol instanceof ESError || symbol == undefined) return symbol;
        return symbol.value;
    }

    getSymbol (identifier: string): undefined | ESSymbol | ESError {
        let symbol = this.symbolTable[identifier];
        if (symbol !== undefined && !symbol.isAccessible)
            return new TypeError(
                Position.unknown,
                Position.unknown,
                'assessable',
                'inaccessible',
                symbol.identifier
            );
        if (symbol === undefined && this.parent) {
            let res: any = this.parent.getSymbol(identifier);
            if (res instanceof ESError)
                return res;
            symbol = res;
        }

        return symbol;
    }

    set (identifier: string, value: any, options: symbolOptions = {}) {
        let context: Context = this;

        if (options.global) {
            context = this.root;
        } else {
            // searches upwards to find the identifier, and if none can be found then it assigns it to the current context
            while (!context.hasOwn(identifier) && context.parent !== undefined) {
                context = context.parent;
            }
            if (!context.hasOwn(identifier))
                context = this;
        }
        return context.setOwn(value, identifier, options);
    }

    setOwn (value: any, identifier: string, options: symbolOptions = {}) {
        // is not global
        if (options.global && !this.initialisedAsGlobal) options.global = false;
        let symbol = this.getSymbol(identifier);
        if (symbol instanceof ESError) return symbol;
        if (symbol?.isConstant) {
            return new TypeError(
                Position.unknown,
                Position.unknown,
                'dynamic',
                'constant',
                identifier
            );
        }

        this.symbolTable[identifier] = new ESSymbol(value, identifier, options);
        return value;
    }

    remove (identifier: string) {
        delete this.symbolTable[identifier];
    }
/*
    delete () {
        for (let symbol in this.symbolTable)
            this.remove(symbol);

        this.parent = undefined;
        this.deleted = true;
    }

 */

    get root () {
        let parent: Context = this;

        while (parent.parent)
            parent = parent.parent;

        return parent;
    }

    resetAsGlobal () {
        if (!this.initialisedAsGlobal) return;

        const printFunc = this.root.get('print');

        this.symbolTable = {};
        this.initialisedAsGlobal = false;

        initialise(this, printFunc?.func || console.log);
    }
}