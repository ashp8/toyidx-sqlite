#include "executor.hpp"
#include <emscripten/val.h>
#include <algorithm>
#include <cctype>

using namespace emscripten;

namespace toy {

Executor::Executor(IStorage& storage) : storage(storage) {}

val Executor::execute(std::shared_ptr<Statement> stmt) {
    if (stmt->type() == "SELECT") {
        return executeSelect(std::static_pointer_cast<SelectStatement>(stmt));
    }
    return val::array();
}

bool evaluateWhere(val record, std::shared_ptr<WhereClause> where) {
    if (!where) return true;
    
    val recVal = record[where->column];
    if (recVal.isUndefined() || recVal.isNull()) return false;
    
    if (where->op == "=") return recVal.strictlyEquals(where->value);
    if (where->op == "!=" || where->op == "<>") return !recVal.strictlyEquals(where->value);
    
    std::string rType = recVal.typeOf().as<std::string>();
    std::string wType = where->value.typeOf().as<std::string>();

    if (rType == "number" && wType == "number") {
        double r = recVal.as<double>();
        double w = where->value.as<double>();
        if (where->op == ">") return r > w;
        if (where->op == "<") return r < w;
        if (where->op == ">=") return r >= w;
        if (where->op == "<=") return r <= w;
    } else if (rType == "string" && wType == "string") {
        std::string r = recVal.as<std::string>();
        std::string w = where->value.as<std::string>();
        if (where->op == ">") return r > w;
        if (where->op == "<") return r < w;
    }
    
    return false;
}

val Executor::executeSelect(std::shared_ptr<SelectStatement> stmt) {
    val rawData = storage.getTableData(stmt->table);
    val filtered = val::array();
    
    int length = rawData["length"].as<int>();
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
        for (int i = 0; i < length; ++i) {
            if (evaluateWhere(rawData[i], stmt->where)) {
                count++;
            }
        }
        val resObj = val::object();
        resObj.set(countAlias, count);
        filtered.call<void>("push", resObj);
        return filtered;
    }

    for (int i = 0; i < length; ++i) {
        val record = rawData[i];
        if (evaluateWhere(record, stmt->where)) {
            if (skipped < offset) {
                skipped++;
                continue;
            }
            
            if (stmt->columns.size() == 1 && stmt->columns[0] == "*") {
                filtered.call<void>("push", record);
            } else {
                val projected = val::object();
                for (const auto& col : stmt->columns) {
                    if (record.hasOwnProperty(col.c_str())) {
                         projected.set(col, record[col]);
                    }
                }
                filtered.call<void>("push", projected);
            }

            pushed++;
            if (limit > 0 && pushed >= limit) break;
        }
    }
    
    return filtered;
}

} // namespace toy
