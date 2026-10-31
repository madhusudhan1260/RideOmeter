import type { RideEvent } from '../events/types';

/** Events this phone authored while the backend was unreachable. */
export interface OutboxStore {
  put(e: RideEvent): Promise<void>;
  list(limit: number): Promise<RideEvent[]>;
  remove(eventIds: string[]): Promise<void>;
  count(): Promise<number>;
}

export type SyncResult = { event_id: string; result: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED'; reason?: string | null };
export type Uploader = (events: RideEvent[]) => Promise<SyncResult[]>;

/** Event types the server accepts from offline sync (mirrors backend sync_service.SUPPORTED). */
export const SYNCABLE = new Set([
  'STOP_REQUESTED',
  'STOP_ACKNOWLEDGED',
  'STOP_UPDATED',
  'EMERGENCY_CREATED',
  'EMERGENCY_ACKNOWLEDGED',
  'LOCATION_UPDATED',
  'ADMIN_ANNOUNCEMENT',
]);

export class OfflineQueue {
  private flushing: Promise<FlushReport> | null = null;

  constructor(private readonly store: OutboxStore, private readonly batchSize = 200) {}

  async enqueue(e: RideEvent): Promise<boolean> {
    if (!SYNCABLE.has(e.event_type)) return false;
    await this.store.put(e);
    return true;
  }

  pending(): Promise<number> {
    return this.store.count();
  }

  /**
   * Upload in batches. Any answer from the server (accepted, duplicate or rejected)
   * removes the event; a network failure keeps everything for the next attempt.
   */
  flush(upload: Uploader): Promise<FlushReport> {
    if (!this.flushing) {
      this.flushing = this.doFlush(upload).finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async doFlush(upload: Uploader): Promise<FlushReport> {
    const report: FlushReport = { accepted: 0, duplicate: 0, rejected: [], failed: false };
    for (;;) {
      const batch = await this.store.list(this.batchSize);
      if (batch.length === 0) return report;
      let results: SyncResult[];
      try {
        results = await upload(batch);
      } catch {
        report.failed = true;
        return report;
      }
      const answered = new Set(results.map(r => r.event_id));
      for (const r of results) {
        if (r.result === 'ACCEPTED') report.accepted++;
        else if (r.result === 'DUPLICATE') report.duplicate++;
        else report.rejected.push({ event_id: r.event_id, reason: r.reason ?? 'rejected' });
      }
      await this.store.remove([...answered]);
      if (answered.size === 0) {
        report.failed = true; // server answered nothing: don't spin
        return report;
      }
    }
  }
}

export type FlushReport = {
  accepted: number;
  duplicate: number;
  rejected: { event_id: string; reason: string }[];
  failed: boolean;
};

export class MemoryOutboxStore implements OutboxStore {
  private items = new Map<string, RideEvent>();
  async put(e: RideEvent) {
    this.items.set(e.event_id, e);
  }
  async list(limit: number) {
    return [...this.items.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(0, limit);
  }
  async remove(ids: string[]) {
    ids.forEach(id => this.items.delete(id));
  }
  async count() {
    return this.items.size;
  }
}
