import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import type { Session } from '../types/pos';

export const IDLE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes inactivity timeout (mobile only)
const SESSION_STORAGE_KEY = 'sahabat_active_session';
const LAST_ACTIVITY_KEY = 'sahabat_last_activity';
const AUTH_INIT_CACHE_KEY = 'sahabat_auth_initialized';

export function hasCachedAuthInitialized(): boolean {
  try {
    return localStorage.getItem(AUTH_INIT_CACHE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markAuthInitialized(initialized = true): void {
  try {
    if (initialized) {
      localStorage.setItem(AUTH_INIT_CACHE_KEY, '1');
    } else {
      localStorage.removeItem(AUTH_INIT_CACHE_KEY);
    }
  } catch {
    // ignore
  }
}

export async function getAuthStatus(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('/api/auth/status', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return hasCachedAuthInitialized() || true;
    const data = (await res.json().catch(() => ({}))) as { initialized?: boolean };
    const initialized = Boolean(data.initialized);
    markAuthInitialized(initialized);
    return initialized;
  } catch {
    return hasCachedAuthInitialized() || true;
  } finally {
    clearTimeout(timer);
  }
}

// Store active session in localStorage:
// - Desktop/computer: stays signed in across reloads/closing browser until explicit logout
// - Mobile (HP): expires automatically after 20 minutes of inactivity
let inMemoryToken: string | null = null;
let currentSession: Session | null = null;
let lastActivityWriteAt = 0;
let activeSignInInFlight = false;
let onSessionExpired: ((reason?: string) => void) | null = null;
const networkListeners = new Set<(online: boolean) => void>();

export function subscribeNetworkStatus(listener: (online: boolean) => void): () => void {
  networkListeners.add(listener);
  return () => {
    networkListeners.delete(listener);
  };
}

function notifyNetworkStatus(online: boolean): void {
  for (const listener of networkListeners) {
    listener(online);
  }
}

export async function probeServerHealth(timeoutMs = 5000): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    notifyNetworkStatus(false);
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    const ok = res.ok;
    notifyNetworkStatus(ok);
    return ok;
  } catch {
    notifyNetworkStatus(false);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

class FatalClientError extends Error {
  fatal = true;
}

export function registerSessionExpiredHandler(cb: (reason?: string) => void): void {
  onSessionExpired = cb;
}

export function touchUserActivity(force = false): void {
  const now = Date.now();
  if (!force && now - lastActivityWriteAt < 5000) return;
  lastActivityWriteAt = now;
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
  } catch {
    // ignore storage errors
  }
}

export function getLastActivityAt(): number {
  try {
    const raw = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || '0');
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const uaDataMobile = (navigator as Navigator & { userAgentData?: { mobile?: boolean } })
    .userAgentData?.mobile;
  if (typeof uaDataMobile === 'boolean') return uaDataMobile;
  const ua = navigator.userAgent || '';
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) {
    return true;
  }
  const hasCoarseOnly =
    window.matchMedia?.('(pointer: coarse)').matches &&
    !window.matchMedia?.('(any-pointer: fine)').matches &&
    window.innerWidth < 1024;
  return Boolean(hasCoarseOnly);
}

export function getDeviceType(): 'mobile' | 'desktop' {
  return isMobileDevice() ? 'mobile' : 'desktop';
}

export function isIdleExpired(): boolean {
  // Desktop devices stay logged in unless the user explicitly logs out
  if (!isMobileDevice()) return false;
  const last = getLastActivityAt();
  if (!last) return true;
  return Date.now() - last >= IDLE_TIMEOUT_MS;
}

export function saveClientSession(sess: Session | null): void {
  currentSession = sess;
  inMemoryToken = sess?.token || null;

  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    if (sess) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sess));
      touchUserActivity(true);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      lastActivityWriteAt = 0;
    }
  } catch {
    // ignore storage errors
  }
}

export function readStoredSession(): Session | null {
  try {
    const raw =
      localStorage.getItem(SESSION_STORAGE_KEY) || sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    if (isIdleExpired()) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!parsed || typeof parsed.token !== 'string' || !parsed.token || !parsed.user) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    const restored: Session = {
      token: parsed.token,
      user: parsed.user,
      email: parsed.email,
      role: parsed.role === 'owner' ? 'owner' : 'admin',
      perms: parsed.perms === '*' ? '*' : Array.isArray(parsed.perms) ? parsed.perms : [],
      authType: parsed.authType === 'google' ? 'google' : 'credentials',
      deviceType: parsed.deviceType === 'desktop' || parsed.deviceType === 'mobile' ? parsed.deviceType : getDeviceType(),
    };
    currentSession = restored;
    inMemoryToken = restored.token;
    // Migrate legacy sessionStorage entry into localStorage
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(restored));
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return restored;
  } catch {
    return null;
  }
}

