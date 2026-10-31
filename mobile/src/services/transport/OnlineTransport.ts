import { wsUrl } from '../../api/client';
import { ClockSync } from '../clock/ClockSync';
import type { RideEvent } from '../events/types';

type Listener = {
  onEvent: (e: RideEvent) => void;
  onState: (s: 'connecting' | 'open' | 'closed', reason?: string) => void;
  onFatal: (code: number, reason: string) => void;
};

/**
 * Ride WebSocket with first-message auth, exponential reconnect, heartbeat and
 * NTP-style clock sync. It never claims "open" until the server has sent the
 * PRESENCE snapshot (i.e. the auth handshake succeeded).
 */
export class OnlineTransport {
  readonly clock = new ClockSync();
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  private stopped = true;
  private authed = false;
  private pendingPings = new Map<number, number>();

  constructor(private rideId: string, private token: () => string | null, private l: Listener) {}

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close(1000, 'bye');
    this.ws = null;
    this.authed = false;
    this.l.onState('closed');
  }

  get isOpen() {
    return this.authed && this.ws?.readyState === WebSocket.OPEN;
  }

  send(e: Pick<RideEvent, 'event_id' | 'event_type' | 'payload'>): boolean {
    if (!this.isOpen) return false;
    try {
      this.ws!.send(JSON.stringify({ event_id: e.event_id, event_type: e.event_type, payload: e.payload }));
      return true;
    } catch {
      return false;
    }
  }

  /** Force a reconnect soon (e.g. NetInfo says we are back). */
  nudge() {
    if (this.stopped || this.isOpen) return;
    this.attempt = 0;
    this.scheduleReconnect(200);
  }

  private open() {
    const token = this.token();
    if (!token) {
      this.l.onState('closed', 'not signed in');
      return;
    }
    this.l.onState('connecting');
    this.authed = false;
    const ws = new WebSocket(wsUrl(`/ws/rides/${this.rideId}`));
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
    ws.onmessage = msg => this.onMessage(String(msg.data));
    ws.onerror = () => undefined; // onclose follows
    ws.onclose = ev => {
      if (this.ws !== ws) return;
      this.authed = false;
      this.clearTimers();
      this.l.onState('closed', ev.reason);
      const code = ev.code ?? 0;
      if ([4401, 4403, 4404].includes(code)) {
        this.l.onFatal(code, ev.reason || 'rejected');
        if (code !== 4401) return; // removed / not a participant: don't retry
      }
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private onMessage(raw: string) {
    this.lastMessageAt = Date.now();
    let e: RideEvent;
    try {
      e = JSON.parse(raw);
    } catch {
      return;
    }
    e.transport = 'ws';
    if (e.event_type === 'PRESENCE' && !this.authed) {
      this.authed = true;
      this.attempt = 0;
      this.l.onState('open');
      this.startHeartbeat();
    }
    if (e.event_type === 'CLOCK_PONG') {
      const t0 = Number(e.payload.client_time);
      if (this.pendingPings.delete(t0)) this.clock.addSample(t0, Number(e.payload.server_time), Date.now());
    }
    this.l.onEvent(e);
  }

  private startHeartbeat() {
    // Burst of pings for a quick clock estimate, then a steady heartbeat.
    for (let i = 0; i < 5; i++) setTimeout(() => this.ping(), i * 300);
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt > 30_000) {
        this.ws?.close(4000, 'heartbeat timeout');
        return;
      }
      this.ping();
    }, 10_000);
  }

  private ping() {
    if (!this.isOpen) return;
    const t0 = Date.now();
    this.pendingPings.set(t0, t0);
    if (this.pendingPings.size > 20) this.pendingPings.delete(this.pendingPings.keys().next().value!);
    this.ws!.send(JSON.stringify({ event_type: 'CLOCK_PING', payload: { client_time: t0 } }));
  }

  private scheduleReconnect(delay?: number) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const ms = delay ?? Math.min(30_000, 1000 * 2 ** this.attempt) * (0.7 + Math.random() * 0.6);
    this.attempt++;
    this.retryTimer = setTimeout(() => this.open(), ms);
  }

  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = null;
    this.pingTimer = null;
  }
}
