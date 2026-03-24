export enum TokenType {
    Keyword,
    Identifier,
    Number,
    String,
    Operator,
    Punctuation,
    EOF
};

export interface Token {
    type: TokenType;
    value: string;
    line: number;
    column: number;
};

export class ParserError extends Error {
    constructor(
        message: string,
        public line: number,
        public column: number,
        public expected?: string,
        public actual?: string
    ) {
        super(`${message} at line ${line} column ${column}`);
        this.name = 'ParserError';
    }
}


export type Statement = CreateTableStatement | InsertStatement | SelectStatement | UpdateStatement | DeleteStatement | CreateIndexStatement | DropIndexStatement;

export interface CreateTableStatement {
    type: 'CREATE_TABLE';
    name: string;
    ifNotExists?: boolean;
    columns: ColumnDefinition[];
    primaryKey: string[];
}

export interface ColumnDefinition {
    name: string;
    dataType: string;
    isNullable: boolean;
    isPrimaryKey?: boolean;
    isAutoIncrement?: boolean;
    isUnique?: boolean;
    default?: any;
    references?: {
        table: string;
        column?: string;
    };
}

export interface InsertStatement {
    type: 'INSERT';
    table: string;
    columns: string[];
    values: any[][];
}

export interface WhereClause {
    column: string;
    operator: string;
    value: any;
}

export interface SelectStatement {
    type: 'SELECT';
    table: string;
    columns: string[];
    where?: WhereClause;
    limit?: number;
    offset?: number;
}

export interface UpdateStatement {
    type: 'UPDATE';
    table: string;
    set: { column: string; value: any }[];
    where?: WhereClause;
}

export interface DeleteStatement {
    type: 'DELETE';
    table: string;
    where?: WhereClause;
}

export interface CreateIndexStatement {
    type: 'CREATE_INDEX';
    name: string;
    table: string;
    column: string;
    unique?: boolean;
}

export interface DropIndexStatement {
    type: 'DROP_INDEX';
    name: string;
}