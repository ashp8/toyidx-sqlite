#pragma once

#include "ast.hpp"
#include <emscripten/val.h>
#include <cstring>
#include <unordered_map>

namespace toy {

// Interface for storage operations, implemented in JS and called from C++
class IStorage {
public:
    virtual ~IStorage() = default;
    virtual emscripten::val getTableData(const std::string& tableName) = 0;
};

class Executor {
public:
    Executor(IStorage& storage);
    emscripten::val execute(std::shared_ptr<Statement> stmt);

    // Preload table data as binary into WASM memory for zero-bridge-call processing
    void preloadTable(const std::string& tableName, uintptr_t dataPtr, size_t dataLen);
    void clearPreload(const std::string& tableName);

private:
    IStorage& storage;

    // Preloaded binary data pointers (valid until clearPreload is called)
    struct BinaryData { uintptr_t ptr; size_t len; };
    std::unordered_map<std::string, BinaryData> preloadedTables;

    // Internal native processing
    std::vector<NativeRow> executeSelectNative(std::shared_ptr<SelectStatement> stmt);
    bool evaluateWhere(const NativeRow& record, const std::shared_ptr<WhereClause>& where);

    // Binary format reader — parses the compact binary format into NativeRows
    // Uses memcpy for all multi-byte reads to avoid unaligned access UB
    static std::vector<NativeRow> readBinaryRows(const uint8_t* data, size_t len);
};

} // namespace toy
