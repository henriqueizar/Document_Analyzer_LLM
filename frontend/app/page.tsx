'use client';

import { signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  // First visit after signing in: show the privacy notice once.
  const email = session?.user.email;
  useEffect(() => {
    if (!email) return;
    apiFetch('/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { privacyAcceptedAt: string | null } | null) => {
        if (me && !me.privacyAcceptedAt) router.replace('/privacy');
      })
      .catch(() => undefined);
  }, [email, router]);

  if (!session) return <p>{t('common.loading')}</p>;

  const { user } = session;
  const isAdmin = user.role === 'ADMIN';

  return (
    <div className="centered">
      <h1>{t('app.title')}</h1>
      <p>
        {t('home.hello', { name: user.name ?? user.email ?? '' })}
        {isAdmin && <span className="badge">{t('role.admin')}</span>}
      </p>
      <div className="button-row">
        <Link href="/upload" className="button-link">{t('home.upload')}</Link>
        <Link href="/documents" className="button-link">{t('home.documents')}</Link>
      </div>
      <div className="button-row">
        {isAdmin && <Link href="/users" className="button-link">{t('home.users')}</Link>}
        {isAdmin && <Link href="/admin" className="button-link">{t('home.panel')}</Link>}
        <Link href="/account" className="button-link">{t('home.account')}</Link>
        <button onClick={() => signOut({ callbackUrl: '/login' })}>{t('home.logout')}</button>
      </div>
    </div>
  );
}
