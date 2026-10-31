// Mirrors backend/app/schemas. Keep in sync with /openapi.json.

export type Role = 'ADMIN' | 'CO_ADMIN' | 'MEMBER';
export type ParticipantStatus = 'PENDING' | 'ACTIVE' | 'LEFT' | 'REMOVED';
export type RideStatus = 'PLANNED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
export type VoiceMode = 'OPEN_MIC' | 'PUSH_TO_TALK' | 'ADMIN_ONLY';
export type StopType = 'PETROL' | 'FOOD' | 'TEA_COFFEE' | 'RESTROOM' | 'REST' | 'BREAKDOWN' | 'EMERGENCY' | 'CUSTOM';
export type StopStatus = 'OPEN' | 'ACKNOWLEDGED' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'EXPIRED';
export type EmergencyType = 'SOS' | 'ACCIDENT' | 'BREAKDOWN' | 'ASSISTANCE';
export type EmergencyStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
export type MusicSource = 'LOCAL' | 'SPOTIFY';

export type TokenPair = { access_token: string; refresh_token: string; token_type: string; expires_in: number };

export type Motorcycle = { id: string; make: string; model: string; year: number | null; color: string | null; plate: string | null; is_primary: boolean };

export type Profile = {
  display_name: string;
  phone: string | null;
  avatar_url: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  blood_group: string | null;
  preferred_helmet_id: string | null;
  notification_prefs: Record<string, boolean>;
  audio_prefs: Record<string, number | boolean | string>;
};

export type Me = { id: string; email: string; username: string; created_at: string; profile: Profile; motorcycles: Motorcycle[] };

export type MeUpdate = Partial<Omit<Profile, 'avatar_url'>> & {
  motorcycle?: { make: string; model: string; year?: number | null; color?: string | null; plate?: string | null };
};

export type Participant = {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  motorcycle: string | null;
  role: Role;
  status: ParticipantStatus;
  location_sharing: boolean;
  joined_at: string;
  online: boolean;
};

export type Ride = {
  id: string;
  name: string;
  description: string | null;
  start_name: string;
  start_lat: number | null;
  start_lng: number | null;
  dest_name: string;
  dest_lat: number | null;
  dest_lng: number | null;
  route_polyline: string | null;
  scheduled_at: string;
  status: RideStatus;
  visibility: 'PUBLIC' | 'PRIVATE';
  max_participants: number;
  requires_approval: boolean;
  voice_mode: VoiceMode;
  music_enabled: boolean;
  created_by: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  my_role: Role | null;
  my_status: ParticipantStatus | null;
  participant_count: number;
  join_code: string | null;
  participants?: Participant[];
  invite_link?: string | null;
};

export type Place = { name: string; lat?: number | null; lng?: number | null };

export type RideCreate = {
  name: string;
  description?: string;
  start: Place;
  destination: Place;
  scheduled_at: string;
  max_participants: number;
  visibility: 'PUBLIC' | 'PRIVATE';
  requires_approval: boolean;
  voice_mode: VoiceMode;
  route_polyline?: string;
};

export type Stop = {
  id: string;
  ride_id: string;
  requester_id: string;
  requester_name: string;
  type: StopType;
  note: string | null;
  status: StopStatus;
  lat: number | null;
  lng: number | null;
  created_at: string;
  expires_at: string;
  handled_by: string | null;
  handled_at: string | null;
  announcement: string;
};

export type Emergency = {
  id: string;
  ride_id: string;
  reporter_id: string;
  reporter_name: string;
  type: EmergencyType;
  status: EmergencyStatus;
  message: string | null;
  lat: number | null;
  lng: number | null;
  location_recorded_at: string | null;
  created_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  recipients: number;
  delivered: number;
  emergency_contact: { name: string | null; phone: string | null; blood_group: string | null };
  announcement: string;
};

export type RiderLocation = {
  user_id: string;
  display_name: string;
  role: Role;
  freshness: 'LIVE' | 'STALE' | 'UNAVAILABLE';
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading: number | null;
  battery_pct: number | null;
  recorded_at: string | null;
  age_seconds: number | null;
  sharing: boolean;
};

export type Track = {
  source: MusicSource;
  ref: string;
  title: string;
  artist?: string | null;
  album?: string | null;
  artwork_url?: string | null;
  duration_ms: number;
};

export type MusicStatus = {
  ride_id: string;
  enabled: boolean;
  source: MusicSource;
  state: 'PLAYING' | 'PAUSED' | 'STOPPED';
  queue: Track[];
  queue_index: number;
  current: Track | null;
  position_ms: number;
  anchor_at: string;
  server_time: string;
  version: number;
};

export type VoiceToken = { url: string; token: string; room: string; voice_mode: VoiceMode; can_publish: boolean; push_to_talk: boolean };

export type OfflineCredentials = { ride_id: string; short_id: string; offline_key: string; participants: Participant[]; issued_at: string };

export type Invitation = { id: string; token: string; link: string; expires_at: string | null; max_uses: number | null; uses: number };

export type Helmet = {
  id: string;
  name: string;
  supports_hfp: boolean | null;
  supports_a2dp: boolean | null;
  supports_le_audio: boolean | null;
  last_mic_test_ok: boolean | null;
  last_speaker_test_ok: boolean | null;
  last_connected_at: string | null;
};

export type AppNotification = {
  id: string;
  ride_id: string | null;
  type: string;
  title: string;
  body: string;
  ref_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
};
