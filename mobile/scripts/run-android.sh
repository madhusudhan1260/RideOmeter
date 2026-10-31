#!/usr/bin/env bash
# Forward the backend (8030) and Metro (8081) ports to every attached device/emulator,
# then build, install and launch the debug app.
set -euo pipefail
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
for serial in $("$ADB" devices | awk 'NR>1 && $2=="device" {print $1}'); do
  "$ADB" -s "$serial" reverse tcp:8030 tcp:8030
  "$ADB" -s "$serial" reverse tcp:8081 tcp:8081
  echo "ports 8030/8081 forwarded to $serial"
done
exec npx react-native run-android "$@"
