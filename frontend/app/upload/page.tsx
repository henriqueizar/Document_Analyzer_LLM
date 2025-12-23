'use client';

import { useSession } from 'next-auth/react';
import { useState } from 'react';

export default function UploadPage() {
  const { data: session, status } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

    const res = await fetch('http://localhost:3000/documents/upload', {
      method: 'POST',
      headers: {
        'user-id': session.user.email,
      },
      body: formData,
    });

    if (!res.ok) throw new Error('Upload failed');

    const data = await res.json();
    setMessage(`Upload successful! Document ID: ${data.id}`);
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
</form>

      

      {message && <p>{message}</p>}
    </div>
  );
}
