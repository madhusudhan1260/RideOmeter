#!/usr/bin/env bash
# Fetch the OFL-licensed display/body fonts and place them where React Native
# Android loads custom fonts (assets/fonts/<Family-Weight>.ttf). Until this runs,
# the app falls back to the system font.
set -euo pipefail
DEST="$(dirname "$0")/../android/app/src/main/assets/fonts"
mkdir -p "$DEST"
BASE="https://cdn.jsdelivr.net/fontsource/fonts"
fetch() { curl -fsSL "$BASE/$1" -o "$DEST/$2" && echo "  $2"; }
echo "Downloading fonts to $DEST"
fetch "rajdhani@5.2.5/latin-700-normal.ttf" "Rajdhani-Bold.ttf"
fetch "rajdhani@5.2.5/latin-600-normal.ttf" "Rajdhani-SemiBold.ttf"
fetch "inter@5.2.5/latin-400-normal.ttf" "Inter-Regular.ttf"
fetch "inter@5.2.5/latin-500-normal.ttf" "Inter-Medium.ttf"
fetch "inter@5.2.5/latin-600-normal.ttf" "Inter-SemiBold.ttf"
echo "Done. Rebuild the app (npm run android)."
