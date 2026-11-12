'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch, errorMessage } from '@/lib/api';
import LoadingDots from '../loading-dots';
import { useI18n, type MessageKey } from '@/lib/i18n';

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

function validate(file: File): { key: MessageKey; vars?: Record<string, string> } | null {
  if (!SUPPORTED.test(file.name)) return { key: 'upload.unsupported' };
  if (file.size > MAX_BYTES) return { key: 'upload.tooLarge', vars: { size: formatSize(file.size) } };
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
  const { t, server } = useI18n();

  const busy = phase !== 'idle';

  if (status === 'loading') {
    return <p>{t('common.loadingSession')}</p>;
  }

  if (!session) {
    return (
      <div className="centered">
        <p>{t('upload.mustLogin')}</p>
        <Link href="/login">{t('common.goToLogin')}</Link>
      </div>
    );
  }

  function choose(selected: File | undefined) {
    if (!selected) return;
    setDocId(null);
    const problem = validate(selected);
    if (problem) {
      setFile(null);
      setMessage(t(problem.key, problem.vars));
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
      setMessage(t('common.error', { message: err instanceof Error ? server(err.message) : t('common.requestFailed') }));
      setPhase('idle');
    }
  }

  const label = phase === 'uploading' ? t('upload.uploading') : t('upload.submit');

  return (
    <div className="centered">
      <h1>{t('upload.title')}</h1>

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
          {file ? t('upload.change') : t('upload.select')}
        </label>
        <small>{t('upload.hint')}</small>

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
            {t('upload.selected')} <strong>{file.name}</strong> ({formatSize(file.size)})
          </p>
        )}

        <button type="submit" disabled={!file || busy}>
          {label}
          {busy && <LoadingDots />}
        </button>
        <small>{t('upload.background')}</small>
      </form>

      {message && <p role="alert">{message}</p>}
      {docId && !busy && <Link href={`/documents/${docId}`}>{t('upload.open')}</Link>}
    </div>
  );
}
