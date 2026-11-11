'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { apiFetch, errorMessage } from '@/lib/api';

interface DocumentSummary {
  id: string;
  originalName: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
}

const STATUS_LABEL: Record<DocumentSummary['status'], string> = {
  PENDING: 'Not processed',
  PROCESSING: 'Processing',
  COMPLETED: 'Ready',
  FAILED: 'Failed',
};

export default function DocumentsListPage() {
  const { data: session, status } = useSession();
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const email = session?.user?.email;
  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    apiFetch('/documents')
      .then(async (res) => {
        if (!res.ok) throw new Error(await errorMessage(res));
        return res.json() as Promise<DocumentSummary[]>;
      })
      .then(
        (list) => !cancelled && setDocs(list),
        (e: Error) => !cancelled && setError(e.message),
      );
    return () => {
      cancelled = true;
    };
  }, [email]);

  if (status === 'loading') return <p>Loading session...</p>;
  if (!session) {
    return (
      <div className="centered">
        <p>You must be logged in to see your documents.</p>
        <Link href="/">Go to login</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="title-row">
        <h1>My documents</h1>
        <Link href="/upload" className="button-link">Upload document</Link>
      </div>

      {error && <p role="alert" className="error">Error: {error}</p>}
      {!docs && !error && <p>Loading...</p>}
      {docs && docs.length === 0 && (
        <p>
          No documents yet. <Link href="/upload">Upload your first one</Link>.
        </p>
      )}

      {docs?.map((doc) => (
        <Link key={doc.id} href={`/documents/${doc.id}`} className="doc-item">
          <strong>{doc.originalName}</strong>
          <span>{STATUS_LABEL[doc.status] ?? doc.status}</span>
          <small>{new Date(doc.createdAt).toLocaleString()}</small>
        </Link>
      ))}
    </div>
  );
}
