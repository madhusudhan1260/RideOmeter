# RideOmeter API reference

Generated from the FastAPI OpenAPI schema. Live, interactive docs: `http://<server>:8030/docs`.

All endpoints are JSON. Authenticated endpoints need `Authorization: Bearer <access_token>`.
Errors: `{"detail": "..."}` (422 adds `errors[]`; 409 on duplicate stop adds `stop_id`).

## Auth

| Method | Path | Summary | Body | Response |
|---|---|---|---|---|
| POST | `/api/auth/register` | Register | RegisterRequest | 201 TokenPair |
| POST | `/api/auth/login` | Login | LoginRequest | 200 TokenPair |
| POST | `/api/auth/refresh` | Refresh | RefreshRequest | 200 TokenPair |
| POST | `/api/auth/logout` | Logout | LogoutRequest | 200 Message |
| POST | `/api/auth/forgot-password` | Forgot Password | ForgotPasswordRequest | 200 ForgotPasswordResponse |
| POST | `/api/auth/reset-password` | Reset Password | ResetPasswordRequest | 200 Message |

## Users

| Method | Path | Summary | Body | Response |
|---|---|---|---|---|
| GET | `/api/users/me` | Me |  | 200 MeOut |
| PUT | `/api/users/me` | Update Me | MeUpdate | 200 MeOut |
| POST | `/api/users/me/avatar` | Upload Avatar | Body_upload_avatar_api_users_me_avatar_post | 200 MeOut |
| GET | `/api/users/{user_id}` | Get User |  | 200 PublicUserOut |

## Rides

| Method | Path | Summary | Body | Response |
|---|---|---|---|---|
| POST | `/api/rides` | Create Ride | RideCreate | 201 RideDetail |
| GET | `/api/rides` | List Rides |  | 200 list[RideSummary] |
| POST | `/api/rides/join` | Join By Code | JoinRequest | 200 RideDetail |
| GET | `/api/rides/{ride_id}` | Get Ride |  | 200  |
| PATCH | `/api/rides/{ride_id}` | Update Ride | RideUpdate | 200 RideDetail |
| POST | `/api/rides/{ride_id}/join` | Join | JoinRequest | 200  |
| POST | `/api/rides/{ride_id}/leave` | Leave |  | 200 Message |
| POST | `/api/rides/{ride_id}/start` | Start |  | 200 RideDetail |
| POST | `/api/rides/{ride_id}/end` | End |  | 200 RideDetail |
| DELETE | `/api/rides/{ride_id}/participants/{user_id}` | Remove Participant |  | 200 Message |
| POST | `/api/rides/{ride_id}/participants/{user_id}/approve` | Approve |  | 200 Message |
| PUT | `/api/rides/{ride_id}/participants/{user_id}/role` | Set Role | RoleUpdate | 200 Message |
| PUT | `/api/rides/{ride_id}/location-sharing` | Location Sharing | LocationSharingUpdate | 200 Message |
| POST | `/api/rides/{ride_id}/join-code` | Regenerate Code |  | 200 RideDetail |
| POST | `/api/rides/{ride_id}/invitations` | Create Invitation | InvitationCreate | 201 InvitationOut |
| GET | `/api/rides/{ride_id}/qr.svg` | Invite Qr |  | 200  |
| GET | `/api/rides/{ride_id}/offline-credentials` | Offline Credentials |  | 200 OfflineCredentials |

## Music

| Method | Path | Summary | Body | Response |
|---|---|---|---|---|
| GET | `/api/rides/{ride_id}/music/status` | Music Status |  | 200 MusicStatus |
| PUT | `/api/rides/{ride_id}/music/queue` | Set Queue | QueueUpdate | 200 MusicStatus |
| POST | `/api/rides/{ride_id}/music/play` | Play | application/json | 200 MusicStatus |
| POST | `/api/rides/{ride_id}/music/pause` | Pause | application/json | 200 MusicStatus |
| POST | `/api/rides/{ride_id}/music/next` | Next Track |  | 200 MusicStatus |
| POST | `/api/rides/{ride_id}/music/previous` | Previous Track |  | 200 MusicStatus |
| PUT | `/api/rides/{ride_id}/music/enabled` | Set Enabled | EnableRequest | 200 MusicStatus |

## Safety

