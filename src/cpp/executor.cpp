#include "executor.hpp"
#include <algorithm>
#include <cctype>
#include <cstring>

using namespace emscripten;

namespace toy {

Executor::Executor(IStorage& storage) : storage(storage) {}

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

// Minimal JSON array parser — handles flat objects with string, number, null values.
// Avoids the need for a full JSON library.
std::vector<NativeRow> Executor::parseJsonRows(const std::string& json) {
    std::vector<NativeRow> rows;
    const char* p = json.c_str();
    const char* end = p + json.size();
    
    // Skip to array start
    while (p < end && *p != '[') ++p;
    if (p >= end) return rows;
    ++p; // skip '['
    
    while (p < end) {
        // Skip whitespace
        while (p < end && (*p == ' ' || *p == '\n' || *p == '\r' || *p == '\t' || *p == ',')) ++p;
        if (p >= end || *p == ']') break;
        
        if (*p != '{') break;
        ++p; // skip '{'
        
        NativeRow row;
        
        while (p < end && *p != '}') {
            // Skip whitespace and commas
            while (p < end && (*p == ' ' || *p == '\n' || *p == '\r' || *p == '\t' || *p == ',')) ++p;
            if (p >= end || *p == '}') break;
            
            // Parse key (expect quoted string)
            if (*p != '"') break;
            ++p;
            const char* keyStart = p;
            while (p < end && *p != '"') ++p;
            std::string key(keyStart, p);
            if (p < end) ++p; // skip closing quote
            
            // Skip colon
            while (p < end && (*p == ' ' || *p == ':')) ++p;
            
            // Parse value
            if (p >= end) break;
            
            if (*p == '"') {
                // String value
                ++p;
                std::string val;
                while (p < end && *p != '"') {
                    if (*p == '\\' && p + 1 < end) {
                        ++p;
                        if (*p == 'n') val += '\n';
                        else if (*p == 't') val += '\t';
                        else if (*p == '"') val += '"';
                        else if (*p == '\\') val += '\\';
                        else val += *p;
                    } else {
                        val += *p;
                    }
                    ++p;
                }
                if (p < end) ++p; // skip closing quote
                row[key] = NativeValue(val);
            } else if (*p == 'n') {
                // null
                p += 4; // skip "null"
                row[key] = NativeValue::null();
            } else if (*p == '-' || (*p >= '0' && *p <= '9')) {
                // Number
                const char* numStart = p;
                if (*p == '-') ++p;
                while (p < end && ((*p >= '0' && *p <= '9') || *p == '.' || *p == 'e' || *p == 'E' || *p == '+' || *p == '-')) {
                    // Avoid double-counting the initial minus
                    if ((*p == '+' || *p == '-') && p > numStart && *(p-1) != 'e' && *(p-1) != 'E') break;
                    ++p;
                }
                double num = std::stod(std::string(numStart, p));
                row[key] = NativeValue(num);
            } else {
                // Skip unknown value
                while (p < end && *p != ',' && *p != '}') ++p;
            }
        }
        
        if (p < end && *p == '}') ++p;
        rows.push_back(std::move(row));
    }
    
    return rows;
}

std::vector<NativeRow> Executor::executeSelectNative(std::shared_ptr<SelectStatement> stmt) {
    // Get data as JSON string — single bridge call, then parse in C++
    std::string jsonData = storage.getTableDataJson(stmt->table);
    std::vector<NativeRow> allRows;
    
    if (jsonData.size() > 2) { // More than just "[]"
        allRows = parseJsonRows(jsonData);
    } else {
        // Fallback to val-based transfer if JSON is empty/unavailable
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
            if (evaluateWhere(row, stmt->where)) {
                count++;
            }
        }
        NativeRow resRow;
        resRow[countAlias] = NativeValue(static_cast<double>(count));
        return {resRow};
    }

    std::vector<NativeRow> results;
    results.reserve(allRows.size());

    for (const auto& row : allRows) {
        if (evaluateWhere(row, stmt->where)) {
            if (skipped < offset) {
                skipped++;
                continue;
            }
            
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
