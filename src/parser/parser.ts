import { Lexer } from "./lexer";
import { CreateTableStatement, Statement, Token, TokenType, InsertStatement, SelectStatement, UpdateStatement, DeleteStatement, WhereClause, CreateIndexStatement, DropIndexStatement, ParserError } from "./types";

export class Parser {
    private currentToken: Token;
    constructor(private lexer: Lexer) {
        this.currentToken = this.lexer.nexToken();
    }

    private eat(type: TokenType) {
        if (this.currentToken.type === type) {
            this.currentToken = this.lexer.nexToken();
        } else {
            throw new ParserError(`Expected token ${TokenType[type]} but got ${TokenType[this.currentToken.type]} '${this.currentToken.value}'`, this.currentToken.line, this.currentToken.column, TokenType[type], TokenType[this.currentToken.type]);
        }
    }

    public parse(): Statement {
        const val = this.currentToken.value.toUpperCase();
        if (val == 'CREATE') {
            this.eat(TokenType.Identifier);
            const next = this.currentToken.value.toUpperCase();
            if (next === 'TABLE') return this.parseCreateTable();
            if (next === 'UNIQUE') return this.parseCreateIndex(true);
            if (next === 'INDEX') return this.parseCreateIndex(false);
            throw new ParserError(`Unexpected token after CREATE: '${next}'`, this.currentToken.line, this.currentToken.column);
        }
        if (val == 'DROP') {
            this.eat(TokenType.Identifier);
            const next = this.currentToken.value.toUpperCase();
            if (next === 'INDEX') return this.parseDropIndex();
            throw new ParserError(`Unexpected token after DROP: '${next}'`, this.currentToken.line, this.currentToken.column);
        }
        if (val == 'INSERT') return this.parseInsert();
        if (val == 'SELECT') return this.parseSelect();
        if (val == 'UPDATE') return this.parseUpdate();
        if (val == 'DELETE') return this.parseDelete();
        throw new ParserError(`Unexpected query keyword: '${val}'`, this.currentToken.line, this.currentToken.column);
    }

    private parseInsert(): InsertStatement {
        this.eat(TokenType.Identifier); // INSERT
        
        if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'INTO') {
            this.eat(TokenType.Identifier);
        }

        const tableName = this.currentToken.value;
        this.eat(TokenType.Identifier);

        const columns: string[] = [];
        if (this.currentToken.value === '(') {
            this.eat(TokenType.Punctuation);
            while ((this.currentToken.type as TokenType) !== TokenType.EOF && (this.currentToken.value as string) !== ')') {
                columns.push(this.currentToken.value);
                this.eat(TokenType.Identifier);
                if ((this.currentToken.value as string) === ',') {
                    this.eat(TokenType.Punctuation);
                }
            }
            if ((this.currentToken.value as string) === ')') {
                this.eat(TokenType.Punctuation);
            }
        }

