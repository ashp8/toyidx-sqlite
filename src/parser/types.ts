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

export type Statement = CreateTableStatement | InsertStatement | SelectStatement;

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
}