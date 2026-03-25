#pragma once

#include <string>

namespace toy {

enum class TokenType {
    Keyword = 0,
    Identifier = 1,
    Number = 2,
    String = 3,
    Operator = 4,
    Punctuation = 5,
    EOF_TOKEN = 6
};

struct Token {
    TokenType type;
    std::string value;
    int line;
    int column;
};

class Lexer {
public:
    Lexer(const std::string& sql);
    Token nextToken();

private:
    std::string sql;
    size_t pos;
    char currentChar;
    int line;
    int col;

    void advance();
    void skipWhitespace();
    Token handleIdentifier();
    Token handleNumber();
    Token handleString();
    Token handleOperator();
};

} // namespace toy
