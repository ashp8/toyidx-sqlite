export interface Token {
    type: any;
    value: string;
    line: number;
    column: number;
}

export class Lexer {
    constructor(sql: string);
    nextToken(): Token;
    delete(): void;
}

export class Parser {
    constructor(lexer: Lexer);
    parse(): any;
    delete(): void;
}

export class IStorage {
    static extend(name: string, proto: any): any;
}

export class Executor {
    constructor(storage: any);
    execute(stmt: any): any;
    delete(): void;
}

export enum TokenType {
    Keyword = 0,
    Identifier = 1,
    Number = 2,
    String = 3,
    Operator = 4,
    Punctuation = 5,
    EOF = 6
}

export interface WasmModule {
    Lexer: typeof Lexer;
    Parser: typeof Parser;
    Executor: typeof Executor;
    IStorage: typeof IStorage;
    TokenType: typeof TokenType;
}

declare const initSqlEngine: (options?: any) => Promise<WasmModule>;
export default initSqlEngine;
