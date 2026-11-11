'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useState } from 'react';
import { apiFetch, errorMessage } from '@/lib/api';

export default function AccountPage() {
  const { data: session, status } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'loading') return <p>Loading...</p>;
  if (!session) {
    return (
      <div className="centered">
        <p>You must be logged in.</p>
        <Link href="/login">Go to login</Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setMessage({ ok: false, text: 'The new passwords do not match.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await apiFetch('/auth/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    setBusy(false);
    if (res.ok) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage({ ok: true, text: 'Password changed.' });
    } else {
      setMessage({ ok: false, text: await errorMessage(res) });
    }
  }

  const { user } = session;
  return (
    <div>
      <h1>Account</h1>
      <dl className="details">
        <dt>Name</dt>
        <dd>{user.name ?? '-'}</dd>
        <dt>E-mail</dt>
        <dd>{user.email}</dd>
        <dt>Role</dt>
        <dd>{user.role === 'ADMIN' ? 'Administrator' : 'User'}</dd>
      </dl>

      <h2>Change password</h2>
      <form onSubmit={submit} className="form">
        <label>
          Current password
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label>
          New password <small>(at least 8 characters)</small>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
        </label>
        <label>
          Confirm new password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required />
        </label>
        {message && (
          <p role="alert" className={message.ok ? 'success' : 'error'}>{message.text}</p>
        )}
        <button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Change password'}</button>
      </form>
    </div>
  );
}
