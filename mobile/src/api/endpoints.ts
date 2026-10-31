import { api } from './client';
import type {
  AppNotification,
  Emergency,
  EmergencyType,
  Helmet,
  Invitation,
  Me,
  MeUpdate,
  MusicStatus,
  OfflineCredentials,
  Ride,
  RideCreate,
  RiderLocation,
  Stop,
  StopType,
  TokenPair,
  Track,
  VoiceMode,
  VoiceToken,
} from './types';

export const Auth = {
  register: (b: { email: string; username: string; password: string; display_name: string }) =>
    api.post<TokenPair>('/api/auth/register', b, { auth: false }),
  login: (identifier: string, password: string) => api.post<TokenPair>('/api/auth/login', { identifier, password }, { auth: false }),
  refresh: (refresh_token: string) => api.post<TokenPair>('/api/auth/refresh', { refresh_token }, { auth: false }),
  logout: (refresh_token: string) => api.post('/api/auth/logout', { refresh_token }),
  forgot: (email: string) =>
    api.post<{ detail: string; dev_reset_token: string | null }>('/api/auth/forgot-password', { email }, { auth: false }),
  reset: (token: string, new_password: string) => api.post('/api/auth/reset-password', { token, new_password }, { auth: false }),
};

export const Users = {
  me: () => api.get<Me>('/api/users/me'),
  update: (b: MeUpdate) => api.put<Me>('/api/users/me', b),
  avatar: (uri: string, type: string) => {
    const form = new FormData();
    form.append('file', { uri, type, name: type.includes('png') ? 'avatar.png' : 'avatar.jpg' } as any);
    return api.post<Me>('/api/users/me/avatar', undefined, { form });
  },
};

export const Rides = {
  list: (scope: 'all' | 'upcoming' | 'recent' | 'active' | 'public') => api.get<Ride[]>(`/api/rides?scope=${scope}`),
  get: (id: string) => api.get<Ride>(`/api/rides/${id}`),
  create: (b: RideCreate) => api.post<Ride>('/api/rides', b),
  joinByCode: (code: string) => api.post<Ride>('/api/rides/join', { code }),
  leave: (id: string) => api.post(`/api/rides/${id}/leave`),
  start: (id: string) => api.post<Ride>(`/api/rides/${id}/start`),
  end: (id: string) => api.post<Ride>(`/api/rides/${id}/end`),
  remove: (id: string, userId: string) => api.del(`/api/rides/${id}/participants/${userId}`),
  approve: (id: string, userId: string) => api.post(`/api/rides/${id}/participants/${userId}/approve`),
  setRole: (id: string, userId: string, role: 'CO_ADMIN' | 'MEMBER') =>
    api.put(`/api/rides/${id}/participants/${userId}/role`, { role }),
  setLocationSharing: (id: string, enabled: boolean) => api.put(`/api/rides/${id}/location-sharing`, { enabled }),
  regenerateCode: (id: string) => api.post<Ride>(`/api/rides/${id}/join-code`),
  invite: (id: string, b: { expires_in_hours?: number; max_uses?: number }) =>
    api.post<Invitation>(`/api/rides/${id}/invitations`, b),
  offlineCredentials: (id: string) => api.get<OfflineCredentials>(`/api/rides/${id}/offline-credentials`),
  announce: (id: string, text: string) => api.post(`/api/rides/${id}/announcements`, { text, speak: true }),
};

export const Music = {
  status: (rideId: string) => api.get<MusicStatus>(`/api/rides/${rideId}/music/status`),
  queue: (rideId: string, source: Track['source'], tracks: Track[], start_index = 0) =>
    api.put<MusicStatus>(`/api/rides/${rideId}/music/queue`, { source, tracks, start_index }),
  play: (rideId: string, b: { queue_index?: number; position_ms?: number } = {}) =>
    api.post<MusicStatus>(`/api/rides/${rideId}/music/play`, b),
  pause: (rideId: string, position_ms?: number) => api.post<MusicStatus>(`/api/rides/${rideId}/music/pause`, { position_ms }),
  next: (rideId: string) => api.post<MusicStatus>(`/api/rides/${rideId}/music/next`),
  previous: (rideId: string) => api.post<MusicStatus>(`/api/rides/${rideId}/music/previous`),
  enable: (rideId: string, enabled: boolean) => api.put<MusicStatus>(`/api/rides/${rideId}/music/enabled`, { enabled }),
};

export const Stops = {
  create: (rideId: string, b: { type: StopType; note?: string; lat?: number; lng?: number; client_event_id: string }) =>
    api.post<Stop>(`/api/rides/${rideId}/stops`, b),
  list: (rideId: string, includeClosed = false) => api.get<Stop[]>(`/api/rides/${rideId}/stops?include_closed=${includeClosed}`),
  act: (stopId: string, action: 'acknowledge' | 'approve' | 'reject' | 'complete') => api.post<Stop>(`/api/stops/${stopId}/${action}`),
};

export const Emergencies = {
  create: (
    rideId: string,
    b: { type: EmergencyType; message?: string; lat?: number; lng?: number; location_recorded_at?: string; client_event_id: string },
  ) => api.post<Emergency>(`/api/rides/${rideId}/emergency`, b),
  list: (rideId: string, activeOnly = false) => api.get<Emergency[]>(`/api/rides/${rideId}/emergency?active_only=${activeOnly}`),
  acknowledge: (id: string) => api.post<Emergency>(`/api/emergency/${id}/acknowledge`),
  resolve: (id: string) => api.post<Emergency>(`/api/emergency/${id}/resolve`),
};

export const Locations = {
  latest: (rideId: string) => api.get<RiderLocation[]>(`/api/rides/${rideId}/locations`),
};

export const Voice = {
  token: (rideId: string) => api.post<VoiceToken>(`/api/rides/${rideId}/voice/token`),
  setMode: (rideId: string, voice_mode: VoiceMode) => api.put(`/api/rides/${rideId}/voice/mode`, { voice_mode }),
};

export const Devices = {
  register: (b: {
    install_id: string;
    platform: 'ANDROID' | 'IOS';
    model?: string;
    os_version?: string;
    app_version?: string;
    push_token?: string | null;
    supports_nearby: boolean;
  }) => api.post('/api/devices/register', b),
  helmets: () => api.get<Helmet[]>('/api/devices/helmets'),
  saveHelmet: (b: Partial<Helmet> & { name: string; address_hash: string; make_preferred?: boolean }) =>
    api.post<Helmet>('/api/devices/helmets', b),
  deleteHelmet: (id: string) => api.del(`/api/devices/helmets/${id}`),
};

export const Notifications = {
  list: () => api.get<AppNotification[]>('/api/notifications'),
  readAll: () => api.post('/api/notifications/read-all'),
};

export const System = {
  health: () => api.get<{ status: string; server_time: string }>('/api/health', { auth: false, timeoutMs: 4000 }),
};

export const Sync = {
  upload: (events: unknown[]) =>
    api.post<{ results: { event_id: string; result: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED'; reason?: string | null }[] }>(
      '/api/sync/events',
      { events },
      { timeoutMs: 30_000 },
    ),
};
