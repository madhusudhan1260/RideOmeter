import { create } from 'zustand';
import { ConnInput, ConnSnapshot, initialSnapshot, reduce, settle } from '../services/connection/stateMachine';

export type PeerState = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';
export type Peer = { endpointId: string; userId: string; name: string; state: PeerState; isHub: boolean; lastSeen: number };

type Store = ConnSnapshot & {
  ws: 'closed' | 'connecting' | 'open';
  livekit: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  nearby: 'off' | 'unsupported' | 'advertising' | 'discovering' | 'connected' | 'error';
  nearbyError: string | null;
  peers_: Record<string, Peer>;
  outbox: number;
  lastSyncAt: number | null;
  dispatch: (i: ConnInput) => void;
  patch: (p: Partial<Omit<Store, 'dispatch' | 'patch' | 'upsertPeer' | 'dropPeer'>>) => void;
  upsertPeer: (p: Peer) => void;
  dropPeer: (endpointId: string) => void;
};

export const useConnection = create<Store>((set, get) => ({
  ...initialSnapshot,
  ws: 'closed',
  livekit: 'disconnected',
  nearby: 'off',
  nearbyError: null,
  peers_: {},
  outbox: 0,
  lastSyncAt: null,
  dispatch: i => {
    const { state, backend, peers, nearbyEnabled, pendingSync } = get();
    set(settle(reduce({ state, backend, peers, nearbyEnabled, pendingSync }, i)));
  },
  patch: p => set(p),
  upsertPeer: p => {
    const peers_ = { ...get().peers_, [p.endpointId]: p };
    set({ peers_ });
    get().dispatch({ type: 'PEERS_CHANGED', count: Object.values(peers_).filter(x => x.state === 'CONNECTED').length });
  },
  dropPeer: id => {
    const { [id]: _gone, ...rest } = get().peers_;
    set({ peers_: rest });
    get().dispatch({ type: 'PEERS_CHANGED', count: Object.values(rest).filter(x => x.state === 'CONNECTED').length });
  },
}));
