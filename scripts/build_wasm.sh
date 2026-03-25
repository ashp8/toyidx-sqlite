#!/bin/bash
set -e

# Path to emcc
export EMCC_DEBUG=0
export CC=/usr/lib/emscripten/emcc
export CXX=/usr/lib/emscripten/em++

mkdir -p build_wasm
cd build_wasm

# Run emcmake with basic configuration
# -sEXPORT_ES6=1, -sMODULARIZE=1 are handled in CMakeLists.txt or here if preferred
# Adding -fexceptions to enable C++ exception catching in JS
/usr/lib/emscripten/emcmake cmake .. -DCMAKE_TOOLCHAIN_FILE=/usr/lib/emscripten/cmake/Modules/Platform/Emscripten.cmake \
                -DCMAKE_CROSSCOMPILING_EMULATOR=/usr/bin/node \
                -DCMAKE_CXX_FLAGS="-fexceptions"
# Run emmake
/usr/lib/emscripten/emmake make -j$(nproc)

# Copy output to src/wasm
mkdir -p ../src/wasm
cp sql_engine.js ../src/wasm/
cp sql_engine.wasm ../src/wasm/

echo "Wasm build completed successfully."
