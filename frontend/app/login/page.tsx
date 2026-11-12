'use client';

import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { API_URL } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in, or first run without an administrator yet.
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/');
      return;
    }
    fetch(`${API_URL}/auth/setup`)
      .then((r) => r.json())
      .then((s: { needsSetup: boolean }) => s.needsSetup && router.replace('/setup'))
      .catch(() => undefined);
  }, [status, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn('credentials', { email, password, redirect: false });
    setBusy(false);
    if (res?.ok) {
      router.replace(params.get('callbackUrl') ?? '/');
    } else {
      setError(
        res?.error && res.error !== 'CredentialsSignin'
          ? res.error
          : 'Incorrect e-mail or password.',
      );
    }
  }

  return (
    <div className="centered">
      <h1>Document LLM Analyzer</h1>
      <p>Sign in with your account.</p>
      <form onSubmit={submit} className="form">
        <label>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
      </form>
      <small>Forgot your password? Ask your administrator to reset it.</small>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <LoginForm />
    </Suspense>
  );
}
