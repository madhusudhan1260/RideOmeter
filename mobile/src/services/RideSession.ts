import NetInfo from '@react-native-community/netinfo';
import { Emergencies, Locations, Music, Rides, Stops, Sync } from '../api/endpoints';
import type { Emergency, EmergencyType, MusicStatus, Ride, Stop, StopType } from '../api/types';
import { useAuth } from '../store/auth';
import { useConnection } from '../store/connection';
import { useMusic } from '../store/media';
import { isAdminRole, useRide } from '../store/ride';
import { useSettings } from '../store/settings';
import { newEventId } from '../utils/id';
import { Announcer } from './announce/AnnouncementEngine';
import type { Priority } from './announce/priorityQueue';
import { AudioRouting } from '../native/RideWaveAudio';
import { ClockSync } from './clock/ClockSync';
import { EventBus } from './events/EventBus';
import type { EventType, RideEvent } from './events/types';
import { LocationService } from './location/LocationService';
import { MusicController } from './music/MusicController';
import { logEvent, sqliteOutbox } from './storage/db';
import { loadOfflineKey, saveOfflineKey } from './storage/secure';
import { OfflineQueue } from './sync/OfflineQueue';
import { OfflineTransport } from './transport/OfflineTransport';
import { OnlineTransport } from './transport/OnlineTransport';
import { VoiceService } from './voice/VoiceService';

export const STOP_LABEL: Record<StopType, string> = {
  PETROL: 'Petrol stop',
  FOOD: 'Food stop',
  TEA_COFFEE: 'Tea / coffee stop',
  RESTROOM: 'Restroom stop',
  REST: 'Rest stop',
  BREAKDOWN: 'Bike breakdown',
  EMERGENCY: 'Emergency assistance',
  CUSTOM: 'Custom request',
};

const EMERGENCY_TEXT: Record<EmergencyType, string> = {
  SOS: 'Emergency assistance requested by',
  ACCIDENT: 'Accident reported by',
  BREAKDOWN: 'Bike breakdown reported by',
  ASSISTANCE: 'Help requested by',
};

function stopAnnouncement(type: StopType, name: string, note?: string | null) {
  if (type === 'BREAKDOWN') return `Bike breakdown reported by ${name}.`;
  if (type === 'CUSTOM') return `${name} requests a stop: ${note ?? ''}.`;
  return `${STOP_LABEL[type]} requested by ${name}.`;
}

/**
 * One active ride on this phone. Owns both transports, the outbox and the
 * event → store/announcement wiring. Screens call its public methods only.
 */
class Session {
  private rideId: string | null = null;
  private bus: EventBus | null = null;
  private online: OnlineTransport | null = null;
  private offline: OfflineTransport | null = null;
  private queue = new OfflineQueue(sqliteOutbox);
  private hubClock = new ClockSync();
  private unsubs: (() => void)[] = [];
  private lastOfflineLocQueued = 0;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private amHub = false;

  get active() {
    return this.rideId;
  }

  private me() {
    return useAuth.getState().me;
  }

  private myId() {
    return this.me()?.id ?? '';
  }

  private myName() {
    return this.me()?.profile.display_name ?? 'A rider';
  }

  private isAdmin(userId: string | null) {
    if (!userId) return false;
    return isAdminRole(useRide.getState().participants[userId]?.role);
  }

  // ---------------------------------------------------------------- lifecycle

  async start(ride: Ride) {
    if (this.rideId === ride.id) return;
    await this.stop();
    this.rideId = ride.id;
    useRide.getState().reset();
    useRide.getState().setRide(ride);
    const settings = useSettings.getState();
    const conn = useConnection.getState();
    conn.dispatch({ type: 'RIDE_JOINED', nearbyEnabled: settings.nearbyEnabled });
    conn.patch({ outbox: await this.queue.pending() });

    this.bus = new EventBus(id => this.isAdmin(id));
    this.bus.on('*', e => this.handle(e));

    this.online = new OnlineTransport(ride.id, () => useAuth.getState().session?.accessToken ?? null, {
      onEvent: e => this.bus?.emit(e),
      onState: s => {
        useConnection.getState().patch({ ws: s });
        useConnection.getState().dispatch({ type: s === 'open' ? 'BACKEND_UP' : 'BACKEND_DOWN' });
        this.afterTransition();
      },
      onFatal: code => {
        if (code === 4403 || code === 4404) {
          useRide.getState().showBanner({ id: newEventId(), title: 'Removed from ride', body: 'You are no longer part of this ride.', tone: 'danger', at: Date.now() });
          this.stop();
        }
      },
    });
    this.online.start();
    MusicController.setClock(() => this.serverNow());

    this.unsubs.push(
      NetInfo.addEventListener(s => {
        if (s.isConnected) this.online?.nudge();
      }),
    );

    await this.startOffline(ride);
    if (ride.status === 'ACTIVE') this.onRideActive();
    AudioRouting.startRideService(`RideWave · ${ride.name}`, 'Ride in progress — intercom and location sharing active', true);
    this.refresh().catch(() => undefined);
  }

