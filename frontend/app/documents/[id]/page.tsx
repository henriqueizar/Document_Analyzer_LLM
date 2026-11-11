'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, errorMessage } from '@/lib/api';

interface Interaction {
  id: string;
  role: 'EXPLANATION' | 'QUESTION';
  question: string;
  answer: string;
}

type Status = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

interface DocumentData {
  document: { id: string; originalName: string; status: Status };
  interactions: Interaction[];
}

const IMAGE_NAME = /\.(png|jpe?g|webp|bmp|tiff?)$/i;
const PDF_NAME = /\.pdf$/i;
const POLL_MS = 3000;

type PreviewKind = 'image' | 'pdf';

function previewKind(name: string): PreviewKind | null {
  if (IMAGE_NAME.test(name)) return 'image';
  if (PDF_NAME.test(name)) return 'pdf';
  return null;
}

async function fetchDocument(id: string): Promise<DocumentData> {
  const res = await apiFetch(`/documents/${id}`);
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DocumentData | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    fetchDocument(id).then(
      (doc) => !cancelled && setData(doc),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  // While the backend is processing (e.g. started from another tab), refresh
  // until it finishes.
  const status = data?.document.status;
  useEffect(() => {
    if (status !== 'PROCESSING') return;
    const interval = setInterval(() => {
      fetchDocument(id).then(setData, () => undefined);
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [id, status]);

  // The file is only served to its owner, so fetch it with the bearer token
  // and show it through an object URL (images inline, PDFs in the browser's
  // built-in viewer).
  const kind = data ? previewKind(data.document.originalName) : null;
  useEffect(() => {
    if (!kind) return;
    let url: string | null = null;
    apiFetch(`/documents/${id}/file`)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('preview failed'))))
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      })
      .catch((e) => console.error(e));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, kind]);

  async function askQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || asking) return;

    setAsking(true);
    setError(null);
    try {
      const res = await apiFetch(`/documents/${id}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      setData(await fetchDocument(id));
      setQuestion('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setAsking(false);
    }
  }

  async function processDocument() {
    setProcessing(true);
    setError(null);
    try {
      const res = await apiFetch(`/documents/${id}/process`, { method: 'POST' });
      if (!res.ok) throw new Error(await errorMessage(res));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed');
    }
    try {
      setData(await fetchDocument(id));
    } finally {
      setProcessing(false);
    }
  }

  if (error && !data) return <p role="alert">Error: {error}</p>;
  if (!data) return <p>Loading...</p>;

  const { document, interactions } = data;
  const ready = document.status === 'COMPLETED';
  const questions = interactions.filter((i) => i.role === 'QUESTION');

  return (
    <div>
      <h1>{document.originalName}</h1>

      {/* Status (only while the document is not ready) */}
      {!ready && (
        <div className="status">
          {document.status === 'PROCESSING' || processing ? (
            <p>Processing (OCR + LLM)... this page updates when it is done.</p>
          ) : document.status === 'FAILED' ? (
            <>
              <p>Processing failed{error ? `: ${error}` : '.'}</p>
              <button type="button" onClick={processDocument}>Retry</button>
            </>
          ) : (
            <>
              <p>This document has not been processed yet.</p>
              <button type="button" onClick={processDocument}>Process now</button>
            </>
          )}
        </div>
      )}

      {/* Preview */}
      {previewUrl && kind === 'image' && (
        <div className="preview">
          {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL, not optimizable */}
          <img src={previewUrl} alt={`Preview of ${document.originalName}`} />
        </div>
      )}
      {previewUrl && kind === 'pdf' && (
        <div className="preview">
          <iframe src={previewUrl} title={`Preview of ${document.originalName}`} />
          <small>
            <a href={previewUrl} target="_blank" rel="noopener noreferrer">
              Open the PDF in a new tab
            </a>
          </small>
        </div>
      )}

      {/* Explanation */}
      {interactions
        .filter((i) => i.role === 'EXPLANATION')
        .map((i) => (
          <p key={i.id} className="llm-text">
            <strong>Explanation:</strong> {i.answer}
          </p>
        ))}

      <hr />

      {/* Chat: question and answer */}
      <h2>Chat</h2>
      {ready && questions.length === 0 && (
        <small>No questions yet. Ask the first one below.</small>
      )}
      {questions.map((i) => (
        <div key={i.id}>
          <p><strong>You:</strong> {i.question}</p>
          <p className="llm-text"><strong>LLM:</strong> {i.answer}</p>
        </div>
      ))}

      <hr />

      {/* Input: Enter sends */}
      <form onSubmit={askQuestion} className="ask-form">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            ready ? 'Ask something about the document...' : 'Available once the document is processed'
          }
          disabled={!ready || asking}
        />
        <button type="submit" disabled={!ready || asking || !question.trim()}>
          {asking ? 'Thinking...' : 'Send'}
        </button>
      </form>
      {error && ready && (
        <p role="alert" className="error">Error: {error}</p>
      )}
    </div>
  );
}
