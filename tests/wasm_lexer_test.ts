import initSqlEngine from '../src/wasm/sql_engine.js';

async function testLexer() {
    const Module = await initSqlEngine();
    const lexer = new Module.Lexer("SELECT * FROM users WHERE id = 1");
    
    let token;
    while (true) {
        token = lexer.nextToken();
        console.log(`Token: type=${token.type}, value='${token.value}', line=${token.line}, col=${token.column}`);
        if (token.type === Module.TokenType.EOF) break;
    }
    
    lexer.delete();
}

testLexer().catch(console.error);
