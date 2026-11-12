'use client';

import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { API_URL, errorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/** First run: create the administrator account. */
export default function SetupPage() {
  const router = useRouter();
  const { t, server, language } = useI18n();
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
      setError(t('setup.mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, language }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const login = await signIn('credentials', { email, password, redirect: false });
      router.replace(login?.ok ? '/' : '/login');
    } catch (err) {
      setError(err instanceof Error ? server(err.message) : t('setup.failed'));
      setBusy(false);
    }
  }

  if (checking) return <p>{t('common.loading')}</p>;

  return (
    <div className="centered">
      <h1>{t('setup.title')}</h1>
      <p>{t('setup.subtitle')}</p>
      <small className="hint">
        {t('setup.hint')}
      </small>
      <form onSubmit={submit} className="form">
        <label>
          {t('common.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required autoFocus />
        </label>
        <label>
          {t('common.email')}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          {t('common.password')} <small>{t('common.atLeast8')}</small>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
        </label>
        <label>
          {t('setup.confirm')}
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? t('setup.submitting') : t('setup.submit')}</button>
      </form>
    </div>
  );
}
