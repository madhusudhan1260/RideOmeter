# RideWave — Architecture

RideWave is a group-riding companion: ride management, intercom, synced music, live map,
stop requests and SOS, with an online path (FastAPI + WebSocket + LiveKit) and an offline
path (Android Nearby Connections). This document is the Phase 1 output: the analysis,
the hard problems, and the decisions taken. `docs/STATUS.md` tracks what is actually built.

---

## 1. Requirement analysis — what is hard

| Area | Difficulty | Why |
|---|---|---|
| Offline group voice | **Very high** | No internet, no server, moving vehicles, radio range of tens of metres, Android background limits. No off-the-shelf library does this. |
| Bluetooth helmet audio | High | The OS owns pairing and routing. Helmets differ in HFP/A2DP support; opening the mic forces the helmet from A2DP (stereo) to HFP (mono voice-band). |
| Synced Spotify playback | High (policy) | Audio cannot be relayed. Each rider needs their own Spotify (Premium for on-demand control). Sync is "every phone plays the same URI at the same position", never "one phone streams to the rest". |
| Offline music sync | Medium | Needs a shared clock and identical files (verified by content hash). |
| Online/offline handover | Medium-high | Two transports live at once; must not tear down the local mesh when internet returns; events must dedupe across both. |
| Emergency delivery truthfulness | Medium | Must track per-recipient delivery and acks rather than "sent = delivered". |
| Live map honesty | Low-medium | Every fix carries a timestamp; UI derives LIVE / STALE / UNAVAILABLE from age, never from presence. |

---

## 2. System overview

```
┌──────────────────────────── Mobile (React Native, TS, bare workflow) ─────────────────────────────┐
│ Screens ─ Zustand stores ─ TanStack Query                                                         │
│                     │                                                                             │
│            ┌────────┴──────────────────── Domain services (UI-independent) ───────────┐            │
│            │ ConnectionManager (state machine)   EventBus (dedupe by event_id)        │            │
│            │ MusicSyncService   AnnouncementEngine (TTS + ducking + priority queue)    │            │
│            │ LocationService    StopService / EmergencyService   OfflineQueue (SQLite)│            │
│            └───────┬───────────────────────┬───────────────────────────┬──────────────┘            │
│        OnlineTransport               OfflineTransport             AudioRouting                     │
│        (REST + WS + LiveKit)         (RideWaveNearby native)      (RideWaveAudio native)           │
└────────────┬─────────────────────────────────┬───────────────────────────┬──────────────────────────┘
             │ HTTPS / WSS                      │ BLE + BT + Wi-Fi (Nearby)  │ HFP / A2DP / SCO
┌────────────┴───────────────┐        nearby phones (same ride)        helmet headset
│ FastAPI (Python 3.12+)      │
│  REST /api/*  WS /ws/rides  │──── LiveKit server (self-hosted, WebRTC SFU) ◀── riders' audio
│  SQLAlchemy 2 + Alembic     │
│  Postgres (prod)/SQLite(dev)│
│  Redis pub/sub (optional)   │
└─────────────────────────────┘
```

Two independent transports feed one **EventBus**. Every event has a UUID `event_id`; the bus
drops duplicates, so an SOS that arrives over both Nearby and WebSocket is processed once.

---

## 3. How offline group voice actually works

### 3.1 Technology choice

| Option | Verdict |
|---|---|
| WebRTC alone | Needs signalling and ICE. Possible on a shared Wi-Fi LAN, but nothing provides that LAN on a highway. **Not an offline answer by itself.** |
| Classic Bluetooth / BLE GATT | BLE throughput (≈ 50–200 kbps practical) is enough for one Opus stream, but piconet limits (~7) and the helmet already occupies the phone's BT audio link. Used only as the Nearby discovery medium. |
| Wi-Fi Direct (raw `WifiP2pManager`) | Good bandwidth, but one group owner; the system shows connection dialogs, behaviour varies by OEM, and a phone usually cannot be in a Wi-Fi Direct group and on mobile data hotspot at once. |
| **Google Nearby Connections** | Wraps BLE/BT discovery and upgrades to Wi-Fi Direct / hotspot / LAN automatically, handles auth tokens, reconnects, and has a `BYTES` payload with low overhead. **Chosen.** Requires Google Play Services (Android only). |

