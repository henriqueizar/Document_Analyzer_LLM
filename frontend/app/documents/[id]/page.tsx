'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch, errorMessage } from '@/lib/api';
import { CitedText, type Source } from './citations';
import LoadingDots from '../../loading-dots';
import { useI18n } from '@/lib/i18n';

interface Interaction {
  id: string;
  role: 'EXPLANATION' | 'QUESTION';
  question: string;
  answer: string;
  /** Passages sent to the model (null for answers created before sources were stored). */
  sources: Source[] | null;
  /** STRICT: what the document states. INTERPRETATION: the model's reading, asked for explicitly. */
  mode?: 'STRICT' | 'INTERPRETATION';
  /** Language the model wrote in (null for older answers). */
  language?: 'pt' | 'en' | null;
}

interface Translation {
  language: 'pt' | 'en';
  text: string;
  /** false: the translation changed a number or a page citation. */
  verified: boolean;
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
function splitWarning(text: string) {
  const at = text.search(/\n*⚠/u);
  return {
    body: at === -1 ? text : text.slice(0, at).trimEnd(),
    warning: at === -1 ? null : text.slice(at).trim(),
  };
}

function LlmText({
  label,
  documentId,
  interaction,
  onShowPage,
}: {
  label: string;
  documentId: string;
  interaction: Interaction;
  onShowPage?: (page: number) => void;
}) {
  const { t, server, language } = useI18n();
  const { body, warning } = splitWarning(interaction.answer);
  const content = (
    <>
      <CitedText label={label} text={body} sources={interaction.sources} onShowPage={onShowPage} />
      {warning && (
        <p className="warning" role="note">
          {warning}
        </p>
      )}
      {/* Written in another language (e.g. by the model for someone else): the
          original stays; a translation is shown below it only when asked for. */}
      {interaction.language && interaction.language !== language && (
        <TranslationBox
          key={language}
          documentId={documentId}
          interaction={interaction}
          to={language}
          onShowPage={onShowPage}
          t={t}
          server={server}
        />
      )}
    </>
  );
  if (interaction.mode === 'INTERPRETATION') {
    // The label comes from the application, not from the model.
    return (
      <div className="interpretation" role="note" aria-label={t('doc.interpretationLabel')}>
        <p className="interpretation-label">{t('doc.interpretationLabel')}</p>
        {content}
      </div>
    );
  }
  if (interaction.role === 'QUESTION' && REFUSALS.includes(body.trim())) {
    return (
      <>
        {content}
        <p className="hint-line">
          <small>{t('doc.refusalHint')}</small>
        </p>
      </>
    );
  }
  return content;
}

/** "View translation": translated once by the local model, then kept. */
function TranslationBox({
  documentId,
  interaction,
  to,
  onShowPage,
  t,
  server,
}: {
  documentId: string;
  interaction: Interaction;
  to: 'pt' | 'en';
  onShowPage?: (page: number) => void;
  t: ReturnType<typeof useI18n>['t'];
  server: (message: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [translation, setTranslation] = useState<Translation | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (translation || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/documents/${documentId}/interactions/${interaction.id}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      setTranslation(await res.json());
    } catch (e) {
      setError(e instanceof Error ? server(e.message) : t('common.requestFailed'));
    } finally {
      setLoading(false);
    }
  }

  const translated = translation ? splitWarning(translation.text) : null;
  return (
    <div className="translation">
      <button type="button" className="link-button" onClick={toggle} aria-expanded={open}>
        {open ? t('doc.hideTranslation') : t('doc.viewTranslation')}
      </button>
      {open && loading && (
        <p className="llm-text pending">
          {t('doc.translating')}
          <LoadingDots />
        </p>
      )}
      {open && error && (
        <p role="alert" className="error">{t('common.error', { message: error })}</p>
      )}
      {open && translated && translation && (
        <div className="translation-body" lang={translation.language === 'pt' ? 'pt-BR' : 'en'}>
          <p className="translation-label">
            <small>{t('doc.translationLabel')}</small>
          </p>
          <CitedText label="" text={translated.body} sources={interaction.sources} onShowPage={onShowPage} />
          {translated.warning && (
            <p className="warning" role="note">
              {translated.warning}
            </p>
          )}
          {!translation.verified && (
            <p className="warning" role="note">
              {t('doc.translationUnverified')}
            </p>
          )}
        </div>
      )}
    </div>
  );
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
  const { t, server } = useI18n();
  if (status === 'PENDING') {
    return (
      <div className="status">
        <p>{t('doc.queue')}<LoadingDots /></p>
      </div>
    );
  }
  if (status === 'PROCESSING') {
    return (
      <div className="status">
        <p>{t('doc.reading')}<LoadingDots /></p>
      </div>
    );
  }
  if (status === 'FAILED') {
    return (
      <div className="status">
        <p>{t('doc.readFailed', { reason: document.failureReason ? server(document.failureReason) : t('doc.unknownError') })}</p>
        <button type="button" onClick={onRetryReading}>{t('doc.retry')}</button>
      </div>
    );
  }
  if (explanationStatus === 'PENDING' || explanationStatus === 'PROCESSING') {
    return (
      <div className="status">
        <p>{t('doc.writing')}<LoadingDots /> {t('doc.writingAskNow')}</p>
      </div>
    );
  }
  if (explanationStatus === 'FAILED') {
    return (
      <div className="status">
        <p>{t('doc.explainFailed', { reason: document.explanationError ? server(document.explanationError) : t('doc.unknownError') })}</p>
        <button type="button" onClick={onRetryExplanation}>{t('doc.retryExplanation')}</button>
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
  const { t, server } = useI18n();

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
      setError(e instanceof Error ? server(e.message) : t('common.requestFailed'));
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
      setError(e instanceof Error ? server(e.message) : t('common.requestFailed'));
    }
  }

  async function deleteDocument() {
    const name = data?.document.originalName ?? '';
    if (!window.confirm(t('doc.deleteConfirm', { name }))) {
      return;
    }
    setError(null);
    const res = await apiFetch(`/documents/${id}`, { method: 'DELETE' });
    if (res.ok) router.replace('/documents');
    else setError(server(await errorMessage(res)));
  }

  function reprocess() {
    if (window.confirm(t('doc.reprocessConfirm'))) {
      queue('process');
    }
  }

  if (error && !data) return <p role="alert">{t('common.error', { message: server(error) })}</p>;
  if (!data) return <p>{t('common.loading')}</p>;

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
              title={t('doc.reprocessTitle')}
            >
              {t('doc.reprocess')}
            </button>
          )}
          <button type="button" className="danger" onClick={deleteDocument}>
            {t('doc.delete')}
          </button>
        </div>
      )}

      {/* Preview */}
      {previewUrl && kind === 'image' && (
        <div className="preview">
          {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL, not optimizable */}
          <img src={previewUrl} alt={t('doc.preview', { name: document.originalName })} />
        </div>
      )}
      {previewUrl && kind === 'pdf' && (
        <div className="preview" ref={previewRef}>
          <iframe
            // a new key reloads the viewer so it opens at the requested page
            key={pdfPage ?? 0}
            src={pdfPage ? `${previewUrl}#page=${pdfPage}` : previewUrl}
            title={t('doc.preview', { name: document.originalName })}
          />
          <small>
            <a href={previewUrl} target="_blank" rel="noopener noreferrer">
              {t('doc.openPdf')}
            </a>
          </small>
        </div>
      )}

      {/* Explanation (or what is being done to produce it) */}
      {interactions
        .filter((i) => i.role === 'EXPLANATION')
        .map((i) => (
          <LlmText key={i.id} label={t('doc.explanation')} documentId={id} interaction={i} onShowPage={showPage} />
        ))}
      {!interactions.some((i) => i.role === 'EXPLANATION') && busy && (
        <p className="llm-text pending">
          <strong>{t('doc.explanation')}</strong>{' '}
          {ready ? t('doc.writing') : t('doc.readingShort')}
          <LoadingDots />
        </p>
      )}

      <hr />

      {/* Chat: question and answer */}
      <h2>{t('doc.chat')}</h2>
      {ready && questions.length === 0 && !pending && (
        <small>{t('doc.noQuestions')}</small>
      )}
      {questions.map((i) => (
        <div key={i.id}>
          <p><strong>{t('doc.you')}</strong> {i.question}</p>
          <LlmText label={t('doc.llm')} documentId={id} interaction={i} onShowPage={showPage} />
        </div>
      ))}
      {pending && (
        <div>
          <p><strong>{t('doc.you')}</strong> {pending.text}</p>
          <p className="llm-text pending">
            <strong>{t('doc.llm')}</strong> {pending.interpret ? t('doc.interpreting') : t('doc.thinking')}<LoadingDots />
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
                ? t('doc.placeholderNotReady')
                : interpret
                  ? t('doc.placeholderInterpret')
                  : t('doc.placeholder')
            }
            disabled={!ready || asking}
          />
          <button type="submit" disabled={!ready || asking || !question.trim()}>
            {asking ? (
              <>
                {t('doc.thinking')}
                <LoadingDots />
              </>
            ) : (
              t('doc.send')
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
          {t('doc.interpretToggle')}
        </label>
        {error && (
          <p role="alert" className="error">{t('common.error', { message: error })}</p>
        )}
      </div>
    </div>
  );
}
