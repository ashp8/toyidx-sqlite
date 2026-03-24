import { Lexer } from "./lexer";
import { CreateTableStatement, Statement, Token, TokenType, InsertStatement, SelectStatement, UpdateStatement, DeleteStatement, WhereClause, CreateIndexStatement, DropIndexStatement, ParserError, TransactionStatement, CreateViewStatement, DropTableStatement, AlterTableStatement, JoinClause } from "./types";

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
        if (val === 'BEGIN' || val === 'COMMIT' || val === 'ROLLBACK' || val === 'SAVEPOINT') {
            return this.parseTransaction();
        }
        if (val == 'CREATE') {
            this.eat(TokenType.Identifier);
            const next = this.currentToken.value.toUpperCase();
            if (next === 'TABLE') return this.parseCreateTable();
            if (next === 'UNIQUE') return this.parseCreateIndex(true);
            if (next === 'INDEX') return this.parseCreateIndex(false);
            if (next === 'VIEW') return this.parseCreateView();
            throw new ParserError(`Unexpected token after CREATE: '${next}'`, this.currentToken.line, this.currentToken.column);
        }
        if (val == 'DROP') {
            this.eat(TokenType.Identifier);
            const next = this.currentToken.value.toUpperCase();
            if (next === 'INDEX') return this.parseDropIndex();
            if (next === 'TABLE') return this.parseDropTable();
            throw new ParserError(`Unexpected token after DROP: '${next}'`, this.currentToken.line, this.currentToken.column);
        }
        if (val === 'ALTER') return this.parseAlterTable();
        if (val == 'INSERT') return this.parseInsert();
        if (val == 'SELECT') return this.parseSelect();
        if (val == 'UPDATE') return this.parseUpdate();
        if (val == 'DELETE') return this.parseDelete();
        throw new ParserError(`Unexpected query keyword: '${val}'`, this.currentToken.line, this.currentToken.column);
    }

    private parseTransaction(): TransactionStatement {
        const actionStr = this.currentToken.value.toUpperCase();
        this.eat(TokenType.Identifier);
        
        if (actionStr === 'BEGIN') {
            if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'TRANSACTION') {
                this.eat(TokenType.Identifier);
            }
            return { type: 'TRANSACTION', action: 'BEGIN' };
        } else if (actionStr === 'COMMIT') {
            if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'TRANSACTION') {
                this.eat(TokenType.Identifier);
            }
            return { type: 'TRANSACTION', action: 'COMMIT' };
        } else if (actionStr === 'ROLLBACK') {
            if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'TRANSACTION') {
                this.eat(TokenType.Identifier);
            }
            if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'TO') {
                this.eat(TokenType.Identifier);
                if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'SAVEPOINT') {
                    this.eat(TokenType.Identifier);
                }
                const name = this.currentToken.value;
                this.eat(TokenType.Identifier);
                return { type: 'TRANSACTION', action: 'ROLLBACK_TO', name };
            }
            return { type: 'TRANSACTION', action: 'ROLLBACK' };
        } else if (actionStr === 'SAVEPOINT') {
            const name = this.currentToken.value;
            this.eat(TokenType.Identifier);
            return { type: 'TRANSACTION', action: 'SAVEPOINT', name };
        }
        throw new ParserError(`Invalid transaction action: ${actionStr}`, this.currentToken.line, this.currentToken.column);
    }

    private parseCreateView(): CreateViewStatement {
        this.eat(TokenType.Identifier); // VIEW
        const viewName = this.currentToken.value;
        this.eat(TokenType.Identifier);

        if (this.currentToken.value.toUpperCase() !== 'AS') {
            throw new ParserError(`Expected AS but got '${this.currentToken.value}'`, this.currentToken.line, this.currentToken.column);
        }
        this.eat(TokenType.Identifier);

        const selectStmt = this.parseSelect();
        return { type: 'CREATE_VIEW', name: viewName, select: selectStmt };
    }

    private parseDropTable(): DropTableStatement {
        this.eat(TokenType.Identifier); // TABLE
        let ifExists = false;
        if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'IF') {
            this.eat(TokenType.Identifier);
            if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'EXISTS') {
                this.eat(TokenType.Identifier);
                ifExists = true;
            }
        }
        const tableName = this.currentToken.value;
        this.eat(TokenType.Identifier);
        return { type: 'DROP_TABLE', name: tableName, ifExists };
    }

    private parseAlterTable(): AlterTableStatement {
        this.eat(TokenType.Identifier); // ALTER
        if (this.currentToken.value.toUpperCase() !== 'TABLE') {
            throw new ParserError(`Expected TABLE but got '${this.currentToken.value}'`, this.currentToken.line, this.currentToken.column);
        }
        this.eat(TokenType.Identifier);
        
        const tableName = this.currentToken.value;
        this.eat(TokenType.Identifier);

        const actionKw = this.currentToken.value.toUpperCase();
        this.eat(TokenType.Identifier);

        if (actionKw === 'ADD') {
            if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'COLUMN') {
                this.eat(TokenType.Identifier);
            }
            const colName = this.currentToken.value;
            this.eat(TokenType.Identifier);
            
            let dataType = '';
            if (this.currentToken.type === TokenType.Identifier) {
                dataType = this.currentToken.value;
                this.eat(TokenType.Identifier);
            }
            return {
                type: 'ALTER_TABLE',
                table: tableName,
                action: 'ADD_COLUMN',
                columnDef: { name: colName, dataType: dataType, isNullable: true }
            };
        } else if (actionKw === 'RENAME') {
            if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'TO') {
                this.eat(TokenType.Identifier);
                const newName = this.currentToken.value;
                this.eat(TokenType.Identifier);
                return { type: 'ALTER_TABLE', table: tableName, action: 'RENAME_TABLE', newName };
            } else if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'COLUMN') {
                this.eat(TokenType.Identifier);
                const oldName = this.currentToken.value;
                this.eat(TokenType.Identifier);
                if (this.currentToken.value.toUpperCase() !== 'TO') {
                    throw new ParserError(`Expected TO but got '${this.currentToken.value}'`, this.currentToken.line, this.currentToken.column);
                }
                this.eat(TokenType.Identifier);
                const newName = this.currentToken.value;
                this.eat(TokenType.Identifier);
                return { type: 'ALTER_TABLE', table: tableName, action: 'RENAME_COLUMN', oldName, newName };
            }
        }
        throw new ParserError(`Unsupported ALTER TABLE action: ${actionKw}`, this.currentToken.line, this.currentToken.column);
    }

    private parseInsert(): InsertStatement {
        this.eat(TokenType.Identifier); // INSERT
        
        let orIgnore = false;
        let orReplace = false;

        if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'OR') {
            this.eat(TokenType.Identifier);
            const act = this.currentToken.value.toUpperCase();
            if (act === 'IGNORE') {
                orIgnore = true;
                this.eat(TokenType.Identifier);
            } else if (act === 'REPLACE') {
                orReplace = true;
                this.eat(TokenType.Identifier);
            } else {
                throw new ParserError(`Expected IGNORE or REPLACE after OR, got ${act}`, this.currentToken.line, this.currentToken.column);
            }
        }

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

        let values: any[][] | undefined;
        let selectStmt: SelectStatement | undefined;

        if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'VALUES') {
            this.eat(TokenType.Identifier);
            values = [];
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
        } else if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'SELECT') {
            selectStmt = this.parseSelect();
        } else {
            throw new ParserError(`Expected VALUES or SELECT but got '${this.currentToken.value}'`, this.currentToken.line, this.currentToken.column);
        }

        let returning: string[] | undefined;
        if ((this.currentToken.type as TokenType) !== TokenType.EOF && this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'RETURNING') {
            this.eat(TokenType.Identifier);
            returning = [];
            while ((this.currentToken.type as TokenType) !== TokenType.EOF) {
                returning.push(this.currentToken.value);
                const ctype = this.currentToken.type as TokenType;
                if (ctype === TokenType.Punctuation || ctype === TokenType.Operator) {
                    this.eat(ctype);
                } else {
                    this.eat(TokenType.Identifier);
                }
                if (this.currentToken.value === ',') {
                    this.eat(TokenType.Punctuation);
                } else {
                    break;
                }
            }
        }

        return {
            type: 'INSERT',
            table: tableName,
            columns,
            ...(values ? { values } : {}),
            ...(selectStmt ? { select: selectStmt } : {}),
            ...(orIgnore ? { orIgnore: true } : {}),
            ...(orReplace ? { orReplace: true } : {}),
            ...(returning ? { returning } : {})
        };
    }

    private parseSelect(): SelectStatement {
        this.eat(TokenType.Identifier); // SELECT

        const columns: string[] = [];
        if (this.currentToken.value === '*') {
            columns.push('*');
            this.eat(this.currentToken.type);
        } else {
            while ((this.currentToken.type as TokenType) !== TokenType.EOF && this.currentToken.value.toUpperCase() !== 'FROM') {
                let colExpr = '';
                while ((this.currentToken.type as TokenType) !== TokenType.EOF && (this.currentToken.value as string) !== ',' && this.currentToken.value.toUpperCase() !== 'FROM') {
                    const valStr = this.currentToken.value as string;
                    let addSpace = false;
                    if (colExpr.length > 0) {
                        const lastChar = colExpr.charAt(colExpr.length - 1);
                        const firstChar = valStr.charAt(0);
                        if (/[a-zA-Z0-9_]/.test(lastChar) && /[a-zA-Z0-9_]/.test(firstChar)) addSpace = true;
                        if (valStr.toUpperCase() === 'AS') addSpace = true;
                    }
                    if (addSpace) colExpr += ' ';
                    colExpr += valStr;
                    this.eat(this.currentToken.type);
                }
                columns.push(colExpr.trim());
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

        const joins: JoinClause[] = [];
        while (this.currentToken.type === TokenType.Identifier && ['INNER', 'LEFT', 'CROSS', 'JOIN'].includes(this.currentToken.value.toUpperCase() as any)) {
            let joinType = this.currentToken.value.toUpperCase();
            this.eat(TokenType.Identifier);
            if (joinType !== 'JOIN' && this.currentToken.value.toUpperCase() === 'JOIN') {
                this.eat(TokenType.Identifier);
            }

            const joinTable = this.currentToken.value;
            this.eat(TokenType.Identifier);

            let onClause: WhereClause | undefined;
            if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'ON') {
                this.eat(TokenType.Identifier);
                onClause = this.parseCondition();
            }

            joins.push({
                type: joinType as any,
                table: joinTable,
                ...(onClause ? { on: onClause } : {})
            });
        }

        const where = this.parseWhere();

        let groupBy: string[] | undefined;
        let having: WhereClause | undefined;

        if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'GROUP') {
            this.eat(TokenType.Identifier);
            if (this.currentToken.value.toUpperCase() === 'BY') this.eat(TokenType.Identifier);
            groupBy = [];
            while ((this.currentToken.type as TokenType) !== TokenType.EOF && !['HAVING', 'ORDER', 'LIMIT', 'UNION'].includes(this.currentToken.value.toUpperCase())) {
                let gbCol = this.currentToken.value;
                this.eat(this.currentToken.type);
                if ((this.currentToken.value as string) === '.') {
                    this.eat(TokenType.Punctuation);
                    gbCol += '.' + this.currentToken.value;
                    this.eat(TokenType.Identifier);
                }
                groupBy.push(gbCol);
                
                if ((this.currentToken.value as string) === ',') {
                    this.eat(TokenType.Punctuation);
                } else {
                    break;
                }
            }
        }

        if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'HAVING') {
            this.eat(TokenType.Identifier);
            having = this.parseCondition();
        }

        let union: SelectStatement[] | undefined;
        if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'UNION') {
            union = [];
            while (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'UNION') {
                this.eat(TokenType.Identifier);
                if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'ALL') {
                    this.eat(TokenType.Identifier);
                }
                const nextSelect = this.parseSelect();
                union.push(nextSelect);
            }
        }

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
            ...(offset !== undefined ? { offset } : {}),
            ...(joins.length > 0 ? { joins } : {}),
            ...(groupBy ? { groupBy } : {}),
            ...(having ? { having } : {}),
            ...(union ? { union } : {})
        };
    }

    private parseWhere(): WhereClause | undefined {
        if (this.currentToken.type === TokenType.Identifier && this.currentToken.value.toUpperCase() === 'WHERE') {
            this.eat(TokenType.Identifier);
            return this.parseCondition();
        }
        return undefined;
    }

    private parseCondition(): WhereClause {
        let left: WhereClause = this.parseSimpleCondition();
        
        while (this.currentToken.type === TokenType.Identifier && 
              (this.currentToken.value.toUpperCase() === 'AND' || this.currentToken.value.toUpperCase() === 'OR')) {
            const logicalOp = this.currentToken.value.toUpperCase();
            this.eat(TokenType.Identifier);
            const right = this.parseSimpleCondition();
            
            if (logicalOp === 'AND') {
                left = { column: '', operator: 'AND', value: null, and: left, or: right };
            } else {
                left = { column: '', operator: 'OR', value: null, and: left, or: right };
            }
        }
        return left;
    }

    private parseSimpleCondition(): WhereClause {
        let fullCol = this.currentToken.value;
        this.eat(TokenType.Identifier); 
        if ((this.currentToken.value as string) === '.') {
            this.eat(TokenType.Punctuation);
            fullCol += '.' + this.currentToken.value;
            this.eat(TokenType.Identifier);
        }

        let op = this.currentToken.value;
        if (this.currentToken.type === TokenType.Operator || this.currentToken.type === TokenType.Punctuation || this.currentToken.type === TokenType.Identifier) {
            op = this.currentToken.value.toUpperCase();
            this.eat(this.currentToken.type);
        }

        if (op === 'IS') {
            if (this.currentToken.value.toUpperCase() === 'NOT') {
                this.eat(TokenType.Identifier);
                if (this.currentToken.value.toUpperCase() === 'NULL') {
                    this.eat(TokenType.Identifier);
                    return { column: fullCol, operator: 'IS NOT NULL', value: null };
                }
            } else if (this.currentToken.value.toUpperCase() === 'NULL') {
                this.eat(TokenType.Identifier);
                return { column: fullCol, operator: 'IS NULL', value: null };
            }
        } else if (op === 'LIKE') {
            const val = this.currentToken.value;
            this.eat(TokenType.String);
            return { column: fullCol, operator: 'LIKE', value: val };
        } else if (op === 'IN') {
            this.eat(TokenType.Punctuation); // '('
            const vals: any[] = [];
            while ((this.currentToken.value as string) !== ')') {
                let v: any = this.currentToken.value;
                if ((this.currentToken.type as TokenType) === TokenType.Number) v = Number(v);
                if ((this.currentToken.value as string) !== ',') {
                    vals.push(v);
                }
                this.eat(this.currentToken.type);
            }
            this.eat(TokenType.Punctuation); // ')'
            return { column: fullCol, operator: 'IN', value: vals };
        } else if (op === 'BETWEEN') {
            let val1: any = this.currentToken.value;
            if ((this.currentToken.type as TokenType) === TokenType.Number) val1 = Number(val1);
            this.eat(this.currentToken.type);
            
            if (this.currentToken.value.toUpperCase() !== 'AND') throw new ParserError("Expected AND for BETWEEN", this.currentToken.line, this.currentToken.column);
            this.eat(TokenType.Identifier);
            
            let val2: any = this.currentToken.value;
            if ((this.currentToken.type as TokenType) === TokenType.Number) val2 = Number(val2);
            this.eat(this.currentToken.type);
            
            return { column: fullCol, operator: 'BETWEEN', value: [val1, val2] };
        } else {
            let val: any = this.currentToken.value;
            if ((this.currentToken.value as string) === '(') {
                this.eat(TokenType.Punctuation);
                if (this.currentToken.value.toUpperCase() === 'SELECT') {
                    val = this.parseSelect();
                } else {
                    throw new ParserError("Only subqueries are supported in parens here", this.currentToken.line, this.currentToken.column);
                }
                this.eat(TokenType.Punctuation); // ')'
            } else {
                if ((this.currentToken.type as TokenType) === TokenType.Number) val = Number(val);
                else if ((this.currentToken.type as TokenType) === TokenType.String) val = val.toString();
                this.eat(this.currentToken.type);
            }

            return { column: fullCol, operator: op, value: val };
        }
        throw new ParserError("Failed to parse condition", this.currentToken.line, this.currentToken.column);
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
            const cType = this.currentToken.type as TokenType;
            if (cType === TokenType.Operator || cType === TokenType.Punctuation) {
                this.eat(cType); // '='
            } else {
                this.eat(TokenType.Operator);
            }
            
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
                } else if (val === 'CHECK') {
                    this.eat(TokenType.Identifier);
                    this.eat(TokenType.Punctuation); // '('
                    let expr = '';
                    while ((this.currentToken.value as string) !== ')') {
                        expr += " " + this.currentToken.value;
                        this.eat(this.currentToken.type);
                    }
                    this.eat(TokenType.Punctuation); // ')'
                    colDef.check = expr.trim();
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