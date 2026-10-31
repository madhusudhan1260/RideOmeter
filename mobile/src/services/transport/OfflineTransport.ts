import { Nearby, NearbyPeerEvent, NearbyRole } from '../../native/RideWaveNearby';
import type { RideEvent } from '../events/types';

type Listener = {
  onEvent: (e: RideEvent, fromEndpoint: string) => void;
  onPeer: (p: NearbyPeerEvent) => void;
  onState: (s: 'off' | 'unsupported' | 'advertising' | 'discovering' | 'connected' | 'error', detail?: string) => void;
};

/** Local peer-to-peer link over Google Nearby Connections (Android). */
export class OfflineTransport {
  private subs: (() => void)[] = [];
  private running = false;

  constructor(private l: Listener) {}

  async start(o: { rideShortId: string; userId: string; displayName: string; role: NearbyRole; offlineKeyHex: string }) {
    const av = await Nearby.available();
    if (!av.available) {
      this.l.onState('unsupported', av.reason);
      return false;
    }
    this.subs.push(
      Nearby.onState(e => this.l.onState(e.state, e.detail)),
      Nearby.onPeer(p => this.l.onPeer(p)),
      Nearby.onEvent(({ endpointId, json }) => {
        try {
          const e = JSON.parse(json) as RideEvent;
          e.transport = 'nearby';
          this.l.onEvent(e, endpointId);
        } catch {
          // malformed payload from a peer: ignore
        }
      }),
    );
    try {
      await Nearby.start(o);
      this.running = true;
      return true;
    } catch (err: any) {
      this.l.onState('error', err?.message ?? 'Could not start Nearby');
      this.stop();
      return false;
    }
  }

  async send(e: RideEvent): Promise<number> {
    if (!this.running) return 0;
    try {
      return await Nearby.sendEvent(JSON.stringify({ ...e, transport: 'nearby' }));
    } catch {
      return 0;
    }
  }

  stop() {
    this.subs.forEach(u => u());
    this.subs = [];
    if (this.running) Nearby.stop();
    this.running = false;
    this.l.onState('off');
  }

  get isRunning() {
    return this.running;
  }
}
