'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { apiFetch, errorMessage } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { useMyTeams } from '@/lib/teams';

type Status = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

interface DocumentSummary {
  id: string;
  originalName: string;
  status: Status;
  explanationStatus: Status | null;
  createdAt: string;
  /** Own documents: teams it is shared with. Shared documents: the caller's teams. */
  shares?: { team: { name: string } }[];
  /** Shared documents: the owner. */
  user?: { name: string | null; email: string };
}

function statusLabel(d: DocumentSummary): MessageKey {
  if (d.status === 'PENDING') return 'status.queue';
  if (d.status === 'PROCESSING') return 'status.reading';
  if (d.status === 'FAILED') return 'status.failed';
  if (d.explanationStatus === 'PENDING' || d.explanationStatus === 'PROCESSING') return 'status.writing';
  if (d.explanationStatus === 'FAILED') return 'status.readyNoExplanation';
  return 'status.ready';
}

const inProgress = (d: DocumentSummary) =>
  d.status === 'PENDING' ||
  d.status === 'PROCESSING' ||
  d.explanationStatus === 'PENDING' ||
  d.explanationStatus === 'PROCESSING';

async function fetchDocuments(path = '/documents'): Promise<DocumentSummary[]> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

export default function DocumentsListPage() {
  const { data: session, status } = useSession();
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t, server, language } = useI18n();
  const [shared, setShared] = useState<DocumentSummary[] | null>(null);

  const email = session?.user?.email;
  // Sharing exists only for people in a team; otherwise nothing about it is shown.
  const teams = useMyTeams(email);
  const inTeams = (teams?.length ?? 0) > 0;
  useEffect(() => {
    if (!inTeams) return;
    let cancelled = false;
    fetchDocuments('/documents/shared').then(
      (list) => !cancelled && setShared(list),
      () => !cancelled && setShared([]),
    );
    return () => {
      cancelled = true;
    };
  }, [inTeams]);
  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    fetchDocuments().then(
      (list) => !cancelled && setDocs(list),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [email]);

  // Documents are processed in the background: refresh while any is in progress.
  const busy = (docs?.some(inProgress) || shared?.some(inProgress)) ?? false;
  useEffect(() => {
    if (!busy) return;
    const interval = setInterval(() => {
      fetchDocuments().then(setDocs, () => undefined);
      if (inTeams) fetchDocuments('/documents/shared').then(setShared, () => undefined);
    }, 3000);
    return () => clearInterval(interval);
  }, [busy, inTeams]);

  const locale = language === 'pt' ? 'pt-BR' : 'en';
  if (status === 'loading') return <p>{t('common.loadingSession')}</p>;
  if (!session) {
    return (
      <div className="centered">
        <p>{t('documents.mustLogin')}</p>
        <Link href="/login">{t('common.goToLogin')}</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="title-row">
        <h1>{t('documents.title')}</h1>
        <Link href="/upload" className="button-link">{t('home.upload')}</Link>
      </div>

      {error && <p role="alert" className="error">{t('common.error', { message: server(error) })}</p>}
      {!docs && !error && <p>{t('common.loading')}</p>}
      {docs && docs.length === 0 && (
        <p>
          {t('documents.empty')} <Link href="/upload">{t('documents.uploadFirst')}</Link>.
        </p>
      )}

      {docs?.map((doc) => (
        <Link key={doc.id} href={`/documents/${doc.id}`} className="doc-item">
          <strong>{doc.originalName}</strong>
          <span>{t(statusLabel(doc))}</span>
          <small>
            {new Date(doc.createdAt).toLocaleString(locale)}
            {doc.shares?.length ? ` · ${t('share.sharedWith', { teams: teamNames(doc) })}` : ''}
          </small>
        </Link>
      ))}

      {inTeams && (
        <>
          <h2>{t('documents.sharedTitle')}</h2>
          {shared?.length === 0 && <p>{t('documents.sharedEmpty')}</p>}
          {shared?.map((doc) => (
            <Link key={doc.id} href={`/documents/${doc.id}`} className="doc-item">
              <strong>{doc.originalName}</strong>
              <span>{t(statusLabel(doc))}</span>
              <small>
                {t('documents.sharedBy', { name: doc.user?.name ?? doc.user?.email ?? '', teams: teamNames(doc) })}
                {' · '}
                {new Date(doc.createdAt).toLocaleString(locale)}
              </small>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}

const teamNames = (d: DocumentSummary) => (d.shares ?? []).map((s) => s.team.name).join(', ');
