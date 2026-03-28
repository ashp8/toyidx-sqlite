#pragma once

#include <string>
#include <vector>
#include <memory>
#include <optional>
#include <unordered_map>
#include <emscripten/val.h>

namespace toy {

// Native value type — replaces emscripten::val for internal processing.
// emscripten::val is only used at module boundaries (input/output).
struct NativeValue {
    enum Type { NUM, STR, NULL_VAL } type = NULL_VAL;
    double num = 0.0;
    std::string str;

    NativeValue() : type(NULL_VAL), num(0.0) {}
    NativeValue(double n) : type(NUM), num(n) {}
    NativeValue(const std::string& s) : type(STR), str(s) {}
    static NativeValue null() { return NativeValue(); }

    bool operator==(const NativeValue& o) const {
        if (type != o.type) return false;
        if (type == NUM) return num == o.num;
        if (type == STR) return str == o.str;
        return true; // both NULL
    }
    bool operator!=(const NativeValue& o) const { return !(*this == o); }
    bool operator>(const NativeValue& o) const {
        if (type == NUM && o.type == NUM) return num > o.num;
        if (type == STR && o.type == STR) return str > o.str;
        return false;
    }
    bool operator<(const NativeValue& o) const {
        if (type == NUM && o.type == NUM) return num < o.num;
        if (type == STR && o.type == STR) return str < o.str;
        return false;
    }
    bool operator>=(const NativeValue& o) const { return *this == o || *this > o; }
    bool operator<=(const NativeValue& o) const { return *this == o || *this < o; }

    double toNum() const { return type == NUM ? num : 0.0; }
    bool isNull() const { return type == NULL_VAL; }
};

using NativeRow = std::unordered_map<std::string, NativeValue>;

// ---- Conversion helpers (the ONLY place emscripten::val is touched) ----

inline NativeValue fromVal(emscripten::val v) {
    if (v.isUndefined() || v.isNull()) return NativeValue::null();
    std::string t = v.typeOf().as<std::string>();
    if (t == "number") return NativeValue(v.as<double>());
    if (t == "string") return NativeValue(v.as<std::string>());
    return NativeValue::null();
}

inline emscripten::val toVal(const NativeValue& v) {
    switch (v.type) {
        case NativeValue::NUM: return emscripten::val(v.num);
        case NativeValue::STR: return emscripten::val(v.str);
        default: return emscripten::val::null();
    }
}

inline std::vector<NativeRow> jsArrayToRows(emscripten::val arr) {
    int len = arr["length"].as<int>();
    std::vector<NativeRow> rows;
    rows.reserve(len);
    for (int i = 0; i < len; ++i) {
        emscripten::val record = arr[i];
        emscripten::val keys = emscripten::val::global("Object").call<emscripten::val>("keys", record);
        int keyLen = keys["length"].as<int>();
        NativeRow row;
        for (int j = 0; j < keyLen; ++j) {
            std::string key = keys[j].as<std::string>();
            row[key] = fromVal(record[key]);
        }
        rows.push_back(std::move(row));
    }
    return rows;
}

inline emscripten::val rowsToJsArray(const std::vector<NativeRow>& rows) {
    emscripten::val result = emscripten::val::array();
    for (const auto& row : rows) {
        emscripten::val obj = emscripten::val::object();
        for (const auto& [key, val] : row) {
            obj.set(key, toVal(val));
        }
        result.call<void>("push", obj);
    }
    return result;
}

// ---- AST Node types ----

struct WhereClause {
    std::string column;
    std::string op;
    NativeValue value;
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
    bool isNullable = true;
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
    std::vector<std::vector<NativeValue>> values;
    std::shared_ptr<SelectStatement> select;
    bool orIgnore = false;
    bool orReplace = false;
    std::string type() const override { return "INSERT"; }
};

struct UpdateStatement : public Statement {
    std::string table;
    struct SetPart { std::string column; NativeValue value; };
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
    std::string action;
    std::string name;
    std::string type() const override { return "TRANSACTION"; }
};

} // namespace toy