### 3.2 Topology: leader-based star

Nearby offers `P2P_CLUSTER` (M-to-N, Bluetooth-bandwidth only) and `P2P_STAR` (1-to-N, may
upgrade to Wi-Fi). Voice needs bandwidth, so RideWave uses **`P2P_STAR` with a hub**:

```
          rider B
             │
rider C ── HUB (admin or elected) ── rider D
             │
          rider E
```

* The **hub advertises**, members **discover** and request a connection.
* Hub election: admin first; if admin is not reachable, co-admin; else lowest user id among
  reachable peers. Re-election on hub loss (members fall back to discovery).
* **Voice**: each talker encodes 16 kHz mono **Opus at 24 kbps, 20 ms frames** and sends 3 frames
  (60 ms) per `BYTES` payload (~200 bytes) to the hub. The hub **forwards** packets to all other
  members (no server-side mixing in v1 — each receiver runs a small jitter buffer per talker and
  mixes locally; push-to-talk keeps concurrent talkers low).
* **Data events** (stops, SOS, location, music commands) use the same links as JSON `BYTES`
  payloads with a 1-byte type prefix (`0x01` event, `0x02` voice, `0x03` ack, `0x04` clock-ping).
* Members out of hub range but in range of another member: **not relayed in v1**. A 2-hop relay
  (member re-advertises as a sub-hub) is designed but deferred until 3–5 device testing passes.

### 3.3 Authentication of peers

* Nearby endpoint name = `RW1|<ride_short_id>|<user_id>`.
* On `onConnectionInitiated` both sides exchange a challenge: `HMAC-SHA256(ride_offline_key,
  nonce || authDigits)`. `ride_offline_key` is a 32-byte secret issued by the backend to each
  *approved participant* when they join (stored in the device keystore). A phone without the key
  cannot complete the handshake and is rejected; endpoints from other rides are ignored.

### 3.4 Realistic limits (document, don't hide)

* **Range**: Bluetooth discovery ~10–30 m; Wi-Fi upgraded links ~50–100 m line-of-sight, far less
  between moving bikes with bodies/helmets in the way. Riders spread out further than this
  constantly. Offline voice is a *close-formation / stop-point* feature, not a highway intercom.
* **Participants**: tested target is 2 → 5 devices. Hub CPU and Wi-Fi hotspot client limits
  (often 4–8) cap the star. We do not promise more.
* **Latency**: expect 150–400 ms mouth-to-ear over the hub. Fine for PTT, poor for open-mic duplex.
* **Battery**: advertising + discovery + Wi-Fi upgrade + mic is heavy; discovery stops once the
  ride's peers are connected and resumes on loss.
* **Background**: Android 14+ requires a foreground service with
  `foregroundServiceType="microphone|connectedDevice|location"` and a visible notification.
  OEM battery killers (Xiaomi, Oppo, Samsung) may still kill it; the app prompts for
  battery-optimisation exemption.
* **iOS**: Nearby Connections is Android-only for this use. iOS ↔ Android offline is **not
  supported**. iOS offline (MultipeerConnectivity, iOS-only) is listed as future work.
* **Helmet mesh**: many helmets (Sena Mesh, Cardo DMC) already have their own intercom. RideWave
  doesn't replace it; it coexists by using the phone↔helmet HFP link.

---

## 4. Bluetooth helmet headsets — limitations and approach

* The app **cannot pair** a helmet; pairing is done in Android settings. The app detects *connected*
  audio devices (`AudioManager.getDevices`, `TYPE_BLUETOOTH_SCO`, `TYPE_BLUETOOTH_A2DP`, `TYPE_BLE_HEADSET`)
  and listens to `AudioDeviceCallback` for connect/disconnect.
