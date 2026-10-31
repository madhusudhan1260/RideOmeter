# RideWave

Motorcycle group-riding companion: ride management, group intercom (online + offline), synchronized music,
live group map, two-tap stop requests and SOS — with an honest offline mode.

```
ridewave/
├── backend/     FastAPI · SQLAlchemy 2 · Alembic · JWT/Argon2id · WebSockets · LiveKit tokens
├── mobile/      React Native 0.88 (bare) · TypeScript · Zustand · TanStack Query · Reanimated · MapLibre
│   └── android/app/src/main/java/com/ridewave/app/{nearby,voice,audio}   Kotlin native modules
├── docs/        ARCHITECTURE · API · STATUS (what works) · DEVICE_TESTING
└── docker-compose.yml   optional Postgres + LiveKit + API
```

Start with **[docs/STATUS.md](docs/STATUS.md)** — it separates what is tested, what needs a real phone, and what is not built.
Design and the offline-voice explanation are in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Costs (zero to start)

Everything runs locally with free/open-source software. Third-party accounts you may need:

| What | Cost | Needed for |
|---|---|---|
| Google Play services on the phones | free | offline mesh (Nearby Connections) |
| LiveKit | free, self-hosted (`livekit-server --dev`) | online voice |
| OpenStreetMap tiles, Nominatim, OSRM demo | free, fair-use limits | map, place search, route — self-host or use a free tier before public release |
| Spotify developer app | free; **each rider needs Premium** for playback control; dev-mode apps are limited to allow-listed users | Spotify group music (local files work without it) |
| Firebase (FCM) | free | server push — not wired yet |
| Google Play publishing | one-time $25 | only when you publish |

## 1. Backend

Requires Python 3.12+.

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env            # set RW_JWT_SECRET; set RW_PUBLIC_BASE_URL to your LAN IP
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8030
```

* Interactive API docs: `http://localhost:8030/docs`
* Tests: `.venv/bin/pytest` (51 tests)
* Postgres instead of SQLite: set `RW_DATABASE_URL=postgresql+psycopg://…` (or `docker compose up db`)

## 2. LiveKit (online voice), free and local

```bash
brew install livekit            # or download from github.com/livekit/livekit/releases
livekit-server --dev --bind 0.0.0.0
```

Dev keys are `devkey` / `secret` (already the backend defaults). Set `RW_LIVEKIT_URL=ws://<LAN-IP>:7880`.

## 3. Mobile (Android)

Requires Node 22+, **JDK 17**, the Android SDK (platform 37, build-tools 37.0.0, NDK 27.1.12297006, CMake 3.22.1) and a phone with USB
debugging (the emulator has no Nearby/Bluetooth radio). Without Android Studio:

```bash
brew install openjdk@17 && brew install --cask android-commandlinetools
yes | sdkmanager --sdk_root=$HOME/Library/Android/sdk --licenses
sdkmanager --sdk_root=$HOME/Library/Android/sdk "platform-tools" "platforms;android-37.0" "build-tools;37.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
echo "sdk.dir=$HOME/Library/Android/sdk" > mobile/android/local.properties
```

`npm run android` / `npm run android:build` select JDK 17 themselves (`scripts/with-android-env.sh`), so a different global
`JAVA_HOME` is fine.

```bash
cd mobile
npm install
npm run fonts                   # optional: fetches the OFL Rajdhani + Inter fonts and links them
npm start                       # Metro
npm run android                 # builds and installs the debug app
```

In the app, on the sign-in screen tap **Server → change** and enter `http://<laptop-LAN-IP>:8030`.
The emulator default is `http://10.0.2.2:8030`.

Tests: `npx tsc --noEmit` (types) and `npx jest` (21 logic tests).

### Release APK

```bash
cd mobile/android
keytool -genkeypair -v -keystore ridewave-release.keystore -alias ridewave -keyalg RSA -keysize 2048 -validity 10000
# add MYAPP_UPLOAD_* properties to ~/.gradle/gradle.properties and a release signingConfig in app/build.gradle
./gradlew assembleRelease       # → app/build/outputs/apk/release/app-release.apk
```

### Spotify (optional)

1. Create an app at developer.spotify.com (free), add redirect URI `com.ridewave.app:/spotify-callback`.
2. In RideWave → Settings → Spotify, paste the Client ID. Each rider connects their own account in Music → Library.

## How offline works (short version)

The admin's phone is the hub of a Nearby Connections star. Members in radio range (tens of metres between moving
bikes) connect to it after proving they hold the ride's offline key. Events (stops, SOS, locations, music commands)
and push-to-talk voice are relayed by the hub. Everything the phone authored offline is queued in SQLite and uploaded
when internet returns; the server deduplicates by event id and re-checks permissions. Details and limits:
`docs/ARCHITECTURE.md` §3.
