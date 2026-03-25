#include "parser.hpp"
#include <algorithm>
#include <stdexcept>
#include <emscripten/val.h>

using namespace emscripten;

namespace toy {

Parser::Parser(Lexer& lexer) : lexer(lexer) {
    currentToken = lexer.nextToken();
}

void Parser::advance() {
    currentToken = lexer.nextToken();
}

void Parser::eat(TokenType type) {
    if (currentToken.type == type) {
        advance();
    } else {
        throw std::runtime_error("Unexpected token");
    }
}

std::shared_ptr<Statement> Parser::parse() {
    std::string value_str = currentToken.value;
    std::transform(value_str.begin(), value_str.end(), value_str.begin(), ::toupper);

    if (value_str == "CREATE") {
        advance(); // eat CREATE
        std::string next = currentToken.value;
        std::transform(next.begin(), next.end(), next.begin(), ::toupper);
        if (next == "TABLE") return parseCreateTable();
    } else if (value_str == "SELECT") {
        return parseSelect();
    } else if (value_str == "INSERT") {
        return parseInsert();
    } else if (value_str == "UPDATE") {
        return parseUpdate();
    } else if (value_str == "DELETE") {
        return parseDelete();
    } else if (value_str == "BEGIN" || value_str == "COMMIT" || value_str == "ROLLBACK" || value_str == "SAVEPOINT" || value_str == "RELEASE") {
        return parseTransaction();
    }

    throw std::runtime_error("Unsupported query keyword: " + value_str);
}

std::shared_ptr<CreateTableStatement> Parser::parseCreateTable() {
    auto stmt = std::make_shared<CreateTableStatement>();
    eat(TokenType::Identifier); // TABLE

    // Handle IF NOT EXISTS
    std::string value_str = currentToken.value;
    std::transform(value_str.begin(), value_str.end(), value_str.begin(), ::toupper);
    if (value_str == "IF") {
        advance();
        value_str = currentToken.value;
        std::transform(value_str.begin(), value_str.end(), value_str.begin(), ::toupper);
        if (value_str == "NOT") {
            advance();
            value_str = currentToken.value;
            std::transform(value_str.begin(), value_str.end(), value_str.begin(), ::toupper);
            if (value_str == "EXISTS") {
                advance();
                stmt->ifNotExists = true;
            }
        }
    }

    stmt->name = currentToken.value;
    eat(TokenType::Identifier);
    eat(TokenType::Punctuation); // '('

    while (currentToken.type != TokenType::EOF_TOKEN && currentToken.value != ")") {
        ColumnDefinition col;
        col.name = currentToken.value;
        eat(TokenType::Identifier);

        if (currentToken.type == TokenType::Identifier) {
            col.dataType = currentToken.value;
            eat(TokenType::Identifier);
            // Handle size (int, varchar(20))
            if (currentToken.value == "(") {
                eat(TokenType::Punctuation);
                col.dataType += "(" + currentToken.value + ")";
                advance(); // eat size
                eat(TokenType::Punctuation); // eat ')'
            }
        }

        // Constraints
        while (currentToken.type != TokenType::EOF_TOKEN && currentToken.value != "," && currentToken.value != ")") {
            std::string cval = currentToken.value;
            std::transform(cval.begin(), cval.end(), cval.begin(), ::toupper);
            if (cval == "PRIMARY") {
                advance();
                cval = currentToken.value;
                std::transform(cval.begin(), cval.end(), cval.begin(), ::toupper);
                if (cval == "KEY") {
                    advance();
                    col.isPrimaryKey = true;
                    stmt->primaryKey.push_back(col.name);
                }
            } else if (cval == "NOT") {
                advance();
                cval = currentToken.value;
                std::transform(cval.begin(), cval.end(), cval.begin(), ::toupper);
                if (cval == "NULL") {
                    advance();
                    col.isNullable = false;
                }
            } else {
                advance(); // Skip unknown for now
            }
        }

        stmt->columns.push_back(col);
        if (currentToken.value == ",") eat(TokenType::Punctuation);
    }

    eat(TokenType::Punctuation); // ')'
    return stmt;
}

std::shared_ptr<SelectStatement> Parser::parseSelect() {
    auto stmt = std::make_shared<SelectStatement>();
    eat(TokenType::Identifier); // SELECT

    if (currentToken.value == "*") {
        stmt->columns.push_back("*");
        advance();
    } else {
        while (currentToken.type != TokenType::EOF_TOKEN) {
            std::string val_str = currentToken.value;
            std::string upper_val = val_str;
            std::transform(upper_val.begin(), upper_val.end(), upper_val.begin(), ::toupper);
            
            if (upper_val == "FROM") break;
            
            if (upper_val == "COUNT") {
                advance();
                eat(TokenType::Punctuation); // (
                eat(TokenType::Operator); // *
                eat(TokenType::Punctuation); // )
                stmt->columns.push_back("count(*)");
            } else {
                stmt->columns.push_back(val_str);
                advance();
            }

            // Handle AS alias
            std::string next_str = currentToken.value;
            std::transform(next_str.begin(), next_str.end(), next_str.begin(), ::toupper);
            if (next_str == "AS") {
                advance();
                stmt->columns.push_back("as");
                stmt->columns.push_back(currentToken.value);
                advance();
            }

            if (currentToken.value == ",") eat(TokenType::Punctuation);
            else break;
        }
    }

    std::string value_str = currentToken.value;
    std::transform(value_str.begin(), value_str.end(), value_str.begin(), ::toupper);
    if (value_str == "FROM") {
        advance();
        stmt->table = currentToken.value;
        eat(TokenType::Identifier);
    }

    stmt->where = parseWhere();

    // Handle LIMIT and OFFSET
    value_str = currentToken.value;
    std::transform(value_str.begin(), value_str.end(), value_str.begin(), ::toupper);
    if (value_str == "LIMIT") {
        advance();
        stmt->limit = std::stoi(currentToken.value);
        advance();
        
        value_str = currentToken.value;
        std::transform(value_str.begin(), value_str.end(), value_str.begin(), ::toupper);
        if (value_str == "OFFSET") {
            advance();
            stmt->offset = std::stoi(currentToken.value);
            advance();
        }
    }

    return stmt;
}

std::shared_ptr<WhereClause> Parser::parseWhere() {
    std::string value_str = currentToken.value;
    std::transform(value_str.begin(), value_str.end(), value_str.begin(), ::toupper);
    if (value_str == "WHERE") {
        advance();
        return parseCondition();
    }
    return nullptr;
}

std::shared_ptr<WhereClause> Parser::parseCondition() {
    return parseSimpleCondition();
}

std::shared_ptr<WhereClause> Parser::parseSimpleCondition() {
    auto cond = std::make_shared<WhereClause>();
    cond->column = currentToken.value;
    eat(TokenType::Identifier);
    cond->op = currentToken.value;
    advance(); // eat op
    
    if (currentToken.type == TokenType::Number) {
        cond->value = val(std::stod(currentToken.value));
        advance();
    } else if (currentToken.type == TokenType::String) {
        cond->value = val(currentToken.value);
        advance();
    } else if (currentToken.type == TokenType::Identifier) {
        cond->value = val(currentToken.value);
        advance();
    }
    return cond;
}

std::shared_ptr<InsertStatement> Parser::parseInsert() {
    auto stmt = std::make_shared<InsertStatement>();
    eat(TokenType::Identifier); // INSERT
    
    std::string value_str = currentToken.value;
    std::transform(value_str.begin(), value_str.end(), value_str.begin(), ::toupper);
    if (value_str == "OR") {
        advance();
        value_str = currentToken.value;
        std::transform(value_str.begin(), value_str.end(), value_str.begin(), ::toupper);
        if (value_str == "IGNORE") { stmt->orIgnore = true; advance(); }
        else if (value_str == "REPLACE") { stmt->orReplace = true; advance(); }
    }

    value_str = currentToken.value;
    std::transform(value_str.begin(), value_str.end(), value_str.begin(), ::toupper);
    if (value_str == "INTO") advance();

    stmt->table = currentToken.value;
    eat(TokenType::Identifier);

    if (currentToken.value == "(") {
        eat(TokenType::Punctuation);
        while (currentToken.type != TokenType::EOF_TOKEN && currentToken.value != ")") {
            stmt->columns.push_back(currentToken.value);
            eat(TokenType::Identifier);
            if (currentToken.value == ",") eat(TokenType::Punctuation);
            else break;
        }
        eat(TokenType::Punctuation); // ')'
    }

    value_str = currentToken.value;
    std::transform(value_str.begin(), value_str.end(), value_str.begin(), ::toupper);
    if (value_str == "VALUES") {
        advance();
        while (currentToken.value == "(") {
            eat(TokenType::Punctuation);
            std::vector<Value> tuple;
            while (currentToken.type != TokenType::EOF_TOKEN && currentToken.value != ")") {
                if (currentToken.type == TokenType::Number) tuple.push_back(val(std::stod(currentToken.value)));
                else tuple.push_back(val(currentToken.value));
                advance();
                if (currentToken.value == ",") eat(TokenType::Punctuation);
                else break;
            }
            eat(TokenType::Punctuation); // ')'
            stmt->values.push_back(tuple);
            if (currentToken.value == ",") eat(TokenType::Punctuation);
            else break;
        }
    }
    return stmt; 
}

std::shared_ptr<UpdateStatement> Parser::parseUpdate() {
    auto stmt = std::make_shared<UpdateStatement>();
    eat(TokenType::Identifier); // UPDATE
    stmt->table = currentToken.value;
    eat(TokenType::Identifier);
    std::string value_str = currentToken.value;
    std::transform(value_str.begin(), value_str.end(), value_str.begin(), ::toupper);
    if (value_str == "SET") advance(); // eat SET
    
    while (currentToken.type != TokenType::EOF_TOKEN && currentToken.value != "WHERE") {
        std::string col = currentToken.value;
        eat(TokenType::Identifier);
        eat(TokenType::Operator); // eat '='
        Value val_expr = val::undefined();
        if (currentToken.type == TokenType::Number) val_expr = val(std::stod(currentToken.value));
        else if (currentToken.type == TokenType::String) val_expr = val(currentToken.value);
        else if (currentToken.type == TokenType::Identifier) val_expr = val(currentToken.value);
        advance();
        stmt->setParts.push_back({col, val_expr});
        if (currentToken.value == ",") eat(TokenType::Punctuation);
        else break;
    }
    stmt->where = parseWhere();
    return stmt;
}

std::shared_ptr<DeleteStatement> Parser::parseDelete() {
    auto stmt = std::make_shared<DeleteStatement>();
    eat(TokenType::Identifier); // DELETE
    std::string value_str = currentToken.value;
    std::transform(value_str.begin(), value_str.end(), value_str.begin(), ::toupper);
    if (value_str == "FROM") advance();
    stmt->table = currentToken.value;
    eat(TokenType::Identifier);
    stmt->where = parseWhere();
    return stmt;
}

std::shared_ptr<TransactionStatement> Parser::parseTransaction() {
    auto stmt = std::make_shared<TransactionStatement>();
    std::string actionStr = currentToken.value;
    std::transform(actionStr.begin(), actionStr.end(), actionStr.begin(), ::toupper);
    advance(); // eat action
    
    if (actionStr == "BEGIN" || actionStr == "COMMIT") {
        std::string valStr = currentToken.value;
        std::transform(valStr.begin(), valStr.end(), valStr.begin(), ::toupper);
        if (valStr == "TRANSACTION") advance();
        stmt->action = actionStr;
        return stmt;
    } else if (actionStr == "ROLLBACK") {
        std::string valStr = currentToken.value;
        std::transform(valStr.begin(), valStr.end(), valStr.begin(), ::toupper);
        if (valStr == "TRANSACTION") advance();
        
        valStr = currentToken.value;
        std::transform(valStr.begin(), valStr.end(), valStr.begin(), ::toupper);
        if (valStr == "TO") {
            advance(); // eat TO
            valStr = currentToken.value;
            std::transform(valStr.begin(), valStr.end(), valStr.begin(), ::toupper);
            if (valStr == "SAVEPOINT") advance();
            stmt->name = currentToken.value;
            eat(TokenType::Identifier);
            stmt->action = "ROLLBACK_TO";
            return stmt;
        }
        stmt->action = "ROLLBACK";
        return stmt;
    } else if (actionStr == "SAVEPOINT") {
        stmt->name = currentToken.value;
        eat(TokenType::Identifier);
        stmt->action = "SAVEPOINT";
        return stmt;
    } else if (actionStr == "RELEASE") {
        std::string valStr = currentToken.value;
        std::transform(valStr.begin(), valStr.end(), valStr.begin(), ::toupper);
        if (valStr == "SAVEPOINT") advance();
        stmt->name = currentToken.value;
        eat(TokenType::Identifier);
        stmt->action = "RELEASE";
        return stmt;
    }

    throw std::runtime_error("Invalid transaction action: " + actionStr);
}

} // namespace toy
