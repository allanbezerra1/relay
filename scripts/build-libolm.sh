#!/usr/bin/env bash
# Rebuilds resources/libolm.3.dylib, which the official macOS builds of the
# mautrix bridges load from their own folder (@executable_path).
# Needs cmake and Xcode command line tools.
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
git clone -q --depth 1 --branch 3.2.16 https://gitlab.matrix.org/matrix-org/olm.git "$TMP/olm"
# Newer clang rejects a const-qualified iterator in list.hh; upstream never released the fix.
sed -i '' 's/T \* const other_pos = other._data;/T const * other_pos = other._data;/' "$TMP/olm/include/olm/list.hh"
cmake -S "$TMP/olm" -B "$TMP/build" -DCMAKE_BUILD_TYPE=Release -DOLM_TESTS=OFF \
  -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_INSTALL_NAME_DIR=@rpath -DCMAKE_POLICY_VERSION_MINIMUM=3.5 >/dev/null
cmake --build "$TMP/build" -j8 >/dev/null
cp -L "$TMP/build/libolm.3.dylib" resources/libolm.3.dylib
rm -rf "$TMP"
echo "Built resources/libolm.3.dylib"
