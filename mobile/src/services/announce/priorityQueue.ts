export type Priority = 'EMERGENCY' | 'HIGH' | 'NORMAL' | 'LOW';

export const PRIORITY_RANK: Record<Priority, number> = { EMERGENCY: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export type Announcement = {
  id: string;
  text: string;
  priority: Priority;
  createdAt: number;
  /** Drop if not spoken within this time (stale announcements are worse than none). */
  ttlMs: number;
};

/** Stable priority queue: higher priority first, FIFO within a priority. */
export class AnnouncementQueue {
  private items: Announcement[] = [];

  push(a: Announcement) {
    if (this.items.some(i => i.id === a.id)) return;
    this.items.push(a);
    this.items.sort((x, y) => PRIORITY_RANK[x.priority] - PRIORITY_RANK[y.priority] || x.createdAt - y.createdAt);
  }

  next(now: number): Announcement | undefined {
    while (this.items.length) {
      const a = this.items.shift()!;
      if (now - a.createdAt <= a.ttlMs) return a;
    }
    return undefined;
  }

  /** Should an incoming announcement cut off the one currently speaking? */
  static preempts(incoming: Priority, current: Priority | null): boolean {
    return current != null && incoming === 'EMERGENCY' && current !== 'EMERGENCY';
  }

  get size() {
    return this.items.length;
  }

  clear() {
    this.items = [];
  }
}
