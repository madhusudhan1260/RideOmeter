/**
 * NTP-style clock offset estimation.
 *
 * For each ping: t0 = local send, ts = server time, t1 = local receive.
 * offset ≈ ts - (t0 + t1) / 2, with uncertainty rtt / 2.
 * We keep the samples with the lowest RTT (least queuing) and take their median.
 */
export type ClockSample = { offset: number; rtt: number };

export class ClockSync {
  private samples: ClockSample[] = [];

  constructor(private readonly maxSamples = 8) {}

  addSample(t0: number, serverTime: number, t1: number): ClockSample | null {
    const rtt = t1 - t0;
    if (rtt < 0 || rtt > 5000) return null; // clock jumped or reply hopelessly late
    const s = { offset: serverTime - (t0 + t1) / 2, rtt };
    this.samples.push(s);
    this.samples.sort((a, b) => a.rtt - b.rtt);
    this.samples = this.samples.slice(0, this.maxSamples);
    return s;
  }

  get ready(): boolean {
    return this.samples.length >= 3;
  }

  /** Server time minus local time, in ms. */
  get offset(): number {
    if (this.samples.length === 0) return 0;
    const best = this.samples.slice(0, Math.max(1, Math.ceil(this.samples.length / 2)));
    const offsets = best.map(s => s.offset).sort((a, b) => a - b);
    const mid = Math.floor(offsets.length / 2);
    return offsets.length % 2 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2;
  }

  get uncertainty(): number {
    return this.samples.length ? this.samples[0].rtt / 2 : Infinity;
  }

  serverNow(localNow = Date.now()): number {
    return localNow + this.offset;
  }

  reset() {
    this.samples = [];
  }
}