| Method | Path | Summary | Body | Response |
|---|---|---|---|---|
| POST | `/api/rides/{ride_id}/stops` | Create Stop | StopCreate | 201 StopOut |
| GET | `/api/rides/{ride_id}/stops` | List Stops |  | 200 list[StopOut] |
| POST | `/api/stops/{stop_id}/acknowledge` | Stop Acknowledge |  | 200 StopOut |
| POST | `/api/stops/{stop_id}/approve` | Stop Approve |  | 200 StopOut |
| POST | `/api/stops/{stop_id}/reject` | Stop Reject |  | 200 StopOut |
| POST | `/api/stops/{stop_id}/complete` | Stop Complete |  | 200 StopOut |
| POST | `/api/rides/{ride_id}/emergency` | Create Emergency | EmergencyCreate | 201 EmergencyOut |
| GET | `/api/rides/{ride_id}/emergency` | List Emergencies |  | 200 list[EmergencyOut] |
| POST | `/api/emergency/{emergency_id}/acknowledge` | Acknowledge Emergency |  | 200 EmergencyOut |
| POST | `/api/emergency/{emergency_id}/resolve` | Resolve Emergency |  | 200 EmergencyOut |
| POST | `/api/rides/{ride_id}/locations` | Post Location | LocationIn | 201 Message |
| GET | `/api/rides/{ride_id}/locations` | Get Locations |  | 200 list[RiderLocation] |
| POST | `/api/rides/{ride_id}/announcements` | Announce | AnnouncementCreate | 201 Message |

## Communication

| Method | Path | Summary | Body | Response |
|---|---|---|---|---|
| POST | `/api/rides/{ride_id}/voice/token` | Voice Token |  | 200 VoiceToken |
| PUT | `/api/rides/{ride_id}/voice/mode` | Set Voice Mode | VoiceModeUpdate | 200  |
| POST | `/api/sync/events` | Sync Events | SyncBatch | 200 SyncBatchResult |

## Devices

| Method | Path | Summary | Body | Response |
|---|---|---|---|---|
| POST | `/api/devices/register` | Register Device | DeviceRegister | 201 DeviceOut |
| GET | `/api/devices` | List Devices |  | 200 list[DeviceOut] |
| DELETE | `/api/devices/{device_id}` | Delete Device |  | 200 Message |
| GET | `/api/devices/helmets` | List Helmets |  | 200 list[HelmetOut] |
| POST | `/api/devices/helmets` | Upsert Helmet | HelmetIn | 200 HelmetOut |
| DELETE | `/api/devices/helmets/{helmet_id}` | Delete Helmet |  | 200 Message |
| GET | `/api/notifications` | List Notifications |  | 200 list[NotificationOut] |
| POST | `/api/notifications/read-all` | Read All |  | 200 Message |

## System

| Method | Path | Summary | Body | Response |
|---|---|---|---|---|
| GET | `/api/health` | Health |  | 200  |

## WebSocket — `/ws/rides/{ride_id}`

1. Connect, then send within 5 s: `{"type": "auth", "token": "<access token>"}` (tokens are not put in URLs).
2. Server replies `PRESENCE` (`payload.online` = user ids), then streams events:

```json
{ "event_id": "uuid", "event_type": "STOP_REQUESTED", "ride_id": "uuid", "sender_id": "uuid",
  "timestamp": "2026-10-30T10:15:00.123Z", "payload": {}, "delivery_status": "SENDING", "transport": "ws" }
```

Client → server: `CLOCK_PING {client_time}`, `LOCATION_UPDATED {lat,lng,recorded_at,...}`,
`STOP_REQUESTED {type,note?,lat?,lng?}`, `EMERGENCY_CREATED {type,...}`, `DELIVERY_ACK {ref_id}`,
`ADMIN_ANNOUNCEMENT {text}` (admin only). If `event_id` is set the server answers `DELIVERY_ACK {ref_event_id}`
or `ERROR {ref_event_id, detail}`.

Close codes: 4401 unauthenticated · 4404 not a participant · 4403 removed/left · 4429 flooding.

## Offline sync — `POST /api/sync/events`

Body `{"events": [SyncEventIn...]}` (max 500). Each result is `ACCEPTED`, `DUPLICATE` (same `event_id` seen) or
`REJECTED` with a reason. A device may only upload events it authored; every event is re-validated with the same
role checks as the live API. Accepted types: STOP_REQUESTED, STOP_ACKNOWLEDGED, STOP_UPDATED, EMERGENCY_CREATED,
EMERGENCY_ACKNOWLEDGED, LOCATION_UPDATED, ADMIN_ANNOUNCEMENT.

