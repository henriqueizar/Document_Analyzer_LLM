'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useState } from 'react';
import { apiFetch, errorMessage } from '@/lib/api';

export default function UploadPage() {
  const { data: session, status } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [docId, setdocId] = useState<string | null>(null);

  // next-auth loading
  if (status === 'loading') {
    return <p>Loading session...</p>;
  }

  // basic route protection
  if (!session) {
    return <p>You must be logged in to upload documents.</p>;
  }

  async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();

  if (!file) {
    setMessage('Please select a file.');
    return;
  }

  setLoading(true);
  setMessage(null);

  const formData = new FormData();
  formData.append('file', file);

  try {
    const uploadRes = await apiFetch('/documents/upload', {
      method: 'POST',
      body: formData,
    });
    if (!uploadRes.ok) throw new Error(await errorMessage(uploadRes));

    const document = await uploadRes.json();

    setdocId(document.id);

    const processRes = await apiFetch(`/documents/${document.id}/process`, {
      method: 'POST',
    });
    if (!processRes.ok) throw new Error(await errorMessage(processRes));

    setMessage(`Upload successful! Document ID: ${document.id}`);
  } catch (err) {
    console.error(err);
    setMessage(`Error: ${err instanceof Error ? err.message : 'upload failed'}`);
  } finally {
    setLoading(false);
  }
}
function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
  if (e.target.files && e.target.files.length > 0) {
    setFile(e.target.files[0]);
  }
}


  return (
    <div style={{ padding: '2rem' }}>
      <h1>Upload Document</h1>

      <form onSubmit={handleSubmit}>
  <label htmlFor="file-upload" className="upload-button">
    Select File
  </label>

  <input
    id="file-upload"
    type="file"
    onChange={handleFileChange}
    style={{ display: 'none' }}
  />

  <br /><br />

  <button type="submit" disabled={loading}>
    {loading ? 'Uploading...' : 'Upload'}
  </button>
  {docId && !loading &&(
      <Link href={`/documents/${docId}`}>
        <button type="button" style={{ marginLeft: '10px' }}>Analyze (LLM)</button>
      </Link>
  )}
</form>

      

      {message && <p>{message}</p>}
    </div>
  );
}
