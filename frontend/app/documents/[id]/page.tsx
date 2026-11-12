'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch, errorMessage } from '@/lib/api';
import { CitedText, type Source } from './citations';
import LoadingDots from '../../loading-dots';

interface Interaction {
  id: string;
  role: 'EXPLANATION' | 'QUESTION';
  question: string;
  answer: string;
  /** Passages sent to the model (null for answers created before sources were stored). */
  sources: Source[] | null;
  /** STRICT: what the document states. INTERPRETATION: the model's reading, asked for explicitly. */
  mode?: 'STRICT' | 'INTERPRETATION';
}

/** The refusal sentences the backend uses (pt / en). */
const REFUSALS = ['Não encontrei essa informação no documento.', 'I could not find this information in the document.'];

type Status = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

interface DocumentInfo {
  id: string;
  originalName: string;
  /** Reading the document: PENDING = queued, PROCESSING = reading. */
  status: Status;
  failureReason: string | null;
  /** The automatic explanation, tracked apart (null for older documents). */
  explanationStatus: Status | null;
  explanationError: string | null;
}

interface DocumentData {
  document: DocumentInfo;
  interactions: Interaction[];
}

const IN_PROGRESS: (Status | null)[] = ['PENDING', 'PROCESSING'];

function inProgress(d: DocumentInfo): boolean {
  return IN_PROGRESS.includes(d.status) || (d.status === 'COMPLETED' && IN_PROGRESS.includes(d.explanationStatus));
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

/**
 * LLM text with clickable [p. N] citations. The backend appends an automatic
 * grounding warning ("⚠ ...") when it could not verify part of the text
 * against the document; it is shown apart.
 */
function LlmText({
  label,
  interaction,
  onShowPage,
}: {
  label: string;
  interaction: Interaction;
  onShowPage?: (page: number) => void;
}) {
  const text = interaction.answer;
  const at = text.search(/\n*⚠/u);
  const body = at === -1 ? text : text.slice(0, at).trimEnd();
  const warning = at === -1 ? null : text.slice(at).trim();
  const content = (
    <>
      <CitedText label={label} text={body} sources={interaction.sources} onShowPage={onShowPage} />
      {warning && (
        <p className="warning" role="note">
          {warning}
        </p>
      )}
    </>
  );
  if (interaction.mode === 'INTERPRETATION') {
    // The label comes from the application, not from the model.
    return (
      <div className="interpretation" role="note" aria-label="Interpretation">
        <p className="interpretation-label">
          [Interpretation] Not stated in the document: this is the model&apos;s reading. Check the cited passages.
        </p>
        {content}
      </div>
    );
  }
  if (interaction.role === 'QUESTION' && REFUSALS.includes(body.trim())) {
    return (
      <>
        {content}
        <p className="hint-line">
          <small>
            Want the model&apos;s interpretation instead? Tick &quot;Interpret&quot; below and ask again.
          </small>
        </p>
      </>
    );
  }
  return content;
}

/** What is happening with the document right now, and what the user can do. */
function StatusBox({
  document,
  onRetryReading,
  onRetryExplanation,
}: {
  document: DocumentInfo;
  onRetryReading: () => void;
  onRetryExplanation: () => void;
}) {
  const { status, explanationStatus } = document;
  if (status === 'PENDING') {
    return (
      <div className="status">
        <p>In the queue: this document will be read shortly<LoadingDots /></p>
      </div>
    );
  }
  if (status === 'PROCESSING') {
    return (
      <div className="status">
        <p>Reading the document (text and OCR)<LoadingDots /></p>
      </div>
    );
  }
  if (status === 'FAILED') {
    return (
      <div className="status">
        <p>Could not read this document: {document.failureReason ?? 'unknown error.'}</p>
        <button type="button" onClick={onRetryReading}>Retry</button>
      </div>
    );
  }
  if (explanationStatus === 'PENDING' || explanationStatus === 'PROCESSING') {
    return (
      <div className="status">
        <p>Writing the explanation<LoadingDots /> You can already ask questions below.</p>
      </div>
    );
  }
  if (explanationStatus === 'FAILED') {
    return (
      <div className="status">
        <p>The explanation could not be written: {document.explanationError ?? 'unknown error.'} You can still ask questions.</p>
        <button type="button" onClick={onRetryExplanation}>Retry explanation</button>
      </div>
    );
  }
  return null;
}

async function fetchDocument(id: string): Promise<DocumentData> {
  const res = await apiFetch(`/documents/${id}`);
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<DocumentData | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  /** Page shown in the PDF viewer (set by "Show page N in the PDF"). */
  const [pdfPage, setPdfPage] = useState<number | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  /** Question sent and waiting for its answer, shown in the chat right away. */
  const [pending, setPending] = useState<{ text: string; interpret: boolean } | null>(null);
  /** Ask for an interpretation: explicit, and off again after each question. */
  const [interpret, setInterpret] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
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

  // Like a messaging app: follow the conversation when a question is sent and
  // again when its answer arrives (it can be longer than the "Thinking" line).
  const answered = data?.interactions.filter((i) => i.role === 'QUESTION').length ?? 0;
  const following = useRef(false);
  useEffect(() => {
    if (pending !== null) following.current = true;
    if (!following.current) return;
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    if (pending === null) following.current = false; // answer shown: stop following
  }, [pending, answered]);

  // Reading and explaining happen in the background: refresh until both are done.
  const busy = data ? inProgress(data.document) : false;
  useEffect(() => {
    if (!busy) return;
    const interval = setInterval(() => {
      fetchDocument(id).then(setData, () => undefined);
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [id, busy]);

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
    const text = question.trim();
    if (!text || asking) return;
    const wantsInterpretation = interpret;

    setAsking(true);
    setError(null);
    setPending({ text, interpret: wantsInterpretation });
    setQuestion('');
    setInterpret(false);
    try {
      const res = await apiFetch(`/documents/${id}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, interpret: wantsInterpretation }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      setData(await fetchDocument(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      setQuestion(text); // give the question back so it can be sent again
      setInterpret(wantsInterpretation);
    } finally {
      setPending(null);
      setAsking(false);
    }
  }

  /** Queues work in the backend (202) and refreshes; polling takes it from there. */
  async function queue(action: 'process' | 'explain') {
    setError(null);
    try {
      const res = await apiFetch(`/documents/${id}/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error(await errorMessage(res));
      setData(await fetchDocument(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    }
  }

  async function deleteDocument() {
    const name = data?.document.originalName ?? 'this document';
    if (
      !window.confirm(
        `Delete "${name}" permanently?\n\nThe file, the text read from it and all its explanations, questions and answers are erased from this machine. This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    const res = await apiFetch(`/documents/${id}`, { method: 'DELETE' });
    if (res.ok) router.replace('/documents');
    else setError(await errorMessage(res));
  }

  function reprocess() {
    if (
      window.confirm(
        'Read the document and write the explanation again? Your questions and answers are kept.',
      )
    ) {
      queue('process');
    }
  }

  if (error && !data) return <p role="alert">Error: {error}</p>;
  if (!data) return <p>Loading...</p>;

  const { document, interactions } = data;
  const showPage =
    kind === 'pdf' && previewUrl
      ? (page: number) => {
          setPdfPage(page);
          previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      : undefined;
  const ready = document.status === 'COMPLETED';
  const questions = interactions.filter((i) => i.role === 'QUESTION');

  return (
    <div>
      <h1>{document.originalName}</h1>

      <StatusBox
        document={document}
        onRetryReading={() => queue('process')}
        onRetryExplanation={() => queue('explain')}
      />
      {!busy && (
        <div className="button-row left doc-actions">
          {ready && (
            <button
              type="button"
              onClick={reprocess}
              title="Read the document and write the explanation again (e.g. after changing the model)"
            >
              Reprocess
            </button>
          )}
          <button type="button" className="danger" onClick={deleteDocument}>
            Delete
          </button>
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
        <div className="preview" ref={previewRef}>
          <iframe
            // a new key reloads the viewer so it opens at the requested page
            key={pdfPage ?? 0}
            src={pdfPage ? `${previewUrl}#page=${pdfPage}` : previewUrl}
            title={`Preview of ${document.originalName}`}
          />
          <small>
            <a href={previewUrl} target="_blank" rel="noopener noreferrer">
              Open the PDF in a new tab
            </a>
          </small>
        </div>
      )}

      {/* Explanation (or what is being done to produce it) */}
      {interactions
        .filter((i) => i.role === 'EXPLANATION')
        .map((i) => (
          <LlmText key={i.id} label="Explanation:" interaction={i} onShowPage={showPage} />
        ))}
      {!interactions.some((i) => i.role === 'EXPLANATION') && busy && (
        <p className="llm-text pending">
          <strong>Explanation:</strong>{' '}
          {ready ? 'Writing the explanation' : 'Reading the document'}
          <LoadingDots />
        </p>
      )}

      <hr />

      {/* Chat: question and answer */}
      <h2>Chat</h2>
      {ready && questions.length === 0 && !pending && (
        <small>No questions yet. Ask the first one below.</small>
      )}
      {questions.map((i) => (
        <div key={i.id}>
          <p><strong>You:</strong> {i.question}</p>
          <LlmText label="LLM:" interaction={i} onShowPage={showPage} />
        </div>
      ))}
      {pending && (
        <div>
          <p><strong>You:</strong> {pending.text}</p>
          <p className="llm-text pending">
            <strong>LLM:</strong> {pending.interpret ? 'Interpreting' : 'Thinking'}<LoadingDots />
          </p>
        </div>
      )}
      {/* scroll target: its scroll margin keeps the last message above the fixed input bar */}
      <div ref={chatEndRef} className="chat-end" />

      {/* Input, fixed at the bottom of the screen like a messaging app. Enter sends. */}
      <div className={`ask-bar${interpret ? ' interpreting' : ''}`}>
        <form onSubmit={askQuestion} className="ask-form">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              !ready
                ? 'Available once the document is read'
                : interpret
                  ? 'Ask for an interpretation (it will be marked as such)...'
                  : 'Ask something about the document...'
            }
            disabled={!ready || asking}
          />
          <button type="submit" disabled={!ready || asking || !question.trim()}>
            {asking ? (
              <>
                Thinking
                <LoadingDots />
              </>
            ) : (
              'Send'
            )}
          </button>
        </form>
        <label className="interpret-toggle">
          <input
            type="checkbox"
            checked={interpret}
            onChange={(e) => setInterpret(e.target.checked)}
            disabled={!ready || asking}
          />
          Interpret: let the model analyse beyond what is written (answer marked as interpretation)
        </label>
        {error && (
          <p role="alert" className="error">Error: {error}</p>
        )}
      </div>
    </div>
  );
}
