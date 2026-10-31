# RideWave — Feature status

Honest status of every feature. Four categories, as required:

* **Implemented & tested** — code complete and covered by automated tests that ran green.
* **Implemented, needs device testing** — code complete and type-checked, but it depends on phone hardware, radio
  or OS behaviour that can't be verified on a laptop. Not claimed working until `DEVICE_TESTING.md` passes.
* **Simulated for development** — a development-only shortcut, clearly labelled.
* **Not yet supported** — not built; the reason and the practical alternative are given.

Last verified: 2026-10-31 — backend `pytest`: **51 passed**; mobile `tsc --noEmit`: **0 errors**; mobile `jest`: **21 passed**;
Android `assembleDebug` (arm64-v8a): **BUILD SUCCESSFUL** — all native libraries and the RideWave Kotlin modules compile.
**On-device (2026-10-31, Redmi 15A 5G, HyperOS / Android 16, over USB with `adb reverse`):** app installs and launches
(Fabric on), onboarding renders, and registration → profile → ride lists → device registration, ride create → invite → start, live WebSocket
(`/ws/rides/{id}` accepted) and voice-token issue all succeeded against the local backend. **Online voice not yet
verified:** the LiveKit client stalled at "signal connecting" over `adb reverse` (server reachable from the laptop,
no request logged); investigation was interrupted when the phone disconnected. Next: test over Wi-Fi with
`RW_LIVEKIT_URL=ws://<LAN-IP>:7880` to rule out the USB tunnel.

## Backend (FastAPI)

| Feature | Status |
|---|---|
| Register / login (email or username) / logout | Implemented & tested |
| Argon2id hashing, timing-equalised login | Implemented & tested |
| JWT access tokens (15 min) + rotating refresh tokens with reuse detection | Implemented & tested |
| Forgot / reset password (revokes all sessions) | Implemented & tested — **e-mail delivery not configured**; in dev the token is returned in the response (`RW_EXPOSE_RESET_TOKEN`, refused in production) |
| Profile, motorcycle, emergency contact, avatar upload (PNG/JPEG sniffed, 2 MB) | Implemented & tested |
| Rides: create, list (mine / history / public), detail, update | Implemented & tested |
| Join by code, invitation links (expiry, max uses), QR (SVG) | Implemented & tested |
| Approval flow, remove rider (blocks rejoin), co-admin, admin hand-over on leave | Implemented & tested |
| Role-based authorization; non-participants get 404 (no ride-id probing) | Implemented & tested |
| Group music state: queue / play / pause / next / previous / enable, versioned, anchor-time sync | Implemented & tested |
| Stop requests: 8 types, dedupe, idempotent retries, 10-min expiry, acknowledge / approve / reject / complete | Implemented & tested |
| Emergencies: create, idempotent, per-recipient delivery counts, acknowledge, resolve, emergency contact | Implemented & tested |
| Locations: post, latest with LIVE / STALE / UNAVAILABLE, sharing toggle hides coordinates | Implemented & tested |
| Announcements → notifications + WS | Implemented & tested |
| WebSocket `/ws/rides/{id}`: first-message auth, presence, broadcast, clock ping, delivery acks, role checks, flood limit | Implemented & tested |
| Offline sync endpoint: idempotent, sender-must-be-uploader, role re-validation, future/old timestamp rejection | Implemented & tested |
| LiveKit token minting with publish permission by voice mode | Implemented & tested (token claims) |
| LiveKit live permission update on voice-mode change | Implemented, needs a running LiveKit server to verify |
| Devices, helmets, notifications list | Implemented (light test coverage) |
| Rate limiting | Implemented & tested (in-process; use Redis for multi-instance) |
| Alembic migrations | Implemented, verified on SQLite (`alembic upgrade head`) |
| PostgreSQL | Supported via `RW_DATABASE_URL` + `psycopg`; **not run in this session** |
| Redis pub/sub for multi-worker WebSockets | Not yet supported — single-process fan-out today; the manager's `broadcast` is the seam |
| Server push (FCM) | Not yet supported — needs a free Firebase project; `PushSender` is a no-op that logs. In-app WS + local notifications work |
| Location retention purge job | Function exists (`purge_old`), not scheduled |

## Mobile (React Native 0.88, TypeScript)

