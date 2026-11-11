'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch, errorMessage } from '@/lib/api';

interface User {
  id: string;
  name: string | null;
  email: string;
  role: 'ADMIN' | 'USER';
  createdAt: string;
  active: boolean;
}

async function fetchUsers(): Promise<User[]> {
  const res = await apiFetch('/users');
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export default function UsersPage() {
  const { data: session, status } = useSession();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = session?.user.role === 'ADMIN';
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    fetchUsers().then(
      (list) => !cancelled && setUsers(list),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  if (status === 'loading') return <p>Loading...</p>;
  if (!session) {
    return (
      <div className="centered">
        <p>You must be logged in.</p>
        <Link href="/login">Go to login</Link>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="centered">
        <p>Only administrators can manage users.</p>
        <Link href="/">Back to home</Link>
      </div>
    );
  }

  const reload = () => fetchUsers().then(setUsers, (e: Error) => setError(e.message));

  return (
    <div>
      <h1>Users</h1>
      <p>
        People who can sign in to this installation. Each user only sees their own documents.
      </p>

      {error && <p role="alert" className="error">Error: {error}</p>}
      {!users && !error && <p>Loading...</p>}
      {users?.map((u) => (
        <UserRow key={u.id} user={u} isMe={u.email === session.user.email} onChanged={reload} />
      ))}

      <h2>Add user</h2>
      <AddUserForm onAdded={reload} />
    </div>
  );
}

function UserRow({ user, isMe, onChanged }: { user: User; isMe: boolean; onChanged: () => void }) {
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiFetch(`/users/${user.id}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setMessage({ ok: true, text: `New password set. Give it to ${user.name ?? user.email}.` });
      setPassword('');
      setResetting(false);
      onChanged();
    } else {
      setMessage({ ok: false, text: await errorMessage(res) });
    }
  }

  return (
    <div className="user-row">
      <div>
        <strong>{user.name ?? user.email}</strong>
        {isMe && <span className="badge">You</span>}
        {user.role === 'ADMIN' && <span className="badge">Administrator</span>}
        {!user.active && <span className="badge badge-warn">No password yet</span>}
        {user.name && (
          <>
            <br />
            <small>{user.email}</small>
          </>
        )}
      </div>
      {!isMe && !resetting && (
        <button type="button" onClick={() => setResetting(true)}>
          {user.active ? 'Reset password' : 'Set password'}
        </button>
      )}
      {resetting && (
        <form onSubmit={reset} className="inline-form">
          <input
            type="password"
            placeholder="New password (8+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            autoFocus
          />
          <button type="submit">Save</button>
          <button type="button" onClick={() => setResetting(false)}>Cancel</button>
        </form>
      )}
      {message && (
        <p role="alert" className={message.ok ? 'success' : 'error'}>{message.text}</p>
      )}
    </div>
  );
}

function AddUserForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'USER' | 'ADMIN'>('USER');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await apiFetch('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role }),
    });
    setBusy(false);
    if (res.ok) {
      setMessage({ ok: true, text: `${name} can now sign in with ${email} and the password you chose.` });
      setName('');
      setEmail('');
      setPassword('');
      setRole('USER');
      onAdded();
    } else {
      setMessage({ ok: false, text: await errorMessage(res) });
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        E-mail
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Initial password <small>(at least 8 characters; they can change it under Account)</small>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
      </label>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as 'USER' | 'ADMIN')}>
          <option value="USER">User: uploads and queries their own documents</option>
          <option value="ADMIN">Administrator: also manages users</option>
        </select>
      </label>
      {message && <p role="alert" className={message.ok ? 'success' : 'error'}>{message.text}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Adding...' : 'Add user'}</button>
    </form>
  );
}