* **A2DP** = music only (no mic). **HFP/SCO** = mic + mono 8/16 kHz. When intercom opens the mic,
  the helmet switches to HFP and music quality drops; this is a profile limitation, not a bug.
  LE Audio (Android 13+, few helmets) removes it where available.
* Routing: Android 12+ `setCommunicationDevice()`; older versions `startBluetoothSco()`.
* Recovery: on disconnect we notify, fall back to phone speaker *only if the rider enabled it*
  (silent fallback on a bike is dangerous), and re-route when the device returns.
* Tests: "speaker test" plays a tone through the selected route; "mic test" records 3 s and plays
  it back with a level meter. Results are shown only from actual measurements.

---

## 5. Music

* **Local mode**: tracks are files on the phone; each is identified by `sha256(first 1 MB + size)`.
  Before group play the admin's track id is broadcast; each rider reports `HAVE`/`MISSING`.
  Riders missing the file are shown "Not synced — file missing", never faked.
* **Spotify mode**: OAuth (PKCE) per rider. Admin shares a track/playlist URI; each rider's own
  Spotify app is commanded via the Spotify Android App Remote SDK (or Web API `PUT /me/player/play`).
  Requires Premium per rider for on-demand. Free accounts → "Spotify Premium required" state.
  Spotify development-mode apps are limited to allow-listed users; a quota extension is needed for
  public release.
* **Sync protocol**: commands carry `{track_id, position_ms, start_at_server_ms}`. Each phone keeps a
  clock offset from NTP-style pings (WS online, Nearby clock-ping offline, the hub is the clock).
  Phone seeks to `position_ms + (now_server - start_at_server_ms)`; drift > 250 ms → corrective seek.
* **Ducking**: AnnouncementEngine lowers music to 20% for TTS/voice and restores after.

---

## 6. Connection manager state machine

```
          ┌────────── internet ok ───────────┐
          ▼                                  │
       ONLINE ──internet lost──▶ INTERNET_LOST ──▶ DISCOVERING_NEARBY ──peer auth ok──▶ LOCAL_CONNECTION_ESTABLISHED
          ▲                                               │ (no peers, retry w/ backoff)        │
          │                                               ▼                                      ▼
       SYNCING ◀──── INTERNET_RESTORED ◀──────────── OFFLINE_MODE ◀─────────────────────────────┘
```

* Nearby links are kept alive in ONLINE too (when enabled) — they're cheap insurance for SOS.
* "Internet ok" = backend `/api/health` reachable **and** WS open, not just OS connectivity.
* SYNCING uploads the SQLite outbox to `POST /api/sync/events` (idempotent on `event_id`); the server
  validates role and ride membership for each event and returns per-event `accepted/duplicate/rejected`.

---

## 7. Event model

```json
{
  "event_id": "uuid4",
  "event_type": "STOP_REQUESTED",
  "ride_id": "uuid",
  "sender_id": "uuid",
  "timestamp": "2026-10-30T10:15:00.123Z",
  "payload": { ... },
  "delivery_status": "SENDING|DELIVERED|ACKNOWLEDGED|FAILED",
  "transport": "ws|nearby"
}
```

Types: `RIDER_JOINED, RIDER_LEFT, RIDE_STARTED, RIDE_ENDED, MUSIC_PLAY, MUSIC_PAUSE, MUSIC_NEXT,
MUSIC_PREV, STOP_REQUESTED, STOP_ACKNOWLEDGED, STOP_UPDATED, EMERGENCY_CREATED, EMERGENCY_ACKNOWLEDGED,
LOCATION_UPDATED, RIDER_DISCONNECTED, RIDER_RECONNECTED, ADMIN_ANNOUNCEMENT, PRESENCE, DELIVERY_ACK`.

Admin-only types (`RIDE_*`, `MUSIC_*`, `ADMIN_ANNOUNCEMENT`, `STOP_ACKNOWLEDGED`) are enforced
server-side for WS and on sync; offline, receivers check the sender's role from the cached
participant list signed into the ride snapshot.

Emergency delivery: each receiver sends `DELIVERY_ACK{event_id}`; the sender shows
`Delivered to 3 of 5` and only `ACKNOWLEDGED` when admin (or any rider) taps Acknowledge.

