import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

type AccessState = 'checking' | 'locked' | 'unconfigured' | 'authenticated';

interface AuthGateProps {
  children: ReactNode;
}

export default function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<AccessState>('checking');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function checkSession() {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
      const result = await response.json();
      if (!result.configured) {
        setState('unconfigured');
        return;
      }
      setState(result.authenticated ? 'authenticated' : 'locked');
    } catch {
      setError('Could not reach the authentication endpoint. Check the server connection.');
      setState('locked');
    }
  }

  useEffect(() => {
    void checkSession();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ password }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || 'Authentication failed.');
        return;
      }
      setPassword('');
      setState('authenticated');
    } catch {
      setError('Could not complete sign-in because the server is unreachable.');
    }
  }

  async function signOut() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      setState('locked');
      setPassword('');
    }
  }

  if (state === 'authenticated') {
    return (
      <>
        {children}
        <button
          type="button"
          onClick={() => void signOut()}
          className="fixed right-3 top-3 z-[1000] rounded-lg border border-white/20 bg-black/70 px-3 py-2 text-xs font-medium text-white shadow-lg backdrop-blur"
          aria-label="Sign out of owner session"
        >
          Sign out
        </button>
      </>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-7 shadow-2xl">
        <h1 className="text-xl font-semibold tracking-tight">Owner sign-in</h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Sign in to access the TwinMind AI workspace and its private data.
        </p>
        {state === 'checking' ? (
          <p className="mt-6 text-sm text-slate-300">Checking owner session…</p>
        ) : state === 'unconfigured' ? (
          <div className="mt-5 rounded-lg border border-amber-500/40 bg-amber-950/30 p-4 text-sm leading-6 text-amber-100">
            Owner authentication is not configured. Set <code>APP_AUTH_PASSWORD</code> to a password with at least 16 characters and <code>APP_AUTH_SECRET</code> to a secret with at least 32 characters, then restart the server.
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-sm font-medium" htmlFor="owner-password">Owner password</label>
            <input
              id="owner-password"
              type="password"
              autoComplete="current-password"
              required
              minLength={1}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400"
            />
            {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
            <button type="submit" className="w-full rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400">
              Sign in
            </button>
          </form>
        )}
        {error && state === 'locked' ? <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p> : null}
      </section>
    </main>
  );
}