  async stop() {
    if (!this.rideId) return;
    this.unsubs.forEach(u => u());
    this.unsubs = [];
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = null;
    this.online?.stop();
    this.offline?.stop();
    this.online = null;
    this.offline = null;
    LocationService.stop();
    await VoiceService.leave();
    await MusicController.leave();
    await AudioRouting.stopRideService();
    useConnection.getState().dispatch({ type: 'RIDE_LEFT' });
    useConnection.setState({ peers_: {} });
    this.rideId = null;
    this.bus = null;
  }

  private async startOffline(ride: Ride) {
    if (!useSettings.getState().nearbyEnabled) return;
    let key: string | null = null;
    let shortId = ride.id.replace(/-/g, '').slice(0, 8);
    try {
      const creds = await Rides.offlineCredentials(ride.id);
      key = creds.offline_key;
      shortId = creds.short_id;
      await saveOfflineKey(ride.id, key);
    } catch {
      key = await loadOfflineKey(ride.id); // offline start: use the key saved last time
    }
    if (!key) {
      useConnection.getState().patch({ nearby: 'error', nearbyError: 'Open the ride once while online to enable offline mode' });
      return;
    }
    this.amHub = ride.my_role === 'ADMIN';
    this.offline = new OfflineTransport({
      onEvent: (e, endpoint) => this.onNearbyEvent(e, endpoint),
      onPeer: p => {
        const c = useConnection.getState();
        if (p.state === 'DISCONNECTED' || p.state === 'REJECTED') c.dropPeer(p.endpointId);
        else c.upsertPeer({ ...p, state: p.state, lastSeen: Date.now() });
        this.afterTransition();
      },
      onState: (st, detail) => useConnection.getState().patch({ nearby: st, nearbyError: detail ?? null }),
    });
    await this.offline.start({
      rideShortId: shortId,
      userId: this.myId(),
      displayName: this.myName(),
      role: this.amHub ? 'HUB' : 'MEMBER',
      offlineKeyHex: key,
    });
    // Members keep a clock offset to the hub for offline music sync.
    if (!this.amHub) {
      this.clockTimer = setInterval(() => {
        if (useConnection.getState().peers > 0 && !this.online?.isOpen) {
          this.sendNearbyOnly('CLOCK_PING', { client_time: Date.now(), from: this.myId() });
        }
      }, 5000);
    }
  }

  private onRideActive() {
    const s = useSettings.getState();
    LocationService.start(
      s.locationIntervalSec,
      fix => this.send('LOCATION_UPDATED', fix, { quiet: true }),
      () => undefined,
    );
    if (this.online?.isOpen) VoiceService.joinOnline(this.rideId!);
  }

  /** React to connection state changes (voice transport, sync). */
  private async afterTransition() {
    const c = useConnection.getState();
    if (c.state === 'SYNCING') await this.syncNow();
    const ride = useRide.getState().ride;
    if (ride?.status !== 'ACTIVE') return;
    if (c.state === 'ONLINE' && VoiceService.currentRide !== this.rideId) VoiceService.joinOnline(this.rideId!);
    if (c.state === 'OFFLINE_MODE' && useConnection.getState().peers > 0 && useConnection.getState().livekit !== 'connected') {
      VoiceService.joinOffline();
    }
  }