---

## 8. Database (normalized)

`users, user_profiles, motorcycles, rides, ride_participants, ride_invitations, devices,
helmet_devices, music_sessions, music_events, stop_requests, emergency_requests,
location_updates, notifications, communication_sessions, audit_logs, offline_sync_events,
refresh_tokens, password_reset_tokens`.

See `backend/app/models/` for columns, enums, FKs, indexes and constraints. Highlights:

* `ride_participants (ride_id, user_id)` unique; `role` enum ADMIN/CO_ADMIN/MEMBER; `status` enum.
* `rides.join_code` unique, 8 chars from an unambiguous alphabet; `offline_key` never returned except
  to approved participants via `/rides/{id}/offline-credentials`.
* `stop_requests` partial-uniqueness enforced in the service: one *open* request per (ride, rider, type);
  `expires_at` default 10 min.
* `location_updates` indexed `(ride_id, user_id, recorded_at desc)`; retained 7 days.
* `offline_sync_events.event_id` unique → idempotent sync.
* `refresh_tokens` store a SHA-256 hash, `family_id` for rotation reuse detection.

---

## 9. API surface

All under `/api`, JSON, Bearer access token (15 min) + rotating refresh token (30 days).
Full list with schemas lives in `docs/API.md` and the live OpenAPI at `/docs`.

---

## 10. Mobile navigation

```
RootStack
├── Onboarding (Welcome → Permissions → Device setup)      [unauthenticated]
├── Auth (Login, Register, Forgot, Reset)                  [unauthenticated]
└── Main (bottom tabs)
    ├── HOME     → Home
    ├── RIDES    → RideList → CreateRide → RideDetail/Invite(QR) → JoinRide(code/QR)
    ├── INTERCOM → Intercom
    ├── MUSIC    → MusicPlayer
    └── PROFILE  → Profile → EditProfile / Helmet / Settings
  Modals (from anywhere): ActiveRide dashboard, Team, GroupMap, Emergency, StopRequest sheet
  Global overlays: ConnectionPill (top), SOS floating button (during a ride), Alert banner
```

---

## 11. UI/UX direction — "Instrument Cluster"

* **Surfaces**: `#0B0C0E` base, `#141518` matte panels, 1 px `#24262B` hairline borders, no drop
  shadows. Panels are edge-aligned *bezels*, not floating cards.
* **Accent**: electric amber `#FF8A00` → `#FFB347` used sparingly for live state, the PTT ring and
  primary actions. Red `#FF3B30` reserved for SOS/breakdown only. Green `#30D158` = live/connected.
* **Type**: `Rajdhani`-style condensed display for numerals and labels (gauge feel), `Inter` for body.
  Minimum 15 pt body, 13 pt captions in caps with tracking. Numbers use tabular figures.
* **Signature elements**: tachometer-style arc for rider count / signal, segmented status LEDs,
  a 200 pt PTT "throttle" button with a pressure ring, tick-mark progress bars.
* **Glove-friendly**: 64 pt minimum targets on ride screens, 2-tap max for stop/SOS, long-press
  (1.2 s) to confirm SOS to avoid pocket triggers.
* **Night / high-contrast mode**: pure black background, amber turns to `#FFC24D`, borders brighten,
  all secondary text raised to 80% white.

---

## 12. Roadmap

| Phase | Deliverable | State |
|---|---|---|
| 1 | Architecture, schema, contracts | done (this doc) |
| 2 | Design system + all screens | see STATUS |
| 3 | FastAPI backend, auth, rides, WS | see STATUS |
| 4 | Mobile ↔ backend integration | see STATUS |
| 5 | Local music + sync + ducking; Spotify | see STATUS |
| 6 | LiveKit voice, PTT, headset routing, Nearby PoC | see STATUS |
| 7 | Maps, location, stops, SOS, TTS | see STATUS |
| 8 | Offline queue, P2P messaging, sync | see STATUS |
| 9 | Device testing (`docs/DEVICE_TESTING.md`) | requires hardware |
