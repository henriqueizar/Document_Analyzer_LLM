'use client';

import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { API_URL, errorMessage } from '@/lib/api';

/** First run: create the administrator account. */
export default function SetupPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/auth/setup`)
      .then((r) => r.json())
      .then((s: { needsSetup: boolean }) => (s.needsSetup ? setChecking(false) : router.replace('/login')))
      .catch(() => setChecking(false));
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const login = await signIn('credentials', { email, password, redirect: false });
      router.replace(login?.ok ? '/' : '/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.');
      setBusy(false);
    }
  }

  if (checking) return <p>Loading...</p>;

  return (
    <div className="centered">
      <h1>Welcome</h1>
      <p>Create the administrator account to start.</p>
      <small className="hint">
        Using the app by yourself? This is your account. In a company, the administrator
        adds the other users later, under &quot;Users&quot;.
      </small>
      <form onSubmit={submit} className="form">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required autoFocus />
        </label>
        <label>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Password <small>(at least 8 characters)</small>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
        </label>
        <label>
          Confirm password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create account'}</button>
      </form>
    </div>
  );
}
