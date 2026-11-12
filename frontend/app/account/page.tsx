'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useState } from 'react';
import { apiFetch, errorMessage } from '@/lib/api';
import { useI18n, type Language } from '@/lib/i18n';

export default function AccountPage() {
  const { data: session, status } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { t, server, language, setLanguage } = useI18n();
  const [languageMessage, setLanguageMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (status === 'loading') return <p>{t('common.loading')}</p>;
  if (!session) {
    return (
      <div className="centered">
        <p>{t('common.mustLogin')}</p>
        <Link href="/login">{t('common.goToLogin')}</Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setMessage({ ok: false, text: t('account.mismatch') });
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
      setMessage({ ok: true, text: t('account.changed') });
    } else {
      setMessage({ ok: false, text: server(await errorMessage(res)) });
    }
  }

  async function changeLanguage(next: Language) {
    setLanguageMessage(null);
    try {
      await setLanguage(next);
      // the confirmation is shown in the language just chosen
      setLanguageMessage({ ok: true, text: next === 'pt' ? 'Idioma alterado.' : 'Language changed.' });
    } catch (err) {
      setLanguageMessage({ ok: false, text: err instanceof Error ? server(err.message) : t('common.requestFailed') });
    }
  }

  const { user } = session;
  return (
    <div>
      <h1>{t('account.title')}</h1>
      <dl className="details">
        <dt>{t('common.name')}</dt>
        <dd>{user.name ?? '-'}</dd>
        <dt>{t('common.email')}</dt>
        <dd>{user.email}</dd>
        <dt>{t('account.role')}</dt>
        <dd>{user.role === 'ADMIN' ? t('role.admin') : t('role.user')}</dd>
      </dl>

      <h2>{t('account.language')}</h2>
      <div className="form">
        <select
          value={language}
          onChange={(e) => changeLanguage(e.target.value as Language)}
          aria-label={t('account.language')}
        >
          <option value="pt">Português</option>
          <option value="en">English</option>
        </select>
        <small className="hint">{t('account.languageHint')}</small>
        {languageMessage && (
          <p role="status" className={languageMessage.ok ? 'success' : 'error'}>{languageMessage.text}</p>
        )}
      </div>

      <h2>{t('account.changePassword')}</h2>
      <form onSubmit={submit} className="form">
        <label>
          {t('account.current')}
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label>
          {t('account.new')} <small>{t('common.atLeast8')}</small>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
        </label>
        <label>
          {t('account.confirmNew')}
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required />
        </label>
        {message && (
          <p role="alert" className={message.ok ? 'success' : 'error'}>{message.text}</p>
        )}
        <button type="submit" disabled={busy}>{busy ? t('account.saving') : t('account.changePassword')}</button>
      </form>
    </div>
  );
}
