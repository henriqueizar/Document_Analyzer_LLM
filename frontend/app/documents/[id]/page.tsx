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
  // Se o filePath já tem "uploads", não coloque de novo na URL
const cleanPath = document.filePath.replace(/\\/g, '/');

const imageUrl = `http://localhost:3000/${cleanPath}`;
  const isImage = /\.(png|jpg|jpeg|webp)$/i.test(document.originalName);

  return (
    <div style={{ maxWidth: 800, margin: 'auto', padding: 24 }}>
      <h1>{document.originalName}</h1>

      {/*Imagem */}
      {isImage && (
        <div style={{ marginBottom: 24 }}>
          <img
            src={imageUrl}
            style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #ddd' }}
            alt="Preview"
            onError={(e) => {
              console.error("Tentativa de carregamento falhou:", imageUrl);
              if (!imageUrl.includes('uploads/uploads')) {
                 console.log("Caminho parece OK, erro pode ser no Servidor Estático");
              }
            }}
          />
        </div>
      )}
      

      {/* Explicaçao */}
      <h2><strong>Explanation</strong></h2>
      {interactions
        .filter((i: any) => i.role === 'EXPLANATION')
        .map((i: any) => (
          <p key={i.id}>{i.answer}</p>
        ))}

      <hr />

      {/* Chat pergunta e resposta */}
      <h2><strong>Chat</strong></h2>
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
