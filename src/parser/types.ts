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


export type Statement = 
    CreateTableStatement | InsertStatement | SelectStatement | UpdateStatement | DeleteStatement | 
    CreateIndexStatement | DropIndexStatement | TransactionStatement | CreateViewStatement | 
    DropTableStatement | AlterTableStatement;

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
    values?: any[][];
    select?: SelectStatement;
    orIgnore?: boolean;
    orReplace?: boolean;
    returning?: string[];
}

export interface WhereClause {
    column: string;
    operator: string;
    value: any;
    and?: WhereClause;
    or?: WhereClause;
}

export interface SelectStatement {
    type: 'SELECT';
    table: string;
    columns: string[];
    where?: WhereClause;
    limit?: number;
    offset?: number;
    groupBy?: string[];
    having?: WhereClause;
    joins?: JoinClause[];
    union?: SelectStatement[];
}

export interface JoinClause {
    type: 'INNER' | 'LEFT' | 'CROSS' | 'JOIN';
    table: string;
    on?: WhereClause;
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

export interface TransactionStatement {
    type: 'TRANSACTION';
    action: 'BEGIN' | 'COMMIT' | 'ROLLBACK' | 'SAVEPOINT' | 'ROLLBACK_TO';
    name?: string;
}

export interface CreateViewStatement {
    type: 'CREATE_VIEW';
    name: string;
    select: SelectStatement;
}

export interface DropTableStatement {
    type: 'DROP_TABLE';
    name: string;
    ifExists?: boolean;
}

export interface AlterTableStatement {
    type: 'ALTER_TABLE';
    table: string;
    action: 'ADD_COLUMN' | 'RENAME_TABLE' | 'RENAME_COLUMN';
    columnDef?: ColumnDefinition; // for ADD_COLUMN
    newName?: string; // for RENAME_TABLE / RENAME_COLUMN
    oldName?: string; // for RENAME_COLUMN
}