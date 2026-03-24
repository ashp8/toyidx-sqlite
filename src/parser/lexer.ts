import { Token, TokenType, ParserError } from "./types";

export class Lexer {
    private pos = 0;
    private char = "";
    private line = 1;
    private col = 1;

    constructor(private sql: string) {
        this.char = sql[0] || "";
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

        const val = this.char;
        this.advance();
        return {
            type: TokenType.Punctuation, value: val, line: startLine, column: startCol
        }
    }
}