| Feature | Status |
|---|---|
| Design system ("Instrument Cluster"), day + high-contrast night palette | Implemented |
| Custom SVG icon set, gauge, LEDs, PTT button, hold-to-fire SOS, tick progress | Implemented |
| All 10 screens + library, invite, scanner, history; loading / empty / error / offline states | Implemented, needs device run |
| Auth flow with Keychain-stored refresh token, auto-refresh on 401 | Implemented, needs device run |
| Configurable server URL (LAN testing) | Implemented |
| Connection state machine (ONLINE → … → OFFLINE_MODE → SYNCING → ONLINE) | Implemented & tested (unit) |
| Event bus with cross-transport dedupe and mesh admin-only filtering | Implemented & tested (unit) |
| WebSocket transport: auth, backoff, heartbeat, NTP-style clock sync | Implemented; clock math unit tested |
| SQLite outbox + flush on reconnect | Implemented & tested (unit, memory store); SQLite adapter needs device |
| Stop / SOS with honest delivery states (Sending / Delivered N of M / Acknowledged / Failed / queued) | Implemented, needs device testing |
| Announcement engine: priority queue, native Android TextToSpeech (transient audio focus ducks other apps), music ducking, holds for PTT | Queue unit tested; TTS / ducking need device |
| GPS sharing with interval setting, battery level, freshness labels | Implemented, needs device testing |
| Group map (MapLibre + OSM raster, route polyline, live vs last-known markers, spread) | Implemented, needs device testing |
| Place search (Nominatim) and route (OSRM demo) | Implemented — public free services with fair-use limits |
| Local music: MediaStore scan, content fingerprint, playlists, synced playback with drift correction | Sync math unit tested; playback needs device |
| Spotify via Web API + PKCE, Premium / no-device detection | Implemented, needs a Spotify app + Premium account |
| LiveKit online voice, PTT, open mic, mute, active speakers, admin-only mode | Implemented, needs device + LiveKit server |
| Helmet detection, routing to HFP/LE device, speaker + mic tests | Implemented, needs device + headset |
| Offline music authority on the hub | Implemented, needs device testing |
| QR scan (vision-camera v4) / QR display | Implemented, needs device |
| iOS build | Not yet supported — JS is cross-platform but native modules (Nearby, audio routing) are Android-only; iOS pods were not installed |

## Android native (Kotlin)

| Feature | Status |
|---|---|
| Nearby Connections P2P_STAR: hub advertises, members discover, reconnect on loss | Implemented, **needs 2-device test** |
| Peer authentication: HMAC(ride key, nonce, ride, user, Nearby auth digits); unauthenticated payloads dropped | Implemented, needs device test |
| Hub relay of events and voice to all members | Implemented, needs 3–5 device test |
| Offline voice: 8 kHz G.711 μ-law, 60 ms packets, per-talker jitter buffer, mixer | **Proof of concept**, needs latency/quality measurement |
| Audio device listing, communication-device routing, device-change events | Implemented, needs headset test |
| Ride foreground service (location / mic / connected-device types) | Implemented, needs device test (OEM battery killers) |
| Hub election when the admin is absent | Not yet supported — admin phone is the hub; co-admin fallback is designed (ARCHITECTURE §3.2) |
| Multi-hop relay beyond hub range | Not yet supported — by design for v1 |
| Opus codec for offline voice | Not yet supported — μ-law is used; header has a codec byte for the upgrade |

## Simulated for development

* Password-reset token returned in the API response when `RW_EXPOSE_RESET_TOKEN=true` (no e-mail provider). Production config refuses this flag.
* LiveKit `--dev` keys (`devkey` / `secret`). Production config refuses the default secret.

Nothing in the app fabricates riders, locations, connection states or delivery confirmations.

## Build verification still to do on your machine

1. ~~First native compile~~ — done 2026-10-31. Fixes needed: replaced unmaintained `react-native-tts` (uses removed `jcenter()`)
   with native TTS in `RideWaveAudioModule`; patched two Kotlin nullability errors in `react-native-track-player` 4.1.2
   (`patches/`, applied by `postinstall`); removed unused `@notifee/react-native`; minSdk raised 24 → 26.
2. ~~First install on a phone~~ — done 2026-10-31. Further fixes: patched 37 `react-native-track-player` methods to return
   `Unit` (new-arch interop rejects non-void async methods); `MainActivity.onCreate(null)` (react-native-screens crash when
   Android recreates the activity after a permission change); bottom safe-area inset on all screens (edge-to-edge nav bar
   covered buttons). Xiaomi phones also need Developer options → **Install via USB** (Mi account) to install over adb.
3. `DEVICE_TESTING.md` sections 1–4 on two Android phones, then 3–5 phones.
