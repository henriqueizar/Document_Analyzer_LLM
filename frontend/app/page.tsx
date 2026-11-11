'use client';

import { signIn, signOut, useSession } from 'next-auth/react';
import Link from 'next/link';

export default function Home() {
  const { data: session, status } = useSession();

  if (status === 'loading') return <p>Loading...</p>;

  if (!session) {
    return (
      <div className="centered">
        <h1>Document LLM Analyzer</h1>
        <h2>You are not logged in</h2>
        <button onClick={() => signIn('google')}>
          Login with Google
        </button>
      </div>
    );
  }

  return (//if logged in
    <div className="centered">
      <h1>Document LLM Analyzer</h1>
      <p>Logged in as {session.user?.email}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Link href="/upload">
            <button>Upload document</button>
        </Link>
        <Link href="/documents">
              <button>My documents</button>
        </Link>

      </div>
      <button onClick={() => signOut()}>
        Logout
      </button>
    </div>
  );
}
