'use client';

import { signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

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

  if (!session) return <p>Loading...</p>;

  const { user } = session;
  const isAdmin = user.role === 'ADMIN';

  return (
    <div className="centered">
      <h1>Document LLM Analyzer</h1>
      <p>
        Hello, {user.name ?? user.email}
        {isAdmin && <span className="badge">Administrator</span>}
      </p>
      <div className="button-row">
        <Link href="/upload" className="button-link">Upload document</Link>
        <Link href="/documents" className="button-link">My documents</Link>
      </div>
      <div className="button-row">
        {isAdmin && <Link href="/users" className="button-link">Users</Link>}
        <Link href="/account" className="button-link">Account</Link>
        <button onClick={() => signOut({ callbackUrl: '/login' })}>Log out</button>
      </div>
    </div>
  );
}
