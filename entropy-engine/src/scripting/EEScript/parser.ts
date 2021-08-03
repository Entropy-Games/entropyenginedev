import {Token, tokenType, tokenTypeString, tt} from "./tokens.js";
import {
    N_any,
    N_array,
    N_binOp,
    N_break,
    N_class,
    N_continue,
    N_emptyObject,
    N_ESBehaviour,
    N_for,
    N_function,
    N_functionCall,
    N_if,
    N_indexed,
    N_number,
    N_objectLiteral,
    N_return,
    N_statements,
    N_string,
    N_unaryOp,
    N_undefined,
    N_varAssign,
    N_variable,
    N_while,
    Node
} from './nodes.js';
import {ESError, InvalidSyntaxError} from "./errors.js";
import {Position} from "./position";

export class ParseResults {
    node: Node | undefined;
    error: ESError | undefined;

    reverseCount: number;
    lastRegisteredAdvanceCount: number;
    advanceCount: number;

    constructor () {
        this.advanceCount = 0;
        this.lastRegisteredAdvanceCount = 0;
        this.reverseCount = 0;
    }

    registerAdvance () {
        this.advanceCount = 1;
        this.lastRegisteredAdvanceCount += 1;
    }

    register (res: ParseResults | any): any {
        this.lastRegisteredAdvanceCount = res.advanceCount;
        this.advanceCount += res.advanceCount;
        if (res.error) this.error = res.error;
        return res.node;
    }

    tryRegister (res: ParseResults | any) {
        if (res.error) {
            this.reverseCount += res.advanceCount;
            return;
        }
        return this.register(res);
    }

    success (node: Node) {
        this.node = node;
        return this;
    }

    failure (error: ESError) {
        this.error = error;
        return this;
    }
}

export class Parser {
    tokens: Token[];
    currentToken: Token;
    tokenIdx: number;

    constructor (tokens: Token[]) {
        this.tokens = tokens;
        this.tokenIdx = -1;
        this.currentToken = tokens[0];
        this.advance();
    }

    public parse (): ParseResults {
        if (!this.currentToken || !this.tokens || (this.tokens.length === 1 && this.tokens[0].type === tt.EOF))
            return new ParseResults();

        const res = this.statements(true);

        if (!res.error && this.currentToken.type !== tokenType.EOF) {
            return res.failure(new InvalidSyntaxError(
                this.currentToken?.startPos,
                this.currentToken?.endPos,
                `Expected 'End of File', got token of type'${tokenTypeString[this.currentToken.type]}' of value ${this.currentToken.value}`
            ));
        }

        return res;
    }

    private advance (res?: ParseResults) {
        if (res) res.registerAdvance();

        this.tokenIdx++;
        this.currentToken = this.tokens[this.tokenIdx];
        return this.currentToken;
    }

    private reverse (amount = 1) {
        this.tokenIdx -= amount;
        this.currentToken = this.tokens[this.tokenIdx];
        return this.currentToken;
    }

