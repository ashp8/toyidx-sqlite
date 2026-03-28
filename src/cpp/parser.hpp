#pragma once

#include "lexer.hpp"
#include "ast.hpp"
#include <memory>

namespace toy {

class Parser {
public:
    Parser(Lexer& lexer);
    std::shared_ptr<Statement> parse();

private:
    Lexer& lexer;
    Token currentToken;

    void eat(TokenType type);
    void advance();

    std::shared_ptr<CreateTableStatement> parseCreateTable();
    std::shared_ptr<InsertStatement> parseInsert();
    std::shared_ptr<SelectStatement> parseSelect();
    std::shared_ptr<UpdateStatement> parseUpdate();
    std::shared_ptr<DeleteStatement> parseDelete();
    std::shared_ptr<TransactionStatement> parseTransaction();
    
    std::shared_ptr<WhereClause> parseWhere();
    std::shared_ptr<WhereClause> parseCondition();
    std::shared_ptr<WhereClause> parseSimpleCondition();
    
    NativeValue parseValue();
};

} // namespace toy
