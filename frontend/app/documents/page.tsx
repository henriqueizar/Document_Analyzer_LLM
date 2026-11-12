'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { apiFetch, errorMessage } from '@/lib/api';

type Status = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

interface DocumentSummary {
  id: string;
  originalName: string;
  status: Status;
  explanationStatus: Status | null;
  createdAt: string;
}

function statusLabel(d: DocumentSummary): string {
  if (d.status === 'PENDING') return 'In the queue';
  if (d.status === 'PROCESSING') return 'Reading';
  if (d.status === 'FAILED') return 'Could not be read';
  if (d.explanationStatus === 'PENDING' || d.explanationStatus === 'PROCESSING') return 'Writing explanation';
  if (d.explanationStatus === 'FAILED') return 'Ready (no explanation)';
  return 'Ready';
}

const inProgress = (d: DocumentSummary) =>
  d.status === 'PENDING' ||
  d.status === 'PROCESSING' ||
  d.explanationStatus === 'PENDING' ||
  d.explanationStatus === 'PROCESSING';

async function fetchDocuments(): Promise<DocumentSummary[]> {
  const res = await apiFetch('/documents');
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export default function DocumentsListPage() {
  const { data: session, status } = useSession();
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const email = session?.user?.email;
  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    fetchDocuments().then(
      (list) => !cancelled && setDocs(list),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [email]);

  // Documents are processed in the background: refresh while any is in progress.
  const busy = docs?.some(inProgress) ?? false;
  useEffect(() => {
    if (!busy) return;
    const interval = setInterval(() => fetchDocuments().then(setDocs, () => undefined), 3000);
    return () => clearInterval(interval);
  }, [busy]);

  if (status === 'loading') return <p>Loading session...</p>;
  if (!session) {
    return (
      <div className="centered">
        <p>You must be logged in to see your documents.</p>
        <Link href="/login">Go to login</Link>
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
          <span>{statusLabel(doc)}</span>
          <small>{new Date(doc.createdAt).toLocaleString()}</small>
        </Link>
      ))}
    </div>
  );
}
