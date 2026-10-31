import { create } from 'zustand';
import { bindTokens } from '../api/client';
import { Auth, Users } from '../api/endpoints';
import type { Me, TokenPair } from '../api/types';
import { clearAuth, loadAuth, saveAuth, StoredAuth } from '../services/storage/secure';

type Status = 'loading' | 'signedOut' | 'signedIn';

type AuthStore = {
  status: Status;
  me: Me | null;
  session: StoredAuth | null;
  bootstrap: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  register: (b: { email: string; username: string; password: string; display_name: string }) => Promise<void>;
  logout: () => Promise<void>;
  setMe: (me: Me) => void;
  refreshMe: () => Promise<void>;
};

const toSession = (t: TokenPair): StoredAuth => ({
  accessToken: t.access_token,
  refreshToken: t.refresh_token,
  expiresAt: Date.now() + t.expires_in * 1000,
});

export const useAuth = create<AuthStore>((set, get) => {
  const adopt = async (t: TokenPair) => {
    const session = toSession(t);
    await saveAuth(session);
    set({ session });
    return session;
  };

  bindTokens({
    access: () => get().session?.accessToken ?? null,
    refresh: async () => {
      const rt = get().session?.refreshToken;
      if (!rt) return null;
      try {
        const t = await Auth.refresh(rt);
        await adopt(t);
        return t;
      } catch (e: any) {
        // Network failure keeps the session (offline); only a 401 signs out.
        if (e?.status === 401) return null;
        throw e;
      }
    },
    onSignedOut: () => {
      clearAuth();
      set({ status: 'signedOut', me: null, session: null });
    },
  });

  return {
    status: 'loading',
    me: null,
    session: null,

    bootstrap: async () => {
      const stored = await loadAuth();
      if (!stored) return set({ status: 'signedOut' });
      set({ session: stored });
      try {
        const me = await Users.me();
        set({ me, status: 'signedIn' });
      } catch (e: any) {
        if (e?.status === 401) {
          await clearAuth();
          set({ status: 'signedOut', session: null });
        } else {
          // Offline start: keep the stored session so offline ride features still work.
          set({ status: 'signedIn' });
        }
      }
    },

    login: async (identifier, password) => {
      await adopt(await Auth.login(identifier, password));
      set({ me: await Users.me(), status: 'signedIn' });
    },

    register: async b => {
      await adopt(await Auth.register(b));
      set({ me: await Users.me(), status: 'signedIn' });
    },

    logout: async () => {
      const rt = get().session?.refreshToken;
      if (rt) await Auth.logout(rt).catch(() => undefined);
      await clearAuth();
      set({ status: 'signedOut', me: null, session: null });
    },

    setMe: me => set({ me }),
    refreshMe: async () => set({ me: await Users.me() }),
  };
});
