#!/usr/bin/env bash
# Run a command with JDK 17 + the Android SDK, without changing the global JAVA_HOME.
# React Native 0.88's Gradle/Kotlin toolchain targets JDK 17.
set -euo pipefail
# Note: `java_home -v 17` means "17 or newer" on macOS, so check the real major version.
for candidate in \
  /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
  /usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
  "$(/usr/libexec/java_home -v 17 2>/dev/null || true)"; do
  if [ -n "$candidate" ] && "$candidate/bin/java" -version 2>&1 | grep -q 'version "17\.'; then export JAVA_HOME="$candidate"; break; fi
done
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
exec "$@"
