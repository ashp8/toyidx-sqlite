#include <emscripten/bind.h>
#include <emscripten/val.h>
#include "lexer.hpp"
#include "parser.hpp"
#include "executor.hpp"

using namespace emscripten;
using namespace toy;

// Wrapper for IStorage to allow implementation in JS
struct IStorageWrapper : public wrapper<IStorage> {
    EMSCRIPTEN_WRAPPER(IStorageWrapper);
    val getTableData(const std::string& tableName) override {
        return call<val>("getTableData", tableName);
    }
    std::string getTableDataJson(const std::string& tableName) override {
        return call<std::string>("getTableDataJson", tableName);
    }
};

EMSCRIPTEN_BINDINGS(toy_sql_engine) {
    enum_<TokenType>("TokenType")
        .value("Keyword", TokenType::Keyword)
        .value("Identifier", TokenType::Identifier)
        .value("Number", TokenType::Number)
        .value("String", TokenType::String)
        .value("Operator", TokenType::Operator)
        .value("Punctuation", TokenType::Punctuation)
        .value("EOF", TokenType::EOF_TOKEN);

    value_object<Token>("Token")
        .field("type", &Token::type)
        .field("value", &Token::value)
        .field("line", &Token::line)
        .field("column", &Token::column);

    class_<Lexer>("Lexer")
        .constructor<std::string>()
        .function("nextToken", &Lexer::nextToken);

    class_<Statement>("Statement")
        .smart_ptr<std::shared_ptr<Statement>>("Statement")
        .function("type", &Statement::type);

    class_<SelectStatement, base<Statement>>("SelectStatement")
        .smart_ptr<std::shared_ptr<SelectStatement>>("SelectStatement")
        .property("table", &SelectStatement::table);

    class_<Parser>("Parser")
        .constructor<Lexer&>()
        .function("parse", &Parser::parse);

    class_<IStorage>("IStorage")
        .function("getTableData", &IStorage::getTableData, pure_virtual())
        .function("getTableDataJson", &IStorage::getTableDataJson)
        .allow_subclass<IStorageWrapper>("IStorageWrapper");

    class_<Executor>("Executor")
        .constructor<IStorage&>()
        .function("execute", &Executor::execute);
}
