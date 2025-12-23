'use client';

import { signIn, signOut, useSession } from 'next-auth/react';
import Link from 'next/link';

export default function Home() {
  const { data: session, status } = useSession();

  if (status === 'loading') return <p>Carregando...</p>;

  if (!session) {
    return (
      <div>
        <h1>Document LLM Analyzer</h1>
        <h2>You are not logged in</h2>
        <button onClick={() => signIn('google')}>
          Login with Google
        </button>
      </div>
    );
  }

  return (//if logged in
    <div>
      <h1>Document LLM Analyzer</h1>
      <br />
      <p>Logged in as {session.user?.email}</p>
      <Link href="/upload">
            <button>Upload document</button>
      </Link>
      <br /><br />
      <button onClick={() => signOut()}>
        Logout
      </button>
    </div>
  );
}