    private consume (res: ParseResults, type: tokenType, errorMsg?: string) {
        if (this.currentToken.type !== type)
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                errorMsg ?? `Expected '${tokenTypeString[type]}' but got '${tokenTypeString[this.currentToken.type]}'`
            ));

        this.advance(res);
    }

    private clearEndStatements (res: ParseResults) {
        while (this.currentToken.type === tt.ENDSTATEMENT) {
            this.advance(res);
        }
    }

    private statements (useArray = false) {
        const res = new ParseResults();
        const startPos = this.currentToken.startPos;
        let statements = [];

        this.clearEndStatements(res);

        statements.push(res.register(this.statement()));
        if (res.error) return res;

        let moreStatements = true;

        while (true) {
            let newLineCount = 0;
            // @ts-ignore
            while (this.currentToken.type === tt.ENDSTATEMENT) {
                this.advance(res);
                newLineCount++;
            }
            if (newLineCount === 0)
                moreStatements = false;

            if (!moreStatements) break;
            const statement = res.tryRegister(this.statement());
            if (!statement) {
                this.reverse(res.reverseCount);
                continue;
            }
            statements.push(statement);
        }

        this.clearEndStatements(res);

        let node = new N_statements(startPos, this.currentToken.startPos.clone, statements);
        if (useArray)
            node = new N_array(startPos, this.currentToken.startPos.clone, statements);

        return res.success(node);
    }

    private statement () {
        const res = new ParseResults();
        const startPos = this.currentToken.startPos;

        if (this.currentToken.matches(tt.KEYWORD, 'return')) {
            this.advance(res);

            const expr = res.tryRegister(this.expr());
            if (!expr)
                this.reverse(res.reverseCount);
            return res.success(new N_return(startPos, this.currentToken.startPos.clone, expr));

        } else if (this.currentToken.matches(tt.KEYWORD, 'break')) {
            this.advance(res);
            return res.success(new N_break(startPos, this.currentToken.startPos.clone));

        } else if (this.currentToken.matches(tt.KEYWORD, 'continue')) {
            this.advance(res);
            return res.success(new N_continue(startPos, this.currentToken.startPos.clone));
        }

        const expr = res.register(this.expr());
        if (res.error) return res;

        return res.success(expr);
    }

    private atom () {
        const res = new ParseResults();
        const tok = this.currentToken;
        const startPos = this.currentToken.startPos;

        switch (tok.type) {
            case tt.NUMBER:
                this.advance(res);
                return res.success(new N_number(startPos, tok.endPos, tok));

            case tt.STRING:
                this.advance(res);
                return res.success(new N_string(startPos, tok.endPos, tok));

            case tt.IDENTIFIER:
                return this.atomIdentifier(res, startPos, tok);

            case tt.OPAREN:
                this.advance(res);
                const expr = res.register(this.expr());
                if (res.error) return res;
                if (this.currentToken.type == tt.CPAREN) {
                    this.advance(res);
                    return res.success(expr);
                }
                return res.failure(new InvalidSyntaxError(
                    this.currentToken.startPos,
                    this.currentToken.endPos,
                    "Expected ')'"
                ));

            case tt.OSQUARE:
                let arrayExpr = res.register(this.array());
                if (res.error) return res;
                return res.success(arrayExpr);

            case tt.OBRACES:
                let objectExpr = res.register(this.object());
                if (res.error) return res;
                return res.success(objectExpr);

            case tt.KEYWORD:
                if (tok.value === 'if') {
                    const expr = res.register(this.ifExpr());
                    if (res.error) return res;
                    return res.success(expr);
                }
                return res.failure(new InvalidSyntaxError(
                    this.currentToken.startPos,
                    this.currentToken.endPos,
                    `Invalid Identifier ${tok.value}`
                ));

            default:
                return res.failure(new InvalidSyntaxError(
                    this.currentToken.startPos,
                    this.currentToken.endPos,
                    `Expected number, identifier, '(', '+' or '-'`
                ));
        }
    }

    private atomIdentifier (res: ParseResults, startPos: Position, tok: Token) {
        this.advance(res);

        let node: Node = new N_variable(
            startPos,
            this.currentToken.endPos,
            tok
        );

        let prevNode: Node = new N_undefined(startPos, this.currentToken.endPos);

        let functionCall = false;

        while ([tt.OPAREN, tt.OSQUARE, tt.DOT].includes(this.currentToken.type)) {
            switch (this.currentToken.type) {
                case tt.OPAREN:
                    functionCall = true;
                    const tempNode = node;
                    node = res.register(this.makeFunctionCall(node, prevNode));
                    prevNode = tempNode;
                    if (res.error) return res;
                    break;

                case tt.OSQUARE:
                    prevNode = node;
                    node = res.register(this.makeIndex(node));
                    if (res.error) return res;
                    break;

                case tt.DOT:
                    this.advance(res);
                    // @ts-ignore
                    if (this.currentToken.type !== tt.IDENTIFIER)
                        return res.failure(new InvalidSyntaxError(
                            this.currentToken.startPos,
                            this.currentToken.endPos,
                            `Expected identifier after '.'`
                        ));

                    prevNode = node;
                    node = new N_indexed(
                        this.currentToken.startPos,
                        this.currentToken.endPos,
                        node,
                        new N_string(
                            this.currentToken.startPos,
                            this.currentToken.endPos,
                            this.currentToken
                        )
                    );
                    this.advance(res);
            }
        }

        if (this.currentToken.type === tt.ASSIGN) {
            let assignType = this.currentToken.value;
            if (functionCall) {
                return res.failure(new InvalidSyntaxError(
                    startPos,
                    this.currentToken.endPos,
                    `Cannot assign to return value of function`
                ));
            }
            this.advance(res);
            const value = res.register(this.expr());

            if (node instanceof N_variable) {
                node = new N_varAssign(
                    startPos,
                    this.currentToken.endPos,
                    node.a,
                    value,
                    assignType,
                    false
                );

            } else if (node instanceof N_indexed) {
                node.value = value;
                node.assignType = assignType;
            } else {
                return res.failure(new InvalidSyntaxError(
                    startPos,
                    this.currentToken.endPos,
                    `Cannot have node of type ${this.currentToken.constructor.name}. 
                            Expected either index or variable node.`
                ))
            }

            if (res.error) return res;
        }

        return res.success(node);
    }

    private power () {
         return this.binOp(() => this.atom(), [tokenType.POW], () => this.factor());
    }

    private factor (): ParseResults {
        const res = new ParseResults();
        const tok = this.currentToken;

        switch (tok.type) {

            case tt.SUB:
            case tt.ADD:
                this.advance(res);
                const factor = res.register(this.factor());
                if (res.error) return res;
                return res.success(new N_unaryOp(tok.startPos, factor.endPos, factor, tok));

            default:
                return this.power();
        }
    }

    private term () {
        return this.binOp(() => this.factor(), [tt.MUL, tt.DIV]);
    }

    private arithmeticExpr () {
        return this.binOp(() => this.term(), [tt.ADD, tt.SUB]);
    }

    private comparisonExpr (): ParseResults {
        const res = new ParseResults();
        if (this.currentToken.type === tt.NOT) {
            const opTok = this.currentToken;
            this.advance(res);

            let node = res.register(this.expr());
            if (res.error) return res;
            return res.success(new N_unaryOp(opTok.startPos, node.endPos, node, opTok));
        }

        let node = res.register(this.binOp(
            () => this.arithmeticExpr(),
            [tt.EQUALS, tt.NOTEQUALS, tt.GT, tt.GTE, tt.LTE, tt.LT]
        ));

        if (res.error) return res;

        return res.success(node);
    }

    private expr (): ParseResults {
        const res = new ParseResults();

        this.clearEndStatements(res);

        if (this.currentToken.type === tt.KEYWORD && ['var', 'let'].includes(this.currentToken.value)) {
            const exp = res.register(this.initiateVar(res, false, false));
            if (res.error) return res;
            return res.success(exp);

        } else if (this.currentToken.matches(tokenType.KEYWORD, 'global')) {
            const exp = res.register(this.initiateVar(res, true, false));
            if (res.error) return res;
            return res.success(exp);

        } else if (this.currentToken.matches(tokenType.KEYWORD, 'const')) {
            const exp = res.register(this.initiateVar(res, false, true));
            if (res.error) return res;
            return res.success(exp);

        } else if (this.currentToken.matches(tokenType.KEYWORD, 'if')) {
            const exp = res.register(this.ifExpr());
            if (res.error) return res;
            return res.success(exp);

        } else if (this.currentToken.matches(tokenType.KEYWORD, 'while')) {
            const exp = res.register(this.whileExpr());
            if (res.error) return res;
            return res.success(exp);

        } else if (this.currentToken.matches(tokenType.KEYWORD, 'for')) {
            const exp = res.register(this.forExpr());
            if (res.error) return res;
            return res.success(exp);

        } else if (this.currentToken.matches(tokenType.KEYWORD, 'func')) {
            const exp = res.register(this.funcExpr());
            if (res.error) return res;
            return res.success(exp);

        } else if (this.currentToken.matches(tokenType.KEYWORD, 'class')) {
            const exp = res.register(this.classExpr());
            if (res.error) return res;
            return res.success(exp);

        } else if (this.currentToken.matches(tokenType.KEYWORD, 'script')) {
            const exp = res.register(this.scriptExpr());
            if (res.error) return res;
            return res.success(exp);
        }


        let node = res.register(this.binOp(() => this.comparisonExpr(), [tt.AND, tt.OR]));

        if (res.error) return res;

        return res.success(node);
    }

    private binOp (func: () => ParseResults, ops: tokenType[] | [tokenType, string][], funcB=func): ParseResults {
        const res = new ParseResults();
        let left = res.register(func());
        if (res.error) return res;

        while (
            // @ts-ignore
            ops.indexOf(this.currentToken.type) !== -1
            // @ts-ignore
            || ops.indexOf([this.currentToken.type, this.currentToken.value]) !== -1
        ) {
            const opTok = this.currentToken;
            this.advance(res);
            const right = res.register(funcB());
            if (res.error) return res;
            left = new N_binOp(left.startPos, right.endPos, left, opTok, right);
        }

        return res.success(left);
    }

    private makeFunctionCall (to: Node, this_: Node = new N_undefined()) {
        const res = new ParseResults();
        let args: Node[] = [];
        const startPos = this.currentToken.startPos;

        if (this.currentToken.type !== tt.OPAREN)
            return res.failure(new InvalidSyntaxError(
                startPos,
                this.currentToken.endPos,
                "Expected '["
            ));

        this.advance(res);

        // @ts-ignore
        if (this.currentToken.type === tt.CPAREN) {
            this.advance(res);

            return res.success(new N_functionCall(startPos, this.currentToken.endPos, to, []));
        }

        args.push(res.register(this.expr()));
        if (res.error) return res.failure(new InvalidSyntaxError(
            this.currentToken.startPos, this.currentToken.endPos,
            "Invalid argument"
        ));

        // @ts-ignore
        while (this.currentToken.type === tt.COMMA) {
            this.advance(res);

            args.push(res.register(this.expr()));
            if (res.error) return res;
        }

        // @ts-ignore
        if (this.currentToken.type !== tt.CPAREN)
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected ',' or ')'"
            ));

        this.advance(res);

        return res.success(new N_functionCall(startPos, this.currentToken.endPos, to, args));
    }

    private makeIndex (to: Node) {
        const res = new ParseResults();
        const startPos = this.currentToken.startPos;

        const base = to;

        if (this.currentToken.type !== tt.OSQUARE)
            return res.failure(new InvalidSyntaxError(
                startPos,
                this.currentToken.endPos,
                "Expected '["
            ));

        this.advance(res);

        // @ts-ignore
        if (this.currentToken.type === tt.CSQUARE) {
            return res.failure(new InvalidSyntaxError(
                startPos, this.currentToken.endPos,
                `Cannot index without expression`
            ));
        }

        let index = res.register(this.expr());
        if (res.error) return res.failure(new InvalidSyntaxError(
            this.currentToken.startPos, this.currentToken.endPos,
            "Invalid index"
        ));

        // @ts-ignore
        if (this.currentToken.type !== tt.CSQUARE)
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected ']'"
            ));

        this.advance(res);

        return res.success(new N_indexed(
            startPos, this.currentToken.startPos,
            base,
            index
        ));
    }

    private initiateVar (res: ParseResults, isGlobal: boolean, isConstant: boolean): ParseResults {
        let startPos = this.currentToken.startPos;

        if (this.currentToken.type === tt.KEYWORD) {
            if (!['global', 'var', 'let', 'const'].includes(this.currentToken.value))
                return res.failure(new InvalidSyntaxError(
                    this.currentToken.startPos,
                    this.currentToken.endPos,
                    `Expected Identifier 'var', 'let', 'const' or 'global', not ${this.currentToken.value}`
                ));

            this.advance(res);
        }

        if (this.currentToken.type !== tokenType.IDENTIFIER) {
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                `Expected Identifier`
            ));
        }

        const varName = this.currentToken;
        this.advance(res);

        // @ts-ignore doesn't like two different comparisons after each other with different values
        if (this.currentToken.type !== tt.ASSIGN) {
            if (isConstant)
                return res.failure(new InvalidSyntaxError(
                    startPos,
                    this.currentToken.endPos,
                    'Cannot initialise constant to undefined'
                ));

            return res.success(new N_varAssign(
                startPos, this.currentToken.startPos,
                varName,
                new N_undefined(this.currentToken.startPos, this.currentToken.endPos),
                '=',
                isGlobal,
                // must be false ^
                isConstant
            ));
        }

        let assignType = this.currentToken.value;

        this.advance(res);
        const expr = res.register(this.expr());
        if (res.error) return res;

        if (expr instanceof N_class)
            expr.name = varName.value;
        else if (expr instanceof N_function)
            expr.name = varName.value;

        return res.success(new N_varAssign(
            startPos,
            this.currentToken.startPos,
            varName,
            expr,
            assignType,
            isGlobal,
            isConstant
        ));
    }

    private bracesExp (): ParseResults {
        const res = new ParseResults();

        if (this.currentToken.type !== tt.OBRACES) {
            const expr = res.register(this.statement());
            if (res.error) return res;
            this.clearEndStatements(res);
            return res.success(expr);
        }
        // clear brace
        this.advance(res);

        this.clearEndStatements(res);

        // @ts-ignore
        if (this.currentToken.type === tt.CBRACES) {
            this.advance(res);
            return res.success(new N_undefined(this.currentToken.startPos, this.currentToken.endPos));
        }
        const expr = res.register(this.statements());
        if (res.error) return res;

        // @ts-ignore
        if (this.currentToken.type !== tt.CBRACES)
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected '}'"
            ));

        this.advance(res);

        return res.success(expr);
    }

    private addEndStatement (res: ParseResults) {
        this.tokens.splice(this.tokenIdx, 0, new Token(
            this.currentToken.startPos,
            this.currentToken.endPos,
            tt.ENDSTATEMENT
        ));
        this.reverse();
        this.advance(res);
    }

    private ifExpr (): ParseResults {
        const res = new ParseResults();
        let ifTrue;
        let ifFalse;
        let condition;

        const startPos = this.currentToken.startPos;

        if (!this.currentToken.matches(tt.KEYWORD, 'if'))
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected 'if'"
            ));

        this.advance(res);

        if (this.currentToken.type !== tt.OPAREN)
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected '(' after 'if'"
            ));

        this.advance(res);

        condition = res.register(this.expr());
        if (res.error) return res;

        // @ts-ignore - comparison again
        if (this.currentToken.type !== tt.CPAREN)
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected ')' after 'if (condition'"
            ));

        this.advance(res);

        ifTrue = res.register(this.bracesExp());
        if (res.error) return res;

        this.clearEndStatements(res);

        if (this.currentToken.matches(tt.KEYWORD, 'else')) {
            this.advance(res);

            ifFalse = res.register(this.bracesExp());
            if (res.error) return res;
        }

        this.addEndStatement(res);

        return res.success(new N_if(startPos, this.currentToken.startPos, condition, ifTrue, ifFalse));
    }

    private whileExpr (): ParseResults {
        const res = new ParseResults();
        let loop;
        let condition;
        const startPos = this.currentToken.startPos;

        if (!this.currentToken.matches(tt.KEYWORD, 'while'))
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected 'while'"
            ));

        this.advance(res);

        if (this.currentToken.type !== tt.OPAREN)
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected '(' after 'while'"
            ));

        this.advance(res);

        condition = res.register(this.expr());
        if (res.error) return res;

        // @ts-ignore - comparison again
        if (this.currentToken.type !== tt.CPAREN)
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected ')' after 'while (condition'"
            ));

        this.advance(res);

       loop = res.register(this.bracesExp());
       if (res.error) return res;

       this.addEndStatement(res);

        return res.success(new N_while(startPos, this.currentToken.startPos, condition, loop));
    }

    private funcCore (): ParseResults {
        const res = new ParseResults();
        const startPos = this.currentToken.startPos;
        let body: Node,
            args: string[] = [];

        if (this.currentToken.type !== tt.OPAREN)
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected '(' after 'func'"
            ));

        this.advance(res);

        // @ts-ignore
        if (this.currentToken.type === tt.CPAREN) {
            this.advance(res);

            args = [];
        } else {

            // @ts-ignore
            if (this.currentToken.type !== tt.IDENTIFIER) return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos, this.currentToken.endPos,
                "Expected identifier"
            ));
            args.push(this.currentToken.value);
            this.advance(res);

            // @ts-ignore
            while (this.currentToken.type === tt.COMMA) {
                this.advance(res);

                // @ts-ignore
                if (this.currentToken.type !== tt.IDENTIFIER) return res.failure(new InvalidSyntaxError(
                    this.currentToken.startPos, this.currentToken.endPos,
                    "Expected identifier"
                ));
                args.push(this.currentToken.value);
                this.advance(res);
            }

            // @ts-ignore
            if (this.currentToken.type !== tt.CPAREN)
                return res.failure(new InvalidSyntaxError(
                    this.currentToken.startPos,
                    this.currentToken.endPos,
                    "Expected ',' or ')'"
                ));

            this.advance(res);
        }

        body = res.register(this.bracesExp());
        if (res.error) return res;

        return res.success(new N_function(startPos, this.currentToken.endPos, body, args));
    }

    private funcExpr (): ParseResults {
        const res = new ParseResults();

        if (!this.currentToken.matches(tt.KEYWORD, 'func'))
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected 'func'"
            ));

        this.advance(res);

        const func = res.register(this.funcCore());
        if (res.error) return res;

        return res.success(func);
    }

    private classExpr (name?: string): ParseResults {
        const res = new ParseResults();
        const startPos = this.currentToken.startPos;
        const methods: N_function[] = [];
        let init: N_function | undefined = undefined;
        let extends_: Node | undefined;

        if (!this.currentToken.matches(tt.KEYWORD, 'class'))
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected 'class'"
            ));
        this.advance(res);

        if (this.currentToken.matches(tt.KEYWORD, 'extends')) {
            this.advance(res);

            extends_ = res.register(this.expr());
            if (res.error) return res;
        }

        this.consume(res, tt.OBRACES);
        if (res.error) return res;

        if (this.currentToken.type === tt.CBRACES) {
            this.advance(res);
            return res.success(new N_class(
                startPos,
                this.currentToken.startPos,
                [],
                undefined,
                undefined,
                name
            ));
        }

        while (true) {
            if (this.currentToken.type !== tt.IDENTIFIER)
                break;
            let methodId = this.currentToken.value;
            const isInit = methodId === 'init';
            this.advance(res);

            const func = res.register(this.funcCore());
            if (res.error) return res;

            func.name = methodId;

            if (isInit)
                init = func;
            else
                methods.push(func);
        }

        this.consume(res, tt.CBRACES);

        return res.success(new N_class(
            startPos,
            this.currentToken.startPos,
            methods,
            extends_,
            init,
            name
        ));
    }

    private scriptExpr (): ParseResults {
        const res = new ParseResults();
        const startPos = this.currentToken.startPos;
        const methods: N_function[] = [];
        const publicVariables: N_objectLiteral[] = [];
        let name: string | undefined;

        if (!this.currentToken.matches(tt.KEYWORD, 'script'))
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected 'script'"
            ));
        this.advance(res);

        if (this.currentToken.type === tt.IDENTIFIER) {
            name = this.currentToken.value;
            this.advance(res);
        }

        this.consume(res, tt.OBRACES);
        if (res.error) return res;

        if (this.currentToken.type === tt.CBRACES) {
            this.advance(res);
            return res.success(new N_ESBehaviour(
                startPos,
                this.currentToken.startPos,
                [],
                undefined,
                name
            ));
        }

        while (true) {

            if (this.currentToken.type === tt.OBRACES) {
                let publicFieldNode = res.register(this.object());
                if (res.error) return res;
                publicVariables.push(publicFieldNode);
            } else if (this.currentToken.type === tt.IDENTIFIER) {

                let methodId = this.currentToken.value;
                this.advance(res);

                // @ts-ignore
                if (this.currentToken.type === tt.ASSIGN) {
                    this.advance(res);
                    let expr = res.register(this.expr());
                    if (res.error) return res;

                    publicVariables.push(new N_objectLiteral(
                        startPos,
                        this.currentToken.startPos,
                        [
                            [
                                new N_any('name'),
                                new N_any(methodId)
                            ],
                            [
                                new N_any('value'),
                                expr
                            ]
                        ]
                    ));

                    this.consume(res, tt.ENDSTATEMENT);

                // @ts-ignore
                } else if (this.currentToken.type === tt.OPAREN) {
                    const func = res.register(this.funcCore());
                    if (res.error) return res;

                    func.name = methodId;

                    methods.push(func);
                } else return res.failure(new InvalidSyntaxError(
                    this.currentToken.startPos,
                    this.currentToken.endPos,
                    `Expected either '(' or '=', but got `
                ));

            } else break;

        }

        this.consume(res, tt.CBRACES);

        return res.success(new N_ESBehaviour(
            startPos,
            this.currentToken.startPos,
            methods,
            undefined,
            name,
            publicVariables
        ));
    }

    private forExpr (): ParseResults {
        const res = new ParseResults();
        const startPos = this.currentToken.startPos;
        let body: Node,
            array: Node,
            identifier: Token,
            isGlobalIdentifier = false,
            isConstIdentifier = false;

        if (!this.currentToken.matches(tt.KEYWORD, 'for'))
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected 'for'"
            ));

        this.advance(res);

        this.consume(res, tt.OPAREN);

        if (this.currentToken.matches(tt.KEYWORD, 'global')) {
            isGlobalIdentifier = true;
            this.advance(res);
        }else if (this.currentToken.matches(tt.KEYWORD, 'const')) {
            isConstIdentifier = true;
            this.advance(res);
        } else if (this.currentToken.matches(tt.KEYWORD, 'var') || this.currentToken.matches(tt.KEYWORD, 'let')) {
            this.advance(res);
        }


        // @ts-ignore - comparison again
        if (this.currentToken.type !== tt.IDENTIFIER)
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected identifier"
            ));
        identifier = this.currentToken;

        this.advance(res);

        if (!this.currentToken.matches(tt.KEYWORD, 'in'))
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected keyword 'in"
            ));

        this.advance(res);

        array = res.register(this.expr());
        if (res.error) return res;

        // @ts-ignore - comparison again
        if (this.currentToken.type !== tt.CPAREN)
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected ')'"
            ));

        this.advance(res);

        body = res.register(this.bracesExp());
        if (res.error) return res;

        this.addEndStatement(res);

        return res.success(new N_for(
            startPos, this.currentToken.startPos, body, array, identifier, isGlobalIdentifier, isConstIdentifier
        ));
    }

    private array () {
        const res = new ParseResults();
        let elements: Node[] = [];
        const startPos = this.currentToken.startPos;

        if (this.currentToken.type !== tt.OSQUARE)
            return res.failure(new InvalidSyntaxError(
                startPos,
                this.currentToken.endPos,
                "Expected '["
            ));

        this.advance(res);

        // @ts-ignore
        if (this.currentToken.type === tt.CSQUARE) {
            this.advance(res);

            return res.success(new N_array(startPos, this.currentToken.endPos, []));
        }

        elements.push(res.register(this.expr()));
        if (res.error) return res.failure(new InvalidSyntaxError(
            this.currentToken.startPos, this.currentToken.endPos,
            "Expected ']', 'var', 'if', 'for', 'while', number, identifier, '+', '-', '(', '[' or '!' 2"
        ));

        // @ts-ignore
        while (this.currentToken.type === tt.COMMA) {
            this.advance(res);

            elements.push(res.register(this.expr()));
            if (res.error) return res;
        }

        // @ts-ignore
        if (this.currentToken.type !== tt.CSQUARE)
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected ',' or ']'"
            ));

        this.advance(res);

        return res.success(new N_array(startPos, this.currentToken.endPos, elements));

    }

    private object () {
        const res = new ParseResults();
        let properties: [Node, Node][] = [];
        const startPos = this.currentToken.startPos;

        if (this.currentToken.type !== tt.OBRACES)
            return res.failure(new InvalidSyntaxError(
                startPos,
                this.currentToken.endPos,
                "Expected '{"
            ));

        this.advance(res);

        // @ts-ignore
        if (this.currentToken.type === tt.CBRACES) {
            this.advance(res);
            return res.success(new N_emptyObject(startPos, this.currentToken.endPos));
        }
        // @ts-ignore
        while (true) {

            let keyType: string,
                key: Node,
                value: Node;

            // @ts-ignore
            if (this.currentToken.type === tt.IDENTIFIER) {
                keyType = 'id';
                key = new N_string(
                    this.currentToken.startPos,
                    this.currentToken.endPos,
                    this.currentToken
                );
                this.advance(res);

            // @ts-ignore
            } else if (this.currentToken.type === tt.STRING) {
                keyType = 'string';
                key = new N_string(
                    this.currentToken.startPos,
                    this.currentToken.endPos,
                    this.currentToken
                );
                this.advance(res);

            // @ts-ignore
            } else if (this.currentToken.type === tt.OSQUARE) {
                keyType = 'value';
                this.advance(res);
                key = res.register(this.expr());
                if (res.error) return res;
                if (this.currentToken.type !== tt.CSQUARE)
                    return res.failure(new InvalidSyntaxError(
                        this.currentToken.startPos,
                        this.currentToken.endPos,
                        `Expected ']', got '${tokenTypeString[this.currentToken.type]}'`
                    ));
                this.advance(res);
            } else
                break;

            if (this.currentToken.type === tt.COLON) {
                this.advance(res);
                value = res.register(this.expr());
                if (res.error) return res;

                if (this.currentToken.type !== tt.COMMA && this.currentToken.type !== tt.CBRACES)
                    return res.failure(new InvalidSyntaxError(
                        this.currentToken.startPos,
                        this.currentToken.endPos,
                        `Expected ',' or '}', got '${tokenTypeString[this.currentToken.type]}'`
                    ));

                if (this.currentToken.type === tt.COMMA)
                    this.advance(res);

            } else {
                if (this.currentToken.type !== tt.COMMA && this.currentToken.type !== tt.CBRACES)
                    return res.failure(new InvalidSyntaxError(
                        this.currentToken.startPos,
                        this.currentToken.endPos,
                        `Expected ',' or '}', got '${tokenTypeString[this.currentToken.type]}'`
                    ));

                if (keyType !== 'id')
                    return res.failure(new InvalidSyntaxError(
                        this.currentToken.startPos,
                        this.currentToken.endPos,
                        `You must specify a value when initialising an object literal with a key that is not an identifier.
                        Try using \`key: value\` syntax.`
                    ));

                // reverse back to the identifier
                this.reverse();

                value = new N_variable (
                    this.currentToken.startPos,
                    this.currentToken.endPos,
                    this.currentToken,
                );
                this.advance(res);
                if (this.currentToken.type === tt.COMMA)
                    this.advance(res);
            }

            properties.push([key, value]);
            if (res.error) return res;
        }

        // @ts-ignore
        if (this.currentToken.type !== tt.CBRACES)
            return res.failure(new InvalidSyntaxError(
                this.currentToken.startPos,
                this.currentToken.endPos,
                "Expected identifier, ',' or '}'"
            ));

        this.advance(res);

        return res.success(new N_objectLiteral(startPos, this.currentToken.endPos, properties));

    }
}
