import { Token, TokenType } from "./types";

export class Lexer {
    private pos = 0;
    private char = "";

    constructor(private sql: string) {
        this.char = sql[0] || "";
    }

    private advance() {
        this.pos++;
        this.char = this.pos < this.sql.length ? this.sql[this.pos]! : "";
    }

    public nexToken(): Token {
        while (this.char && /\s/.test(this.char)) this.advance();
        if (!this.char) return {
            type: TokenType.EOF, value: "", line: 0, column: this.pos
        }

        if (/\d/.test(this.char)) {
            let value = "";
            while (/\d/.test(this.char)) {
                value += this.char;
                this.advance();
            }
            return {
                type: TokenType.Number, value, line: 0, column: this.pos
            }
        }

        if (/[a-zA-Z_]/.test(this.char)) {
            let value = "";
            while (/[a-zA-Z0-9_]/.test(this.char)) {
                value += this.char;
                this.advance();
            }
            return {
                type: TokenType.Identifier, value, line: 0, column: this.pos
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
            }
            return {
                type: TokenType.String, value, line: 0, column: this.pos
            }
        }

        const val = this.char;
        this.advance();
        return {
            type: TokenType.Punctuation, value: val, line: 0, column: this.pos
        }
    }
}