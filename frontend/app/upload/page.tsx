'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch, errorMessage } from '@/lib/api';
import LoadingDots from '../loading-dots';

// Must match backend/src/common/supported-files.ts and the upload size limit.
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff';
const SUPPORTED = /\.(pdf|png|jpe?g|webp|bmp|tiff?)$/i;
const MAX_BYTES = 20 * 1024 * 1024;

type Phase = 'idle' | 'uploading';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validate(file: File): string | null {
  if (!SUPPORTED.test(file.name)) {
    return 'Unsupported file type. Choose a PDF or an image (png, jpg, webp, bmp, tiff).';
  }
  if (file.size > MAX_BYTES) {
    return `File is too large (${formatSize(file.size)}). The limit is 20 MB.`;
  }
  return null;
}

export default function UploadPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const busy = phase !== 'idle';

  if (status === 'loading') {
    return <p>Loading session...</p>;
  }

  if (!session) {
    return (
      <div className="centered">
        <p>You must be logged in to upload documents.</p>
        <Link href="/login">Go to login</Link>
      </div>
    );
  }

  function choose(selected: File | undefined) {
    if (!selected) return;
    setDocId(null);
    const problem = validate(selected);
    if (problem) {
      setFile(null);
      setMessage(problem);
      return;
    }
    setFile(selected);
    setMessage(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;

    setMessage(null);
    setPhase('uploading');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const uploadRes = await apiFetch('/documents/upload', {
        method: 'POST',
        body: formData,
      });
      if (!uploadRes.ok) throw new Error(await errorMessage(uploadRes));
      const uploadedId = (await uploadRes.json()).id as string;
      setDocId(uploadedId);

      // Reading and explaining run in the background; the document page shows progress.
      router.push(`/documents/${uploadedId}`);
    } catch (err) {
      console.error(err);
      setMessage(`Error: ${err instanceof Error ? err.message : 'upload failed'}`);
      setPhase('idle');
    }
  }

  const label = phase === 'uploading' ? 'Uploading' : 'Upload';

  return (
    <div className="centered">
      <h1>Upload Document</h1>

      <form onSubmit={handleSubmit} className="stack">
        <label
          htmlFor="file-upload"
          className={`upload-button${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy) choose(e.dataTransfer.files[0]);
          }}
        >
          {file ? 'Change file' : 'Select file'}
        </label>
        <small>Choose or drag your PDF/image here (max. 20MB)</small>

        <input
          id="file-upload"
          type="file"
          accept={ACCEPT}
          disabled={busy}
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = ''; // allow choosing the same file again
          }}
          style={{ display: 'none' }}
        />

        {file && (
          <p>
            Selected: <strong>{file.name}</strong> ({formatSize(file.size)})
          </p>
        )}

        <button type="submit" disabled={!file || busy}>
          {label}
          {busy && <LoadingDots />}
        </button>
        <small>After uploading, the document opens and is read in the background.</small>
      </form>

      {message && <p role="alert">{message}</p>}
      {docId && !busy && <Link href={`/documents/${docId}`}>Open the document</Link>}
    </div>
  );
}