function updateStoredToken(nextToken: string): void {
  if (!nextToken) return;
  inMemoryToken = nextToken;
  if (currentSession) {
    currentSession = { ...currentSession, token: nextToken };
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(currentSession));
    } catch {
      // ignore
    }
  }
}

function expireClientSession(reason: string): never {
  saveClientSession(null);
  onSessionExpired?.(reason);
  throw new FatalClientError(reason);
}

export async function getFreshIdToken(
  forceRefresh = false,
  sessionOverride: Session | null = null,
): Promise<string> {
  if (isIdleExpired()) {
    expireClientSession('Tidak ada aktivitas selama 20 menit di HP. Silakan login ulang.');
  }

  const active = sessionOverride ?? currentSession;

  if (active?.authType === 'credentials' || active?.token?.startsWith('sp.')) {
    const credToken = inMemoryToken || active?.token;
    if (credToken) {
      inMemoryToken = credToken;
      return credToken;
    }
  }

  if (typeof auth.authStateReady === 'function') {
    await auth.authStateReady();
  }

  if (auth.currentUser) {
    const token = await auth.currentUser.getIdToken(forceRefresh);
    updateStoredToken(token);
    return token;
  }

  const fallback = inMemoryToken || active?.token;
  if (fallback) {
    inMemoryToken = fallback;
    return fallback;
  }

  expireClientSession('Sesi login tidak ditemukan. Silakan masuk kembali.');
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getFreshIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function fetchBackendSession(token: string): Promise<Session> {
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = (await res.json().catch(() => ({}))) as {
    user?: string;
    email?: string;
    role?: Session['role'];
    perms?: Session['perms'];
    error?: string;
  };
  if (!res.ok) {
    const err = new Error(payload.error || 'Gagal memverifikasi sesi akun') as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return {
    token,
    user: payload.user || 'user',
    email: payload.email,
    role: payload.role === 'owner' ? 'owner' : 'admin',
    perms: payload.perms === '*' ? '*' : Array.isArray(payload.perms) ? payload.perms : [],
    authType: 'google',
  };
}

export async function setupInitialAccount(input: {
  email: string;
  username: string;
  password: string;
}): Promise<Session> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const deviceType = getDeviceType();
  try {
    const res = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: input.email.trim().toLowerCase(),
        username: input.username.trim().toLowerCase(),
        password: input.password.trim(),
        deviceType,
      }),
      signal: controller.signal,
    });
    const payload = (await res.json().catch(() => ({}))) as {
      token?: string;
      deviceType?: 'mobile' | 'desktop';
      user?: string;
      email?: string;
      role?: Session['role'];
      perms?: Session['perms'];
      error?: string;
    };
    if (!res.ok || !payload.token) {
      throw new Error(payload.error || 'Gagal menyelesaikan pendaftaran awal.');
    }
    const sess: Session = {
      token: payload.token,
      user: payload.user || input.username.trim().toLowerCase(),
      email: payload.email || input.email.trim().toLowerCase(),
      role: payload.role === 'owner' ? 'owner' : 'admin',
      perms: payload.perms === '*' ? '*' : Array.isArray(payload.perms) ? payload.perms : [],
      authType: 'credentials',
      deviceType: payload.deviceType || deviceType,
    };
    markAuthInitialized(true);
    saveClientSession(sess);
    return sess;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Waktu koneksi habis. Periksa internet Anda dan coba lagi.');
    }
    if (err instanceof Error) throw err;
    throw new Error('Gagal mendaftarkan akun awal.');
  } finally {
    clearTimeout(timer);
  }
}

export async function loginWithCredentials(input: {
  email?: string;
  username: string;
  password: string;
}): Promise<Session> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const deviceType = getDeviceType();
  const cleanEmail = input.email ? input.email.trim().toLowerCase() : undefined;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(cleanEmail ? { email: cleanEmail } : {}),
        username: input.username.trim().toLowerCase(),
        password: input.password.trim(),
        deviceType,
      }),
      signal: controller.signal,
    });
    const payload = (await res.json().catch(() => ({}))) as {
      token?: string;
      deviceType?: 'mobile' | 'desktop';
      user?: string;
      email?: string;
      role?: Session['role'];
      perms?: Session['perms'];
      error?: string;
    };
    if (!res.ok || !payload.token) {
      throw new Error(payload.error || 'Username atau password salah.');
    }
    const sess: Session = {
      token: payload.token,
      user: payload.user || input.username.trim().toLowerCase(),
      email: payload.email || cleanEmail,
      role: payload.role === 'owner' ? 'owner' : 'admin',
      perms: payload.perms === '*' ? '*' : Array.isArray(payload.perms) ? payload.perms : [],
      authType: 'credentials',
      deviceType: payload.deviceType || deviceType,
    };
    markAuthInitialized(true);
    saveClientSession(sess);
    return sess;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Waktu koneksi habis. Periksa internet Anda dan coba lagi.');
    }
    if (err instanceof Error) throw err;
    throw new Error('Gagal masuk ke aplikasi.');
  } finally {
    clearTimeout(timer);
  }
}

