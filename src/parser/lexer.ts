import { Token, TokenType, ParserError } from "./types";

export class Lexer {
    private pos = 0;
    private char = "";
    private line = 1;
    private col = 1;

    private wasmLexer: any;

    constructor(private sql: string, wasmModule?: any) {
        if (wasmModule && wasmModule.Lexer) {
            this.wasmLexer = new wasmModule.Lexer(sql);
        } else {
            this.char = sql[0] || "";
        }
    }

    private advance() {
        if (this.char === '\n') {
            this.line++;
            this.col = 1;
        } else {
            this.col++;
        }
        this.pos++;
        this.char = this.pos < this.sql.length ? this.sql[this.pos]! : "";
    }

    public nexToken(): Token {
        if (this.wasmLexer) {
            const token = this.wasmLexer.nextToken();
            // Emscripten enums might be returned as objects with a .value property or similar.
            // We want the numeric value to match TS TokenType enum.
            const type = typeof token.type === 'object' ? token.type.value : token.type;
            return {
                type: type,
                value: token.value,
                line: token.line,
                column: token.column
            };
        }

        while (this.char && /\s/.test(this.char)) this.advance();
        if (!this.char) return {
            type: TokenType.EOF, value: "", line: this.line, column: this.col
        }

        const startLine = this.line;
        const startCol = this.col;

        if (/\d/.test(this.char)) {
            let value = "";
            while (/\d/.test(this.char)) {
                value += this.char;
                this.advance();
            }
            return {
                type: TokenType.Number, value, line: startLine, column: startCol
            }
        }

        if (/[a-zA-Z_]/.test(this.char)) {
            let value = "";
            while (/[a-zA-Z0-9_]/.test(this.char)) {
                value += this.char;
                this.advance();
            }
            return {
                type: TokenType.Identifier, value, line: startLine, column: startCol
            }
        }

        if (this.char === "'" || this.char === '"') {
            const quote = this.char;
            let value = "";
            this.advance();
            while (this.char && this.char !== quote) {
                value += this.char;
                this.advance();
            }
            if (this.char === quote) {
                this.advance();
            } else {
                throw new ParserError("Unterminated string literal", startLine, startCol);
            }
            return {
                type: TokenType.String, value, line: startLine, column: startCol
            }
        }

        // Check for operators
        const opChars = ['=', '>', '<', '!', '|', '*', '+', '-', '/', '%'];
        if (opChars.includes(this.char)) {
            let val = this.char;
            this.advance();
            if ((val === '=' || val === '>' || val === '<' || val === '!') && this.char === '=') {
                val += this.char;
                this.advance();
            } else if (val === '|' && this.char === '|') {
                val += this.char;
                this.advance();
            } else if (val === '<' && this.char === '>') {
                val += this.char;
                this.advance();
            }
            return {
                type: TokenType.Operator, value: val, line: startLine, column: startCol
            };
        }

        const val = this.char;
        this.advance();
        return {
            type: TokenType.Punctuation, value: val, line: startLine, column: startCol
        }
    }

    public dispose() {
        if (this.wasmLexer && this.wasmLexer.delete) {
            this.wasmLexer.delete();
        }
    }
}