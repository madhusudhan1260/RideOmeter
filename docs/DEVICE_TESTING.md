# RideWave — Device testing checklist

Nothing in the "needs device testing" column of `STATUS.md` is considered working until it passes here.
Record device model, Android version and result for each line.

**Setup**: laptop running the backend (`uvicorn … --host 0.0.0.0 --port 8030`) and `livekit-server --dev --bind 0.0.0.0`;
phones on the same Wi-Fi; in the app set Server to `http://<laptop-LAN-IP>:8030`.

## 0. Build
- [ ] `npm run android` builds and installs (record any library that needs a version pin)
- [ ] App opens to Welcome; Permissions screen shows real grant state for each permission

## 1. Two phones, online (A = admin, B = member)
- [ ] Register on both, A creates ride, B joins by **QR scan**, by **typed code** and by **ridewave://join link**
- [ ] Team screen on both shows the other as *Online*; killing B's app flips it to *Offline* on A within ~30 s
- [ ] A starts the ride; B hears "Ride started"
- [ ] Location: both appear on the map as LIVE; turn off B's GPS → B becomes *Last known* after 60 s (never LIVE)
- [ ] B taps **Petrol** → A sees banner + hears "Petrol stop requested by B" → A acknowledges → B sees status change
- [ ] B taps Petrol again → "already open" (no duplicate)
- [ ] B holds **SOS** 1.2 s → A hears the emergency at top priority; B shows *Delivered to 1 of 1*; A acknowledges → B shows *Acknowledged*
- [ ] Admin announcement typed on A is spoken on B

## 2. Voice (online, LiveKit)
- [ ] Both join voice; PTT on A is heard on B; speaking indicator lights on B
- [ ] Open mic mode; mute; admin-only mode (B becomes listen-only without rejoining)
- [ ] Measure mouth-to-ear latency (clap test, record with a third phone): target < 400 ms
- [ ] Kill Wi-Fi on B for 10 s and restore → voice reconnects

## 3. Helmet headsets (test at least two brands, e.g. Sena and Cardo, plus a generic BT headset)
- [ ] Paired helmet appears as *Connected*; shows whether a mic (HFP) profile is reported
- [ ] Speaker test tone heard in helmet; mic test passes with speech and fails in silence
- [ ] Intercom audio and TTS come through the helmet, not the phone speaker
- [ ] Music quality drop while mic is open is noted (HFP) and restored after
- [ ] Turn helmet off mid-ride → "Helmet disconnected" announced, no phone-speaker blast (fallback off); turn on → re-routed
- [ ] Helmet that supports two phones vs. one phone: document behaviour

## 4. Offline mesh (two phones, then 3–5)
- [ ] With internet on, both phones show *Online · 1 nearby* (mesh up in background)
- [ ] Airplane mode + Bluetooth/Wi-Fi on: state goes *No internet → Searching nearby → Offline mesh · 1 rider*
- [ ] A phone from **another** ride (or without the key) is rejected (check `adb logcat -s RideWaveNearby`)
- [ ] Offline stop request and SOS arrive on the other phone with TTS; delivery shows *Delivered to 1 of 1*
- [ ] Offline location: positions update via *nearby mesh*
- [ ] Offline PTT voice: audible; measure latency; note quality
- [ ] Walk apart until link drops: record distance (line of sight / between bikes); reconnect on return
- [ ] Re-enable internet: *Syncing… → Online*, outbox count goes to 0, server shows the offline stop/SOS
- [ ] 3 phones: hub relays events and voice from member 1 to member 2
- [ ] 5 phones: record hub CPU, battery drain per hour, any dropped peers

## 5. Music
- [ ] Local: all phones scan the same MP3; admin queues it; playback starts together (measure offset by ear/recording, target < 250 ms)
- [ ] One phone without the file shows *Not synced — file missing*
- [ ] Pause / next / previous on admin propagate; drift after 10 min < 250 ms
- [ ] TTS announcement ducks music and restores it
- [ ] Spotify: Premium account plays the shared track; Free account shows *Premium required*; no Spotify app shows *open Spotify first*
- [ ] Offline (hub authority): admin pause/play over the mesh reaches members

## 6. Background & battery
- [ ] Screen off 20 min with ride active: location keeps updating, ride notification visible
- [ ] Samsung / Xiaomi / OnePlus: check battery-optimisation behaviour; record if the service is killed
- [ ] Battery drain per hour: online only / online + mesh / offline mesh + voice

## 7. Security spot checks
- [ ] Removed rider is kicked from the WebSocket and cannot rejoin with the code
- [ ] A user not in the ride gets 404 for its locations
- [ ] Refresh-token reuse signs the user out