export async function signInWithGoogle(): Promise<Session> {
  activeSignInInFlight = true;
  try {
    const cred = await signInWithPopup(auth, googleAuthProvider);
    const token = await cred.user.getIdToken();
    try {
      const sess = await fetchBackendSession(token);
      sess.deviceType = getDeviceType();
      saveClientSession(sess);
      return sess;
    } catch (err) {
      saveClientSession(null);
      await signOut(auth).catch(() => {});
      throw err;
    }
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Login Google dibatalkan.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error('Popup login diblokir browser. Izinkan popup lalu coba lagi.');
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        'Domain aplikasi belum terdaftar di Firebase Authorized Domains. Tambahkan domain ini di Firebase Console → Authentication → Settings → Authorized domains.',
      );
    }
    if (err instanceof Error) throw err;
    throw new Error('Gagal masuk dengan akun Google.');
  } finally {
    activeSignInInFlight = false;
  }
}

export function subscribeAuthSession(
  onSession: (session: Session | null) => void,
  onAuthError?: (message: string) => void,
): () => void {
  return onAuthStateChanged(auth, async (user) => {
    // Do not race active signInWithGoogle() calls
    if (activeSignInInFlight) return;

    // If user is logged in via Email+Username+Password credentials, ignore Firebase null events
    if (currentSession?.authType === 'credentials') return;

    if (!user) {
      if (currentSession?.authType === 'google') {
        saveClientSession(null);
        onSession(null);
      }
      return;
    }

    // Enforce 20-minute idle timeout on mobile; desktop stays logged in until explicit logout
    const stored = readStoredSession();
    const mobile = isMobileDevice();
    if (mobile && (!stored || isIdleExpired())) {
      saveClientSession(null);
      await signOut(auth).catch(() => {});
      onSession(null);
      return;
    }

    try {
      const token = await user.getIdToken();
      if (stored && stored.authType === 'google') {
        updateStoredToken(token);
        onSession({ ...stored, token });
        return;
      }
      const sess = await fetchBackendSession(token);
      sess.deviceType = getDeviceType();
      saveClientSession(sess);
      onSession(sess);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        saveClientSession(null);
        await signOut(auth).catch(() => {});
        onSession(null);
      }
      if (onAuthError && err instanceof Error) {
        onAuthError(err.message);
      }
    }
  });
}

export async function signOutAccount(): Promise<void> {
  saveClientSession(null);
  if (auth.currentUser) {
    await signOut(auth).catch(() => {});
  }
}

export async function callApi<T = unknown>(
  action: string,
  data: Record<string, unknown> = {},
  session: Session | null = null,
): Promise<T> {
  const isRead = /^(get|report|dashboard|list|export)/.test(action);
  const maxRetries = isRead ? 2 : 0;

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const token = await getFreshIdToken(attempt > 0, session);
      const res = await fetch('/api/pos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action, data }),
        signal: controller.signal,
      });

      notifyNetworkStatus(true);

      const refreshedHeader = res.headers.get('X-Refreshed-Token');
      if (refreshedHeader) {
        updateStoredToken(refreshedHeader);
      }

      const payload = (await res.json().catch(() => ({}))) as {
        data?: T;
        error?: string;
      };

      if (res.status === 401) {
        // For Google auth on first attempt, try one forced token refresh before expiring
        if (attempt === 0 && auth.currentUser && !token.startsWith('sp.')) {
          continue;
        }
        expireClientSession(payload.error || 'Sesi berakhir, silakan login ulang.');
      }

      if (!res.ok) {
        const apiErr = new Error(
          payload.error || 'Terjadi kesalahan pada server.',
        ) as Error & { fatal?: boolean };
        apiErr.fatal = true;
        throw apiErr;
      }

      touchUserActivity();
      return payload.data as T;
    } catch (e) {
      const err = e as Error & { fatal?: boolean; net?: boolean };
      if (err instanceof FatalClientError || err.fatal) throw err;
      if (attempt >= maxRetries) {
        notifyNetworkStatus(false);
        const netErr = new Error(
          err.name === 'AbortError'
            ? 'Waktu koneksi habis, periksa internet Anda.'
            : err.message || 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.',
        ) as Error & { net?: boolean };
        netErr.net = true;
        throw netErr;
      }
      await new Promise((r) => setTimeout(r, 450));
    } finally {
      clearTimeout(timer);
    }
  }
}