  async syncNow() {
    const report = await this.queue.flush(events => Sync.upload(events).then(r => r.results));
    const c = useConnection.getState();
    c.patch({ outbox: await this.queue.pending() });
    if (report.failed) {
      c.dispatch({ type: 'SYNC_FAILED' });
      setTimeout(() => {
        if (this.rideId && useConnection.getState().state === 'SYNCING') this.syncNow();
      }, 10_000);
      return;
    }
    MusicController.resetAuthority();
    await this.refresh().catch(() => undefined);
    c.patch({ lastSyncAt: Date.now() });
    c.dispatch({ type: 'SYNC_DONE' });
    if (report.rejected.length) {
      useRide.getState().showBanner({
        id: newEventId(),
        title: 'Some offline events were not accepted',
        body: report.rejected[0].reason,
        tone: 'info',
        at: Date.now(),
      });
    }
  }

  /** Pull authoritative state from the server. */
  async refresh() {
    if (!this.rideId) return;
    const id = this.rideId;
    const [ride, stops, emergencies, locs, music] = await Promise.all([
      Rides.get(id),
      Stops.list(id),
      Emergencies.list(id, true),
      Locations.latest(id),
      Music.status(id).catch(() => null),
    ]);
    const r = useRide.getState();
    r.setRide(ride);
    r.setStops(stops);
    r.setEmergencies(emergencies);
    r.seedPositions(locs);
    if (music) MusicController.apply(music, this.online?.clock.ready ?? false);
  }

  serverNow(): number {
    if (this.online?.isOpen && this.online.clock.ready) return this.online.clock.serverNow();
    if (!this.amHub && this.hubClock.ready) return this.hubClock.serverNow();
    return Date.now();
  }

  // ---------------------------------------------------------------- sending

  private envelope(type: EventType, payload: Record<string, any>): RideEvent {
    return {
      event_id: newEventId(),
      event_type: type,
      ride_id: this.rideId!,
      sender_id: this.myId(),
      timestamp: new Date().toISOString(),
      payload,
      delivery_status: 'SENDING',
      transport: 'local',
    };
  }

  private async sendNearbyOnly(type: EventType, payload: Record<string, any>) {
    if (!this.offline || !this.rideId) return 0;
    return this.offline.send(this.envelope(type, payload));
  }

  /**
   * Send over every available path. Returns the event and how it left the phone.
   * If neither the server nor any peer took it, syncable events go to the outbox.
   */
  async send(type: EventType, payload: Record<string, any>, opts: { quiet?: boolean } = {}) {
    if (!this.rideId) throw new Error('No active ride');
    const e = this.envelope(type, payload);
    const viaWs = this.online?.send(e) ?? false;
    const peers = useConnection.getState().peers;
    const isLocation = type === 'LOCATION_UPDATED';
    // Locations go over the mesh only when the server is unreachable (bandwidth).
    const viaNearby = peers > 0 && (!isLocation || !viaWs) ? await this.offline!.send(e) : 0;

    let queued = false;
    if (!viaWs) {
      if (!isLocation || Date.now() - this.lastOfflineLocQueued > 60_000) {
        queued = await this.queue.enqueue(e);
        if (isLocation && queued) this.lastOfflineLocQueued = Date.now();
      }
      useConnection.getState().patch({ outbox: await this.queue.pending() });
      // Nobody (server) will echo it back — apply locally so our own UI reflects it.
      this.bus?.emit({ ...e, transport: 'local' });
    }
    if (!opts.quiet) {
      const via: ('ws' | 'nearby' | 'outbox')[] = [];
      if (viaWs) via.push('ws');
      if (viaNearby) via.push('nearby');
      if (queued) via.push('outbox');
      return { event: e, via, nearbyPeers: viaNearby };
    }
    return { event: e, via: [] as ('ws' | 'nearby' | 'outbox')[], nearbyPeers: viaNearby };
  }

  async requestStop(type: StopType, note?: string) {
    const fix = LocationService.lastKnown();
    const payload: Record<string, any> = { type, note: note ?? null, lat: fix?.lat ?? null, lng: fix?.lng ?? null };
    const { event, via } = await this.send('STOP_REQUESTED', payload);
    useRide.getState().track({
      eventId: event.event_id,
      kind: 'STOP',
      label: STOP_LABEL[type],
      createdAt: Date.now(),
      status: 'SENDING',
      deliveredTo: [],
      recipients: Math.max(0, Object.keys(useRide.getState().participants).length - 1),
      via,
    });
    return event.event_id;
  }

