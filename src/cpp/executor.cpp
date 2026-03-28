#include "executor.hpp"
#include <algorithm>
#include <cctype>
#include <cstring>

using namespace emscripten;

namespace toy {

Executor::Executor(IStorage& storage) : storage(storage) {}

void Executor::preloadTable(const std::string& tableName, uintptr_t dataPtr, size_t dataLen) {
    preloadedTables[tableName] = { dataPtr, dataLen };
}

void Executor::clearPreload(const std::string& tableName) {
    preloadedTables.erase(tableName);
}

val Executor::execute(std::shared_ptr<Statement> stmt) {
    if (stmt->type() == "SELECT") {
        auto rows = executeSelectNative(std::static_pointer_cast<SelectStatement>(stmt));
        return rowsToJsArray(rows);
    }
    return val::array();
}

bool Executor::evaluateWhere(const NativeRow& record, const std::shared_ptr<WhereClause>& where) {
    if (!where) return true;

    auto it = record.find(where->column);
    if (it == record.end()) return false;
    const NativeValue& recVal = it->second;

    if (recVal.isNull()) return false;

    const NativeValue& wVal = where->value;
    const std::string& op = where->op;

    if (op == "=") return recVal == wVal;
    if (op == "!=" || op == "<>") return recVal != wVal;
    if (op == ">") return recVal > wVal;
    if (op == "<") return recVal < wVal;
    if (op == ">=") return recVal >= wVal;
    if (op == "<=") return recVal <= wVal;

    return false;
}

// --- Binary format reader ---
// Format:
//   [num_rows: u32_le][num_cols: u32_le]
//   for each col: [name_len: u16_le][name: UTF-8 bytes]
//   for each row, for each col:
//     [type: u8]  0=null, 1=f64, 2=string
//     type 1: [f64_le]
//     type 2: [str_len: u32_le][str: UTF-8 bytes]
//
// All multi-byte reads use memcpy to avoid unaligned access UB.

static inline uint16_t readU16(const uint8_t* p) {
    uint16_t v; memcpy(&v, p, 2); return v;
}
static inline uint32_t readU32(const uint8_t* p) {
    uint32_t v; memcpy(&v, p, 4); return v;
}
static inline double readF64(const uint8_t* p) {
    double v; memcpy(&v, p, 8); return v;
}

std::vector<NativeRow> Executor::readBinaryRows(const uint8_t* data, size_t len) {
    if (!data || len < 8) return {};

    const uint8_t* p = data;
    const uint8_t* end = data + len;

    uint32_t numRows = readU32(p); p += 4;
    uint32_t numCols = readU32(p); p += 4;

    // Read column names
    std::vector<std::string> colNames;
    colNames.reserve(numCols);
    for (uint32_t i = 0; i < numCols && p < end; ++i) {
        uint16_t nameLen = readU16(p); p += 2;
        colNames.emplace_back(reinterpret_cast<const char*>(p), nameLen);
        p += nameLen;
    }

    // Read rows
    std::vector<NativeRow> rows;
    rows.reserve(numRows);
    for (uint32_t r = 0; r < numRows && p < end; ++r) {
        NativeRow row;
        for (uint32_t c = 0; c < numCols && p < end; ++c) {
            uint8_t type = *p; p += 1;
            if (type == 0) {
                // null — skip
                row[colNames[c]] = NativeValue::null();
            } else if (type == 1) {
                // f64
                double val = readF64(p); p += 8;
                row[colNames[c]] = NativeValue(val);
            } else if (type == 2) {
                // string
                uint32_t strLen = readU32(p); p += 4;
                row[colNames[c]] = NativeValue(std::string(reinterpret_cast<const char*>(p), strLen));
                p += strLen;
            }
        }
        rows.push_back(std::move(row));
    }

    return rows;
}

std::vector<NativeRow> Executor::executeSelectNative(std::shared_ptr<SelectStatement> stmt) {
    std::vector<NativeRow> allRows;

    // Try preloaded binary data first (fast path — zero bridge calls)
    auto preloaded = preloadedTables.find(stmt->table);
    if (preloaded != preloadedTables.end()) {
        const uint8_t* data = reinterpret_cast<const uint8_t*>(preloaded->second.ptr);
        allRows = readBinaryRows(data, preloaded->second.len);
    } else {
        // Fallback: fetch via IStorage bridge
        val rawData = storage.getTableData(stmt->table);
        allRows = jsArrayToRows(rawData);
    }

    // Everything below is pure C++ — zero bridge calls

    bool isCount = false;
    std::string countAlias = "COUNT(*)";

    for (size_t i = 0; i < stmt->columns.size(); ++i) {
        std::string col = stmt->columns[i];
        std::string upper_col = col;
        std::transform(upper_col.begin(), upper_col.end(), upper_col.begin(), [](unsigned char c){ return std::toupper(c); });
        if (upper_col == "COUNT(*)") {
            isCount = true;
            if (i + 2 < stmt->columns.size()) {
                std::string res_upper = stmt->columns[i+1];
                std::transform(res_upper.begin(), res_upper.end(), res_upper.begin(), [](unsigned char c){ return std::toupper(c); });
                if (res_upper == "AS") {
                    countAlias = stmt->columns[i+2];
                }
            }
            break;
        }
    }

    int limit = stmt->limit.value_or(-1);
    int offset = stmt->offset.value_or(0);
    int skipped = 0;
    int pushed = 0;

    if (isCount) {
        int count = 0;
        for (const auto& row : allRows) {
            if (evaluateWhere(row, stmt->where)) count++;
        }
        NativeRow resRow;
        resRow[countAlias] = NativeValue(static_cast<double>(count));
        return {resRow};
    }

    std::vector<NativeRow> results;
    results.reserve(allRows.size());

    for (const auto& row : allRows) {
        if (evaluateWhere(row, stmt->where)) {
            if (skipped < offset) { skipped++; continue; }

            if (stmt->columns.size() == 1 && stmt->columns[0] == "*") {
                results.push_back(row);
            } else {
                NativeRow projected;
                for (const auto& col : stmt->columns) {
                    auto it = row.find(col);
                    if (it != row.end()) {
                        projected[col] = it->second;
                    }
                }
                results.push_back(std::move(projected));
            }

            pushed++;
            if (limit > 0 && pushed >= limit) break;
        }
    }

    return results;
}

} // namespace toy
