#pragma once

#include "ast.hpp"
#include <vector>
#include <map>

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

private:
    IStorage& storage;

    emscripten::val executeSelect(std::shared_ptr<SelectStatement> stmt);
};

} // namespace toy