  async raiseEmergency(type: EmergencyType, message?: string) {
    const fix = LocationService.lastKnown() ?? (await LocationService.current(4000));
    const payload: Record<string, any> = {
      type,
      message: message ?? null,
      lat: fix?.lat ?? null,
      lng: fix?.lng ?? null,
      location_recorded_at: fix?.recorded_at ?? null,
    };
    const { event, via } = await this.send('EMERGENCY_CREATED', payload);
    useRide.getState().track({
      eventId: event.event_id,
      kind: 'EMERGENCY',
      label: type,
      createdAt: Date.now(),
      status: 'SENDING',
      deliveredTo: [],
      recipients: Math.max(0, Object.keys(useRide.getState().participants).length - 1),
      via,
    });
    return event.event_id;
  }

  async actOnStop(stop: Stop, action: 'acknowledge' | 'approve' | 'reject' | 'complete') {
    if (this.online?.isOpen) {
      useRide.getState().upsertStop(await Stops.act(stop.id, action));
      return;
    }
    // Offline: tell the mesh, queue for the server (which re-validates the role on sync).
    const type = action === 'acknowledge' ? 'STOP_ACKNOWLEDGED' : 'STOP_UPDATED';
    await this.send(type, { stop_id: stop.id, action });
  }

  async acknowledgeEmergency(e: Emergency) {
    if (this.online?.isOpen) {
      useRide.getState().upsertEmergency(await Emergencies.acknowledge(e.id));
      return;
    }
    await this.send('EMERGENCY_ACKNOWLEDGED', { emergency_id: e.id });
  }

  async announce(text: string) {
    if (this.online?.isOpen) await Rides.announce(this.rideId!, text);
    else await this.send('ADMIN_ANNOUNCEMENT', { text, speak: true, from: this.myName() });
  }

  /** Admin music controls: server when online, hub authority over the mesh when offline. */
  async music(action: 'PLAY' | 'PAUSE' | 'NEXT' | 'PREV') {
    const id = this.rideId!;
    if (this.online?.isOpen) {
      const call = { PLAY: () => Music.play(id), PAUSE: () => Music.pause(id), NEXT: () => Music.next(id), PREV: () => Music.previous(id) }[action];
      const st = await call();
      await MusicController.apply(st, this.online.clock.ready);
      return;
    }
    const prev = useMusic.getState().status;
    if (!prev || !this.amHub) throw new Error(this.amHub ? 'No music queue yet' : 'Offline music is controlled from the hub (admin) phone');
    const next = MusicController.nextLocalStatus(prev, action, Date.now());
    if (!next) return;
    const type: EventType = { PLAY: 'MUSIC_PLAY', PAUSE: 'MUSIC_PAUSE', NEXT: 'MUSIC_NEXT', PREV: 'MUSIC_PREV' }[action] as EventType;
    await this.sendNearbyOnly(type, next as unknown as Record<string, any>);
    await MusicController.apply(next, true);
  }

  // ---------------------------------------------------------------- receiving

  private onNearbyEvent(e: RideEvent, _endpoint: string) {
    if (e.ride_id !== this.rideId) return;
    if (e.event_type === 'CLOCK_PING') {
      if (this.amHub) this.sendNearbyOnly('CLOCK_PONG', { client_time: e.payload.client_time, server_time: Date.now(), to: e.payload.from });
      return;
    }
    if (e.event_type === 'CLOCK_PONG') {
      if (e.payload.to === this.myId()) this.hubClock.addSample(Number(e.payload.client_time), Number(e.payload.server_time), Date.now());
      return;
    }
    this.bus?.emit(e);
  }

  private ackDelivery(e: RideEvent, serverRefId?: string) {
    if (e.sender_id === this.myId()) return;
    if (e.transport === 'nearby') {
      this.sendNearbyOnly('DELIVERY_ACK', { ref_event_id: e.event_id, user_id: this.myId() });
    } else if (e.transport === 'ws' && serverRefId) {
      this.online?.send({ event_id: newEventId(), event_type: 'DELIVERY_ACK', payload: { ref_id: serverRefId } });
    }
  }

  private say(text: string, p: Priority) {
    Announcer.say(text, p);
  }