        if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'VALUES') {
            this.eat(TokenType.Identifier);
        } else {
            throw new ParserError(`Expected VALUES but got '${this.currentToken.value}'`, this.currentToken.line, this.currentToken.column);
        }

        const values: any[][] = [];
        
        while ((this.currentToken.value as string) === '(') {
            this.eat(TokenType.Punctuation);
            const tuple: any[] = [];
            while ((this.currentToken.type as TokenType) !== TokenType.EOF && (this.currentToken.value as string) !== ')') {
                if ((this.currentToken.type as TokenType) === TokenType.Number) {
                    tuple.push(Number(this.currentToken.value));
                } else if ((this.currentToken.type as TokenType) === TokenType.String) {
                    tuple.push(this.currentToken.value);
                } else if ((this.currentToken.type as TokenType) === TokenType.Identifier) {
                    tuple.push(this.currentToken.value);
                } else {
                    tuple.push(this.currentToken.value);
                }
                this.eat(this.currentToken.type);

                if ((this.currentToken.value as string) === ',') {
                    this.eat(TokenType.Punctuation);
                }
            }
            if ((this.currentToken.value as string) === ')') {
                this.eat(TokenType.Punctuation);
            }
            values.push(tuple);

            if ((this.currentToken.value as string) === ',') {
                this.eat(TokenType.Punctuation);
            } else {
                break;
            }
        }

        return {
            type: 'INSERT',
            table: tableName,
            columns,
            values
        };
    }

    private parseSelect(): SelectStatement {
        this.eat(TokenType.Identifier); // SELECT

        const columns: string[] = [];
        if (this.currentToken.value === '*') {
            columns.push('*');
            this.eat(TokenType.Punctuation);
        } else {
            while ((this.currentToken.type as TokenType) !== TokenType.EOF && this.currentToken.value.toUpperCase() !== 'FROM') {
                columns.push(this.currentToken.value);
                this.eat(TokenType.Identifier);
                if ((this.currentToken.value as string) === ',') {
                    this.eat(TokenType.Punctuation);
                }
            }
        }

        if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'FROM') {
            this.eat(TokenType.Identifier);
        } else {
            throw new ParserError(`Expected FROM but got '${this.currentToken.value}'`, this.currentToken.line, this.currentToken.column);
        }

        const tableName = this.currentToken.value;
        this.eat(TokenType.Identifier);

        const where = this.parseWhere();

        let limit: number | undefined;
        let offset: number | undefined;

        if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'LIMIT') {
            this.eat(TokenType.Identifier);
            limit = Number(this.currentToken.value);
            this.eat(TokenType.Number);
            
            if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'OFFSET') {
                this.eat(TokenType.Identifier);
                offset = Number(this.currentToken.value);
                this.eat(TokenType.Number);
            }
        }

        return {
            type: 'SELECT',
            table: tableName,
            columns,
            ...(where ? { where } : {}),
            ...(limit !== undefined ? { limit } : {}),
            ...(offset !== undefined ? { offset } : {})
        };
    }

    private parseWhere(): WhereClause | undefined {
        if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'WHERE') {
            this.eat(TokenType.Identifier);
            
            const col = this.currentToken.value;
            this.eat(TokenType.Identifier);

            let op = this.currentToken.value;
            this.eat(this.currentToken.type);
            if ((op === '>' || op === '<' || op === '!') && (this.currentToken.value as string) === '=') {
                op += '=';
                this.eat(this.currentToken.type);
            }

            let val: any = this.currentToken.value;
            if ((this.currentToken.type as TokenType) === TokenType.Number) val = Number(val);
            this.eat(this.currentToken.type);

            return { column: col, operator: op, value: val };
        }
        return undefined;
    }

    private parseUpdate(): UpdateStatement {
        this.eat(TokenType.Identifier); // UPDATE
        const tableName = this.currentToken.value;
        this.eat(TokenType.Identifier);

        if (this.currentToken.value.toUpperCase() !== 'SET') {
            throw new ParserError(`Expected SET but got '${this.currentToken.value}'`, this.currentToken.line, this.currentToken.column);
        }
        this.eat(TokenType.Identifier);

        const setParts: { column: string; value: any }[] = [];
        while ((this.currentToken.type as TokenType) !== TokenType.EOF && this.currentToken.value.toUpperCase() !== 'WHERE') {
            const col = this.currentToken.value;
            this.eat(TokenType.Identifier);
            this.eat(TokenType.Punctuation); // '='
            
            let val: any = this.currentToken.value;
            if ((this.currentToken.type as TokenType) === TokenType.Number) val = Number(val);
            else if ((this.currentToken.type as TokenType) === TokenType.String) val = val.toString();
            this.eat(this.currentToken.type);

            setParts.push({ column: col, value: val });

            if ((this.currentToken.value as string) === ',') {
                this.eat(TokenType.Punctuation);
            }
        }

        const where = this.parseWhere();

        return { type: 'UPDATE', table: tableName, set: setParts, ...(where ? { where } : {}) };
    }

    private parseDelete(): DeleteStatement {
        this.eat(TokenType.Identifier); // DELETE
        
        if (this.currentToken.value.toUpperCase() === 'FROM') {
            this.eat(TokenType.Identifier);
        }

        const tableName = this.currentToken.value;
        this.eat(TokenType.Identifier);

        const where = this.parseWhere();

        return { type: 'DELETE', table: tableName, ...(where ? { where } : {}) };
    }

    private parseDropIndex(): DropIndexStatement {
        this.eat(TokenType.Identifier); // INDEX
        const indexName = this.currentToken.value;
        this.eat(TokenType.Identifier);
        return { type: 'DROP_INDEX', name: indexName };
    }

    private parseCreateIndex(unique: boolean): CreateIndexStatement {
        if (unique) this.eat(TokenType.Identifier); // UNIQUE
        this.eat(TokenType.Identifier); // INDEX
        
        const indexName = this.currentToken.value;
        this.eat(TokenType.Identifier);

        if (this.currentToken.value.toUpperCase() !== 'ON') {
            throw new ParserError(`Expected ON but got '${this.currentToken.value}'`, this.currentToken.line, this.currentToken.column);
        }
        this.eat(TokenType.Identifier);

        const tableName = this.currentToken.value;
        this.eat(TokenType.Identifier);

        this.eat(TokenType.Punctuation); // '('
        const colName = this.currentToken.value;
        this.eat(TokenType.Identifier);
        this.eat(TokenType.Punctuation); // ')'

        return { type: 'CREATE_INDEX', name: indexName, table: tableName, column: colName, unique };
    }

    private parseCreateTable(): CreateTableStatement {
        this.eat(TokenType.Identifier);

        let ifNotExists = false;
        if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'IF') {
            this.eat(TokenType.Identifier);
            if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'NOT') {
                this.eat(TokenType.Identifier);
                if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'EXISTS') {
                    this.eat(TokenType.Identifier);
                    ifNotExists = true;
                }
            }
        }

        const tableName = this.currentToken.value;
        this.eat(TokenType.Identifier);

        this.eat(TokenType.Punctuation);

        const columns: any[] = [];

        while (this.currentToken.type !== TokenType.EOF && this.currentToken.value !== ')') {
            const colName = this.currentToken.value;
            this.eat(TokenType.Identifier);

            let dataType = '';
            if (this.currentToken.type === TokenType.Identifier) {
                dataType = this.currentToken.value;
                this.eat(TokenType.Identifier);
                if (this.currentToken.value === '(') {
                    this.eat(TokenType.Punctuation);
                    let sizeStr = '';
                    while ((this.currentToken.value as string) !== ')' && (this.currentToken.type as TokenType) !== TokenType.EOF) {
                        sizeStr += this.currentToken.value;
                        this.eat(this.currentToken.type);
                    }
                    this.eat(TokenType.Punctuation);
                    dataType += `(${sizeStr})`;
                }
            }

            const colDef: any = {
                name: colName,
                dataType,
                isNullable: true
            };

            while ((this.currentToken.type as TokenType) !== TokenType.EOF && (this.currentToken.value as string) !== ',' && (this.currentToken.value as string) !== ')') {
                if (this.currentToken.type !== TokenType.Identifier) {
                    this.eat(this.currentToken.type);
                    continue;
                }
                const val = this.currentToken.value.toUpperCase();

                if (val === 'PRIMARY') {
                    this.eat(TokenType.Identifier);
                    if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'KEY') {
                        this.eat(TokenType.Identifier);
                        colDef.isPrimaryKey = true;
                    }
                } else if (val === 'AUTOINCREMENT') {
                    this.eat(TokenType.Identifier);
                    colDef.isAutoIncrement = true;
                } else if (val === 'NOT') {
                    this.eat(TokenType.Identifier);
                    if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'NULL') {
                        this.eat(TokenType.Identifier);
                        colDef.isNullable = false;
                    }
                } else if (val === 'NULL') {
                    this.eat(TokenType.Identifier);
                    colDef.isNullable = true;
                } else if (val === 'UNIQUE') {
                    this.eat(TokenType.Identifier);
                    colDef.isUnique = true;
                } else if (val === 'DEFAULT') {
                    this.eat(TokenType.Identifier);
                    colDef.default = this.currentToken.value;
                    this.eat(this.currentToken.type);
                } else if (val === 'REFERENCES') {
                    this.eat(TokenType.Identifier);
                    const refTable = this.currentToken.value;
                    this.eat(TokenType.Identifier);
                    if (this.currentToken.value === '(') {
                        this.eat(TokenType.Punctuation);
                        const refCol = this.currentToken.value;
                        this.eat(TokenType.Identifier);
                        if ((this.currentToken.value as string) === ')') {
                            this.eat(TokenType.Punctuation);
                        }
                        colDef.references = {
                            table: refTable,
                            column: refCol
                        };
                    } else {
                        colDef.references = { table: refTable };
                    }
                } else {
                    throw new ParserError(`Unexpected column constraint/modifier: '${val}'`, this.currentToken.line, this.currentToken.column);
                }
            }

            columns.push(colDef);

            if (this.currentToken.value === ',') {
                this.eat(TokenType.Punctuation);
            }
        }

        if (this.currentToken.value === ')') {
            this.eat(TokenType.Punctuation);
        }

        return {
            type: 'CREATE_TABLE',
            ifNotExists,
            name: tableName,
            columns,
            primaryKey: columns.filter((c: any) => c.isPrimaryKey).map((c: any) => c.name)
        }
    }
}