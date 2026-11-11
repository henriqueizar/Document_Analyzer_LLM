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

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DocumentData | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
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
  // and show it through an object URL.
  const isImage = data ? IMAGE_NAME.test(data.document.originalName) : false;
  useEffect(() => {
    if (!isImage) return;
    let url: string | null = null;
    apiFetch(`/documents/${id}/file`)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('preview failed'))))
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setImageUrl(url);
      })
      .catch((e) => console.error(e));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, isImage]);

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

      {/* Image */}
      {imageUrl && (
        <div style={{ marginBottom: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL, not optimizable */}
          <img
            src={imageUrl}
            style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #ddd' }}
            alt="Preview"
          />
        </div>
      )}

      {/* Explanation */}
      <h2><strong>Explanation</strong></h2>
      {interactions
        .filter((i) => i.role === 'EXPLANATION')
        .map((i) => (
          <p key={i.id}>{i.answer}</p>
        ))}

      <hr />

      {/* Chat: question and answer */}
      <h2><strong>Chat</strong></h2>
      {interactions
        .filter((i) => i.role === 'QUESTION')
        .map((i) => (
          <div key={i.id}>
            <p><strong>You:</strong> {i.question}</p>
            <p><strong>LLM:</strong> {i.answer}</p>
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
