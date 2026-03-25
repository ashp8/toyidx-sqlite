#include "lexer.hpp"
#include <cctype>
#include <stdexcept>

namespace toy {

Lexer::Lexer(const std::string& sql) : sql(sql), pos(0), line(1), col(1) {
    currentChar = sql.empty() ? '\0' : sql[0];
}

void Lexer::advance() {
    if (currentChar == '\n') {
        line++;
        col = 1;
    } else {
        col++;
    }
    pos++;
    currentChar = (pos < sql.length()) ? sql[pos] : '\0';
}

void Lexer::skipWhitespace() {
    while (currentChar != '\0' && std::isspace(static_cast<unsigned char>(currentChar))) {
        advance();
    }
}

Token Lexer::nextToken() {
    skipWhitespace();

    if (currentChar == '\0') {
        return {TokenType::EOF_TOKEN, "", line, col};
    }

    int startLine = line;
    int startCol = col;

    if (std::isdigit(static_cast<unsigned char>(currentChar))) {
        return handleNumber();
    }

    if (std::isalpha(static_cast<unsigned char>(currentChar)) || currentChar == '_') {
        return handleIdentifier();
    }

    if (currentChar == '\'' || currentChar == '"') {
        return handleString();
    }

    // Handle operators and punctuation
    const std::string opChars = "=><!|*+-/%";
    if (opChars.find(currentChar) != std::string::npos) {
        return handleOperator();
    }

    // Punctuation
    std::string val(1, currentChar);
    advance();
    return {TokenType::Punctuation, val, startLine, startCol};
}

Token Lexer::handleNumber() {
    int startLine = line;
    int startCol = col;
    std::string value;
    while (currentChar != '\0' && std::isdigit(static_cast<unsigned char>(currentChar))) {
        value += currentChar;
        advance();
    }
    return {TokenType::Number, value, startLine, startCol};
}

Token Lexer::handleIdentifier() {
    int startLine = line;
    int startCol = col;
    std::string value;
    while (currentChar != '\0' && (std::isalnum(static_cast<unsigned char>(currentChar)) || currentChar == '_')) {
        value += currentChar;
        advance();
    }
    return {TokenType::Identifier, value, startLine, startCol};
}

Token Lexer::handleString() {
    char quote = currentChar;
    int startLine = line;
    int startCol = col;
    std::string value;
    advance(); // skip quote
    while (currentChar != '\0' && currentChar != quote) {
        value += currentChar;
        advance();
    }

    if (currentChar == quote) {
        advance(); // skip quote
    } else {
        throw std::runtime_error("Unterminated string literal at line " + std::to_string(startLine) + ", col " + std::to_string(startCol));
    }

    return {TokenType::String, value, startLine, startCol};
}

Token Lexer::handleOperator() {
    int startLine = line;
    int startCol = col;
    std::string val(1, currentChar);
    advance();

    if ((val == "=" || val == ">" || val == "<" || val == "!") && currentChar == '=') {
        val += currentChar;
        advance();
    } else if (val == "|" && currentChar == '|') {
        val += currentChar;
        advance();
    } else if (val == "<" && currentChar == '>') {
        val += currentChar;
        advance();
    }

    return {TokenType::Operator, val, startLine, startCol};
}

} // namespace toy
