'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, errorMessage } from '@/lib/api';

interface Interaction {
  id: string;
  role: 'EXPLANATION' | 'QUESTION';
  question: string;
  answer: string;
}

interface DocumentData {
  document: { id: string; originalName: string; status: string };
  interactions: Interaction[];
}

const IMAGE_NAME = /\.(png|jpe?g|webp|bmp|tiff?)$/i;
const PDF_NAME = /\.pdf$/i;

type PreviewKind = 'image' | 'pdf';

function previewKind(name: string): PreviewKind | null {
  if (IMAGE_NAME.test(name)) return 'image';
  if (PDF_NAME.test(name)) return 'pdf';
  return null;
}

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DocumentData | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/documents/${id}`);
    if (!res.ok) throw new Error(await errorMessage(res));
    setData(await res.json());
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

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

  async function askQuestion() {
    if (!question.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/documents/${id}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      await load();
      setQuestion('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  if (error && !data) return <p>Error: {error}</p>;
  if (!data) return <p>Loading...</p>;

  const { document, interactions } = data;

  return (
    <div>
      <h1>{document.originalName}</h1>

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
      <h2><strong>Chat</strong></h2>
      {interactions
        .filter((i) => i.role === 'QUESTION')
        .map((i) => (
          <div key={i.id}>
            <p><strong>You:</strong> {i.question}</p>
            <p className="llm-text"><strong>LLM:</strong> {i.answer}</p>
          </div>
        ))}

      <hr />

      {/* Input */}
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask something about the document..."
        style={{ width: '80%' }}
      />
      <button onClick={askQuestion} disabled={loading}>
        {loading ? 'Thinking...' : 'Send'}
      </button>
      {error && <p style={{ color: 'crimson' }}>Error: {error}</p>}
    </div>
  );
}
