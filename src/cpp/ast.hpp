#pragma once

#include <string>
#include <vector>
#include <memory>
#include <optional>
#include <emscripten/val.h>

namespace toy {

struct SelectStatement;

typedef emscripten::val Value;

struct WhereClause {
    std::string column;
    std::string op;
    Value value;
    std::shared_ptr<WhereClause> andClause;
    std::shared_ptr<WhereClause> orClause;
};

struct Statement {
    virtual ~Statement() = default;
    virtual std::string type() const = 0;
};

struct ColumnDefinition {
    std::string name;
    std::string dataType;
    bool isNullable;
    bool isPrimaryKey = false;
    bool isAutoIncrement = false;
    bool isUnique = false;
};

struct CreateTableStatement : public Statement {
    std::string name;
    bool ifNotExists = false;
    std::vector<ColumnDefinition> columns;
    std::vector<std::string> primaryKey;
    std::string type() const override { return "CREATE_TABLE"; }
};

struct SelectStatement : public Statement {
    std::string table;
    std::vector<std::string> columns;
    std::shared_ptr<WhereClause> where;
    std::optional<int> limit;
    std::optional<int> offset;
    std::string type() const override { return "SELECT"; }
};

struct InsertStatement : public Statement {
    std::string table;
    std::vector<std::string> columns;
    std::vector<std::vector<Value>> values;
    std::shared_ptr<SelectStatement> select;
    bool orIgnore = false;
    bool orReplace = false;
    std::string type() const override { return "INSERT"; }
};

struct UpdateStatement : public Statement {
    std::string table;
    struct SetPart { std::string column; Value value; };
    std::vector<SetPart> setParts;
    std::shared_ptr<WhereClause> where;
    std::string type() const override { return "UPDATE"; }
};

struct DeleteStatement : public Statement {
    std::string table;
    std::shared_ptr<WhereClause> where;
    std::string type() const override { return "DELETE"; }
};

struct TransactionStatement : public Statement {
    std::string action; // BEGIN, COMMIT, ROLLBACK, SAVEPOINT, ROLLBACK_TO
    std::string name;
    std::string type() const override { return "TRANSACTION"; }
};

} // namespace toy