  private handle(e: RideEvent) {
    if (e.event_type !== 'CLOCK_PONG' && e.event_type !== 'PRESENCE') logEvent(e).catch(() => undefined);
    const r = useRide.getState();
    const p = e.payload as any;
    const mine = e.sender_id === this.myId();
    const name = (id: string | null) => (id && r.participants[id]?.display_name) || 'A rider';

    switch (e.event_type) {
      case 'PRESENCE':
        r.setPresence(p.online ?? []);
        break;
      case 'RIDER_RECONNECTED':
        r.setOnline(p.user_id, true);
        break;
      case 'RIDER_DISCONNECTED':
        r.setOnline(p.user_id, false);
        if (useSettings.getState().notifyRiders) this.say(`${p.display_name ?? 'A rider'} lost connection.`, 'LOW');
        break;
      case 'RIDER_JOINED':
        if (!mine && useSettings.getState().notifyRiders) this.say(`${p.display_name} joined the ride.`, 'LOW');
        this.refresh().catch(() => undefined);
        break;
      case 'RIDER_LEFT':
      case 'RIDER_ROLE_CHANGED':
      case 'RIDE_UPDATED':
        this.refresh().catch(() => undefined);
        break;
      case 'RIDER_REMOVED':
        if (p.user_id === this.myId()) this.stop();
        else this.refresh().catch(() => undefined);
        break;
      case 'RIDE_STARTED':
        this.say('Ride started. Ride safe.', 'HIGH');
        this.refresh().then(() => this.onRideActive()).catch(() => undefined);
        break;
      case 'RIDE_ENDED':
        this.say('The ride has ended.', 'HIGH');
        this.refresh().catch(() => undefined);
        LocationService.stop();
        VoiceService.leave();
        break;

      case 'STOP_REQUESTED': {
        const stop: Stop =
          e.transport === 'ws'
            ? p
            : {
                id: e.event_id,
                ride_id: e.ride_id,
                requester_id: e.sender_id ?? '',
                requester_name: name(e.sender_id),
                type: p.type,
                note: p.note ?? null,
                status: 'OPEN',
                lat: p.lat ?? null,
                lng: p.lng ?? null,
                created_at: e.timestamp,
                expires_at: new Date(Date.parse(e.timestamp) + 10 * 60_000).toISOString(),
                handled_by: null,
                handled_at: null,
                announcement: stopAnnouncement(p.type, name(e.sender_id), p.note),
              };
        r.upsertStop(stop);
        if (!mine) {
          const urgent = stop.type === 'BREAKDOWN' || stop.type === 'EMERGENCY';
          if (useSettings.getState().notifyStops || urgent) this.say(stop.announcement, urgent ? 'EMERGENCY' : 'HIGH');
          r.showBanner({ id: stop.id, title: STOP_LABEL[stop.type], body: stop.announcement, tone: urgent ? 'danger' : 'accent', at: Date.now() });
          this.ackDelivery(e, e.transport === 'ws' ? stop.id : undefined);
        }
        break;
      }
      case 'STOP_ACKNOWLEDGED':
      case 'STOP_UPDATED': {
        if (e.transport === 'ws') {
          r.upsertStop(p);
          if (p.requester_id === this.myId() && !mine) this.say(`Admin ${p.status.toLowerCase()} your ${STOP_LABEL[p.type as StopType].toLowerCase()}.`, 'NORMAL');
        } else {
          const s = r.stops[p.stop_id];
          const statusFor: Record<string, Stop['status']> = { acknowledge: 'ACKNOWLEDGED', approve: 'APPROVED', reject: 'REJECTED', complete: 'COMPLETED' };
          if (s) r.upsertStop({ ...s, status: statusFor[p.action ?? 'acknowledge'], handled_by: e.sender_id, handled_at: e.timestamp });
        }
        break;
      }

      case 'EMERGENCY_CREATED': {
        const em: Emergency =
          e.transport === 'ws'
            ? p
            : {
                id: e.event_id,
                ride_id: e.ride_id,
                reporter_id: e.sender_id ?? '',
                reporter_name: name(e.sender_id),
                type: p.type,
                status: 'ACTIVE',
                message: p.message ?? null,
                lat: p.lat ?? null,
                lng: p.lng ?? null,
                location_recorded_at: p.location_recorded_at ?? null,
                created_at: e.timestamp,
                acknowledged_by: null,
                acknowledged_at: null,
                resolved_at: null,
                recipients: 0,
                delivered: 0,
                emergency_contact: { name: null, phone: null, blood_group: null },
                announcement: `${EMERGENCY_TEXT[p.type as EmergencyType]} ${name(e.sender_id)}.`,
              };
        r.upsertEmergency(em);
        if (mine) {
          // Server echo: link our outgoing record to the server id for delivery counts.
          if (e.transport === 'ws') r.updateOutgoing(e.event_id, { serverId: em.id, status: 'DELIVERED' });
        } else {
          this.say(em.announcement, 'EMERGENCY');
          r.showBanner({ id: em.id, title: 'EMERGENCY', body: em.announcement, tone: 'danger', at: Date.now() });
          this.ackDelivery(e, e.transport === 'ws' ? em.id : undefined);
        }
        break;
      }
      case 'EMERGENCY_ACKNOWLEDGED':
      case 'EMERGENCY_RESOLVED': {
        if (e.transport === 'ws') {
          r.upsertEmergency(p);
          const out = Object.values(r.outgoing).find(o => o.serverId === p.id);
          if (out && e.event_type === 'EMERGENCY_ACKNOWLEDGED') {
            r.updateOutgoing(out.eventId, { status: 'ACKNOWLEDGED' });
            this.say(`${name(p.acknowledged_by)} acknowledged your emergency.`, 'EMERGENCY');
          }
        } else {
          const em = r.emergencies[p.emergency_id];
          if (em) r.upsertEmergency({ ...em, status: 'ACKNOWLEDGED', acknowledged_by: e.sender_id, acknowledged_at: e.timestamp });
          if (r.outgoing[p.emergency_id]) {
            r.updateOutgoing(p.emergency_id, { status: 'ACKNOWLEDGED' });
            this.say(`${name(e.sender_id)} acknowledged your emergency.`, 'EMERGENCY');
          }
        }
        break;
      }

      case 'LOCATION_UPDATED': {
        const uid = e.transport === 'ws' ? p.user_id : e.sender_id;
        if (!uid || (uid === this.myId() && e.transport !== 'local')) break;
        r.setPosition(uid, {
          lat: p.lat,
          lng: p.lng,
          recordedAt: Date.parse(p.recorded_at),
          accuracy: p.accuracy_m,
          speed: p.speed_mps,
          heading: p.heading,
          battery: p.battery_pct,
          via: e.transport === 'ws' ? 'ws' : e.transport === 'nearby' ? 'nearby' : 'rest',
        });
        break;
      }

      case 'MUSIC_PLAY':
      case 'MUSIC_PAUSE':
      case 'MUSIC_NEXT':
      case 'MUSIC_PREV':
      case 'MUSIC_QUEUE':
      case 'MUSIC_ENABLED':
        if (e.transport !== 'local') MusicController.apply(p as MusicStatus, e.transport === 'nearby' ? this.hubClock.ready || this.amHub : this.online?.clock.ready ?? false);
        break;

      case 'ADMIN_ANNOUNCEMENT':
        if (!mine) {
          if (p.speak !== false) this.say(p.text, 'HIGH');
          r.showBanner({ id: e.event_id, title: `Announcement · ${p.from ?? 'Admin'}`, body: p.text, tone: 'accent', at: Date.now() });
          this.ackDelivery(e);
        }
        break;

      case 'VOICE_MODE_CHANGED':
        r.setVoiceMode(p.voice_mode);
        if (this.online?.isOpen && useRide.getState().ride?.status === 'ACTIVE') VoiceService.joinOnline(this.rideId!);
        break;

      case 'DELIVERY_ACK': {
        // (a) server confirming it accepted one of our WS events
        if (p.ref_event_id && e.transport === 'ws' && !p.user_id) {
          r.updateOutgoing(p.ref_event_id, o => ({
            status: o.status === 'ACKNOWLEDGED' ? o.status : 'DELIVERED',
            serverId: p.emergency_id ?? p.stop_id ?? o.serverId,
          }));
          break;
        }
        // (b) a rider's phone confirming receipt
        const uid: string | undefined = p.user_id;
        const target = p.ref_event_id ? r.outgoing[p.ref_event_id] : Object.values(r.outgoing).find(o => o.serverId === p.ref_id);
        if (target && uid && uid !== this.myId() && !target.deliveredTo.includes(uid)) {
          r.updateOutgoing(target.eventId, o => ({
            deliveredTo: [...o.deliveredTo, uid],
            status: o.status === 'ACKNOWLEDGED' ? o.status : 'DELIVERED',
          }));
        }
        break;
      }

      case 'ERROR':
        if (p.ref_event_id) r.updateOutgoing(p.ref_event_id, { status: 'FAILED', error: p.detail });
        break;
      default:
        break;
    }
  }
}

export const RideSession = new Session();
