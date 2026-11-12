'use client';

import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { API_URL } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useSession();
  const { t, server } = useI18n();
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
          ? server(res.error)
          : server('Incorrect e-mail or password.'),
      );
    }
  }

  return (
    <div className="centered">
      <h1>{t('app.title')}</h1>
      <p>{t('login.subtitle')}</p>
      <form onSubmit={submit} className="form">
        <label>
          {t('common.email')}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
        </label>
        <label>
          {t('common.password')}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? t('login.submitting') : t('login.submit')}</button>
      </form>
      <small>{t('login.forgot')}</small>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p>...</p>}>
      <LoginForm />
    </Suspense>
  );
}
