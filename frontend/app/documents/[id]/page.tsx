'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

export default function DocumentPage() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`http://localhost:3000/documents/${id}`)
      .then(res => res.json())
      .then(setData);
  }, [id]);

  async function askQuestion() {
    if (!question.trim()) return;

    setLoading(true);

    await fetch(`http://localhost:3000/documents/${id}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    const updated = await fetch(`http://localhost:3000/documents/${id}`).then(r => r.json());
    setData(updated);
    setQuestion('');
    setLoading(false);
  }

  if (!data) return <p>Loading...</p>;

  const { document, interactions } = data;

  return (
    <div style={{ maxWidth: 800, margin: 'auto', padding: 24 }}>
      <h1>{document.originalName}</h1>

      {/* Imagem */}
      {document.originalName.endsWith('.png') && (
        <img
          src={`http://localhost:3000/${document.filePath}`}
          style={{ maxWidth: '100%', marginBottom: 24 }}
        />
      )}

      {/* Explicaçao */}
      <h2>Explanation</h2>
      {interactions
        .filter((i: any) => i.role === 'EXPLANATION')
        .map((i: any) => (
          <p key={i.id}>{i.answer}</p>
        ))}

      <hr />

      {/* Chat pergunta e resposta */}
      <h2>Chat</h2>
      {interactions
        .filter((i: any) => i.role === 'QUESTION')
        .map((i: any) => (
          <div key={i.id}>
            <p><strong>You:</strong> {i.question}</p>
            <p><strong>LLM:</strong> {i.answer}</p>
          </div>
        ))}

      <hr />

      {/* Input */}
      <input
        value={question}
        onChange={e => setQuestion(e.target.value)}
        placeholder="Ask something about the document..."
        style={{ width: '80%' }}
      />
      <button onClick={askQuestion} disabled={loading}>
        {loading ? 'Thinking...' : 'Send'}
      </button>
    </div>
  );
}
