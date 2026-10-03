#!/bin/sh
# Builds the public (ad-hoc signed) app and publishes it as a GitHub release.
# Installed copies of Relay pick it up through electron/updater.cjs, which needs the .zip.
#   npm version minor --no-git-tag-version && scripts/release.sh
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
rm -f release/Relay-*.dmg release/Relay-*.zip release/*.blockmap
npm run dist:public
gh release create "v$VERSION" \
  "release/Relay-$VERSION-arm64.dmg" \
  "release/Relay-$VERSION-arm64-mac.zip" \
  --title "Relay $VERSION" --generate-notes "$@"
