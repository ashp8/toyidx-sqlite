declare module '*sql_engine.js' {
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

    export enum TokenType {
        Keyword = 0,
        Identifier = 1,
        Number = 2,
        String = 3,
        Operator = 4,
        Punctuation = 5,
        EOF = 6
    }

    interface WasmModule {
        Lexer: typeof Lexer;
        TokenType: typeof TokenType;
    }

    const initSqlEngine: () => Promise<WasmModule>;
    export default initSqlEngine;
}
