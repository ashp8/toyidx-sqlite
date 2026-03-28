#pragma once

#include "ast.hpp"
#include <emscripten/val.h>

namespace toy {

// Interface for storage operations, implemented in JS and called from C++
class IStorage {
public:
    virtual ~IStorage() = default;
    virtual emscripten::val getTableData(const std::string& tableName) = 0;
    // Fast path: get data as JSON string for efficient transfer
    virtual std::string getTableDataJson(const std::string& tableName) {
        return "[]";
    }
};

class Executor {
public:
    Executor(IStorage& storage);
    emscripten::val execute(std::shared_ptr<Statement> stmt);

private:
    IStorage& storage;

    // Internal methods use native types — no emscripten::val
    std::vector<NativeRow> executeSelectNative(std::shared_ptr<SelectStatement> stmt);
    bool evaluateWhere(const NativeRow& record, const std::shared_ptr<WhereClause>& where);
    
    // Parse a simple JSON array of objects into NativeRows
    // Handles flat objects with string/number/null values
    std::vector<NativeRow> parseJsonRows(const std::string& json);
};

} // namespace toy
