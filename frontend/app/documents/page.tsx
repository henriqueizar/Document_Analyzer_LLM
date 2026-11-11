'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { apiFetch } from '@/lib/api';

interface DocumentSummary {
  id: string;
  originalName: string;
  status: string;
  createdAt: string;
}

export default function DocumentsListPage() {
  const { data: session } = useSession();
  const [docs, setDocs] = useState<DocumentSummary[]>([]);

  useEffect(() => {
  if (!session?.user?.email) return;

  apiFetch('/documents')
    .then(res => res.json())
    .then(data => {
  const docsArray =
    Array.isArray(data) ? data :
    Array.isArray(data.documents) ? data.documents :
    Array.isArray(data.data) ? data.data :
    [];

  setDocs(docsArray);
});
}, [session]);

  return (
    <div>
      <h2>My documents</h2>

      {docs.map(doc => (
        <Link
          key={doc.id}
          href={`/documents/${doc.id}`}
          style={{
            display: 'block',
            padding: 12,
            borderBottom: '1px solid #ddd',
          }}
        >
          <strong>{doc.originalName}</strong>
          <div>Status: {doc.status}</div>
          <small>{new Date(doc.createdAt).toLocaleString()}</small>
        </Link>
      ))}
    </div>
  );
}
