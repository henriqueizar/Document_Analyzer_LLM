'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch, errorMessage } from '@/lib/api';
import { useI18n, type Language } from '@/lib/i18n';
import TeamsSection from './teams';

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
  const { t, server } = useI18n();

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

  if (status === 'loading') return <p>{t('common.loading')}</p>;
  if (!session) {
    return (
      <div className="centered">
        <p>{t('common.mustLogin')}</p>
        <Link href="/login">{t('common.goToLogin')}</Link>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="centered">
        <p>{t('users.onlyAdmins')}</p>
        <Link href="/">{t('common.backHome')}</Link>
      </div>
    );
  }

  const reload = () => fetchUsers().then(setUsers, (e: Error) => setError(e.message));

  return (
    <div>
      <h1>{t('users.title')}</h1>
      <p>{t('users.intro')}</p>

      {error && <p role="alert" className="error">{t('common.error', { message: server(error) })}</p>}
      {!users && !error && <p>{t('common.loading')}</p>}
      {users?.map((u) => (
        <UserRow key={u.id} user={u} isMe={u.email === session.user.email} onChanged={reload} />
      ))}

      <h2>{t('users.add')}</h2>
      <AddUserForm onAdded={reload} />

      <hr />
      <TeamsSection users={users ?? []} />
    </div>
  );
}

function UserRow({ user, isMe, onChanged }: { user: User; isMe: boolean; onChanged: () => void }) {
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const { t, server } = useI18n();

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiFetch(`/users/${user.id}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setMessage({ ok: true, text: t('users.passwordSet', { name: user.name ?? user.email }) });
      setPassword('');
      setResetting(false);
      onChanged();
    } else {
      setMessage({ ok: false, text: server(await errorMessage(res)) });
    }
  }

  return (
    <div className="user-row">
      <div>
        <strong>{user.name ?? user.email}</strong>
        {isMe && <span className="badge">{t('users.you')}</span>}
        {user.role === 'ADMIN' && <span className="badge">{t('role.admin')}</span>}
        {!user.active && <span className="badge badge-warn">{t('users.noPassword')}</span>}
        {user.name && (
          <>
            <br />
            <small>{user.email}</small>
          </>
        )}
      </div>
      {!isMe && !resetting && (
        <button type="button" onClick={() => setResetting(true)}>
          {user.active ? t('users.resetPassword') : t('users.setPassword')}
        </button>
      )}
      {resetting && (
        <form onSubmit={reset} className="inline-form">
          <input
            type="password"
            placeholder={t('users.newPasswordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            autoFocus
          />
          <button type="submit">{t('common.save')}</button>
          <button type="button" onClick={() => setResetting(false)}>{t('common.cancel')}</button>
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
  const { t, server, language: myLanguage } = useI18n();
  const [language, setLanguage] = useState<Language>(myLanguage);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await apiFetch('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role, language }),
    });
    setBusy(false);
    if (res.ok) {
      setMessage({ ok: true, text: t('users.added', { name, email }) });
      setName('');
      setEmail('');
      setPassword('');
      setRole('USER');
      onAdded();
    } else {
      setMessage({ ok: false, text: server(await errorMessage(res)) });
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <label>
        {t('common.name')}
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        {t('common.email')}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        {t('users.initialPassword')} <small>{t('users.initialPasswordHint')}</small>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
      </label>
      <label>
        {t('account.role')}
        <select value={role} onChange={(e) => setRole(e.target.value as 'USER' | 'ADMIN')}>
          <option value="USER">{t('users.roleUser')}</option>
          <option value="ADMIN">{t('users.roleAdmin')}</option>
        </select>
      </label>
      <label>
        {t('account.language')}
        <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
          <option value="pt">Português</option>
          <option value="en">English</option>
        </select>
      </label>
      {message && <p role="alert" className={message.ok ? 'success' : 'error'}>{message.text}</p>}
      <button type="submit" disabled={busy}>{busy ? t('users.adding') : t('users.add')}</button>
    </form>
  );
}
