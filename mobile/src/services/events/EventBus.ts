import { ADMIN_ONLY, EventType, RideEvent } from './types';

type Handler = (e: RideEvent) => void;

/**
 * One bus for both transports. The same event may arrive over WebSocket and
 * Nearby; the bus processes each event_id once.
 *
 * `isAdmin` lets the bus drop admin-only events from non-admins when they come
 * over the offline mesh (where no server validated them).
 */
export class EventBus {
  private handlers = new Map<EventType | '*', Set<Handler>>();
  private seen = new Map<string, number>();

  constructor(
    private readonly isAdmin: (userId: string | null) => boolean = () => true,
    private readonly ttlMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  on(type: EventType | '*', h: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(h);
    return () => this.handlers.get(type)?.delete(h);
  }

  /** Returns true if the event was new and dispatched. */
  emit(e: RideEvent): boolean {
    this.gc();
    // Server-only events (clock, errors, acks) have no dedupe semantics.
    const dedupe = !['CLOCK_PONG', 'ERROR', 'DELIVERY_ACK'].includes(e.event_type);
    if (dedupe) {
      if (this.seen.has(e.event_id)) return false;
      this.seen.set(e.event_id, this.now());
    }
    if (e.transport === 'nearby' && ADMIN_ONLY.has(e.event_type) && !this.isAdmin(e.sender_id)) {
      return false;
    }
    this.handlers.get(e.event_type)?.forEach(h => h(e));
    this.handlers.get('*')?.forEach(h => h(e));
    return true;
  }

  hasSeen(eventId: string): boolean {
    return this.seen.has(eventId);
  }

  markSeen(eventId: string) {
    this.seen.set(eventId, this.now());
  }

  private gc() {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, t] of this.seen) if (t < cutoff) this.seen.delete(id);
  }
}
