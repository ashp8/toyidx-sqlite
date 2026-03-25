cmake_minimum_required(VERSION 3.10)
project(toyindx-sqlite-wasm)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Source files
set(SOURCES
    src/cpp/lexer.cpp
    src/cpp/parser.cpp
    src/cpp/executor.cpp
    src/cpp/bindings.cpp
)

add_executable(sql_engine ${SOURCES})

# Emscripten specific flags
if(EMSCRIPTEN)
    set_target_properties(sql_engine PROPERTIES OUTPUT_NAME "sql_engine")
    set_target_properties(sql_engine PROPERTIES SUFFIX ".js")
    
    target_link_options(sql_engine PRIVATE
        "--bind"
        "-sMODULARIZE=1"
        "-sEXPORT_ES6=1"
        "-sENVIRONMENT=web,node"
        "-sALLOW_MEMORY_GROWTH=1"
        "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap']"
    )
endif()
