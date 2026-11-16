import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail, User } from 'lucide-react';
import { LOGO_DATA_URI, STORE_NAME } from '../constants/branding';
import {
  getAuthStatus,
  hasCachedAuthInitialized,
  loginWithCredentials,
  setupInitialAccount,
} from '../services/api';
import type { Session } from '../types/pos';

interface LoginPageProps {
  onSuccess: (session: Session) => void;
}

export function LoginPage({ onSuccess }: LoginPageProps) {
  const [initialized, setInitialized] = useState<boolean | null>(() =>
    hasCachedAuthInitialized() ? true : null,
  );
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const usernameRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    getAuthStatus().then((isInit) => {
      if (active) setInitialized(isInit);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isSetupMode = initialized === false;
    const cleanEmail = email.trim().toLowerCase();
    const cleanUser = username.trim().toLowerCase();
    const cleanPass = password.trim();

    if (isSetupMode && (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))) {
      setError('Masukkan email yang valid untuk pendaftaran awal.');
      return;
    }
    if (!cleanUser) {
      setError('Username wajib diisi.');
      usernameRef.current?.focus();
      return;
    }
    if (cleanPass.length < 4) {
      setError('Password minimal 4 karakter.');
      passwordRef.current?.focus();
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      const session = isSetupMode
        ? await setupInitialAccount({
            email: cleanEmail,
            username: cleanUser,
            password: cleanPass,
          })
        : await loginWithCredentials({
            username: cleanUser,
            password: cleanPass,
          });
      onSuccess(session);
    } catch (err) {
      setError((err as Error).message || 'Username atau password salah.');
      setSubmitting(false);
    }
  };

  const isSetupMode = initialized === false;

  return (
    <div className="relative min-h-dvh flex items-center justify-center p-4 sm:p-6 bg-zinc-100 dark:bg-zinc-950 overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(220,38,38,0.10),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(24,24,27,0.08),transparent_50%)] dark:bg-[radial-gradient(ellipse_at_top_right,rgba(220,38,38,0.18),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(190,18,60,0.12),transparent_50%)]"
      />

      <div className="relative w-full max-w-md rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-2xl shadow-zinc-950/10 dark:shadow-black/50 p-5 sm:p-6 transition-all duration-200">
        <div className="relative rounded-2xl bg-zinc-950 px-4 py-3.5 mb-5 flex items-center gap-3.5 overflow-hidden border border-zinc-800/80">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-6 -top-8 w-36 h-36 rounded-full bg-red-600/20 blur-2xl"
          />
          <img
            src={LOGO_DATA_URI}
            alt={STORE_NAME}
            className="relative w-12 h-12 object-contain shrink-0 drop-shadow-md"
          />
          <div className="relative min-w-0">
            <div className="text-lg font-extrabold tracking-tight text-white leading-tight">
              SAHABAT
            </div>
            <p className="text-[11px] font-medium text-zinc-400 tracking-wide">
              Accessories &amp; Service · Kasir Web
            </p>
          </div>
        </div>

        {initialized === null ? (
          <div className="py-10 flex flex-col items-center justify-center gap-2.5 text-zinc-500 dark:text-zinc-400">
            <Loader2 className="w-6 h-6 animate-spin text-red-600" />
            <span className="text-xs font-medium">Memuat...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
            {isSetupMode && (
              <div className="pb-1">
                <h1 className="text-sm font-bold text-zinc-900 dark:text-white">
                  Pendaftaran Awal Owner
                </h1>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Hanya tampil satu kali di awal pendaftaran.
                </p>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-xs sm:text-sm font-semibold text-rose-700 dark:text-rose-300 flex items-start gap-2 leading-snug"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {isSetupMode && (
              <div>
                <label
                  htmlFor="login-email"
                  className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1"
                >
                  Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={submitting}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError('');
                    }}
                    placeholder="email@gmail.com"
                    className="w-full min-h-[44px] pl-10 pr-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-transparent transition-shadow"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="login-username"
                className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1"
              >
                Username
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={usernameRef}
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus={!isSetupMode}
                  disabled={submitting}
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="Masukkan username"
                  className="w-full min-h-[44px] pl-10 pr-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-transparent transition-shadow"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={passwordRef}
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isSetupMode ? 'new-password' : 'current-password'}
                  minLength={4}
                  disabled={submitting}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="Masukkan password"
                  className="w-full min-h-[44px] pl-10 pr-11 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-transparent transition-shadow"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[46px] rounded-xl bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-700 hover:to-rose-800 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-md shadow-red-600/20 transition-all active:scale-[0.99] disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{isSetupMode ? 'Mendaftarkan...' : 'Masuk...'}</span>
                </>
              ) : (
                <span>{isSetupMode ? 'Daftar & Masuk' : 'Masuk'}</span>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
