'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useState, useEffect } from 'react';

// No seu componente de Upload:


export default function UploadPage() {
  const { data: session, status } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [dots, setDots] = useState('');

  const [docId, setdocId] = useState<string | null>(null);

  useEffect(() => { //Upload... animation
  let interval: NodeJS.Timeout;
  
  if (loading) {
    interval = setInterval(() => {
      setDots((prev) => (prev.length < 3 ? prev + '.' : ''));
    }, 500); // Velocidade da animação (500ms)
  } else {
    setDots('');
  }

  return () => clearInterval(interval);
}, [loading]);

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
    if (!session?.user?.email) {
      setMessage('User not authenticated.');
      return;
    }

    const uploadRes = await fetch('http://localhost:3000/documents/upload', {
      method: 'POST',
      headers: {
        'user-id': session.user.email,
      },
      body: formData,
    });
    
    if (!uploadRes.ok) throw new Error('Upload failed');

    const document = await uploadRes.json();

    setdocId(document.id);

    const processRes = await fetch(`http://localhost:3000/documents/${document.id}/process`, {
      method: 'POST',
    });
    if (!processRes.ok) throw new Error('Processing failed');
    
    setMessage(`Upload successful! Document ID: ${document.id}`);
  } catch (err) {
    console.error(err);
    setMessage('Error uploading document.');
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
    <main className="flex min-h-screen flex-col items-center text-center justify-center p-24">
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

  <button type="submit" disabled={loading} className="w-40 h-12 flex items-center justify-center rounded-md">
    <span className="flex">
    {loading ? 'Uploading' : 'Upload'}
    {loading && (
      <span className="w-6 text-left inline-block">{dots}</span>
    )}
  </span>
  </button>
  {docId && !loading &&(
      <Link href={`/documents/${docId}`}>
        <button type="button" style={{ marginLeft: '10px' }}>Analyze (LLM)</button>
      </Link>
  )}
</form>

      

      {message && <p>{message}</p>}
    </div>
    </main>
  );
}
