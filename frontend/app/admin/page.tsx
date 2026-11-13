'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, errorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import TeamsSection, { type Team } from './teams';
import AuditSection from './audit';

interface Health {
  database: { ok: boolean; error?: string };
  llm: { model: string; url: string; reachable: boolean; modelInstalled: boolean; error?: string };
  queue: { queued: number; reading: number; writingExplanation: number };
  failures: { reading: number; explanation: number };
  storage: { documents: number; uploadsBytes: number; missingFiles: number };
}

interface Usage {
  id: string;
  name: string | null;
  email: string;
  role: 'ADMIN' | 'USER';
  documents: number;
}

interface Overview {
  health: Health;
  teams: Team[];
  usage: Usage[];
}

async function fetchOverview(): Promise<Overview> {
  const res = await apiFetch('/admin/overview');
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * The administrator's panel: system health, teams and sharing, and usage.
 * Metadata only: it never shows document content, questions or answers.
 */
export default function AdminPage() {
  const { data: session, status } = useSession();
  const { t, server } = useI18n();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = session?.user.role === 'ADMIN';

  const reload = useCallback(
    () => fetchOverview().then(setData, (e: Error) => setError(server(e.message))),
    [server],
  );

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    fetchOverview().then(
      (overview) => !cancelled && setData(overview),
      (e: Error) => !cancelled && setError(server(e.message)),
    );
    return () => {
      cancelled = true;
    };
  }, [isAdmin, server]);

  if (status === 'loading') return <p>{t('common.loading')}</p>;
  if (!session) {
    return (
      <div className="centered">
        <p>{t('common.mustLogin')}</p>
        <Link href="/login">{t('common.goToLogin')}</Link>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="centered">
        <p>{t('admin.onlyAdmins')}</p>
        <Link href="/">{t('common.backHome')}</Link>
      </div>
    );
  }

  return (
    <div>
      <h1>{t('admin.title')}</h1>
      <p>
        <small className="hint">{t('admin.intro')}</small>
      </p>
      {error && <p role="alert" className="error">{t('common.error', { message: error })}</p>}
      {!data && !error && <p>{t('common.loading')}</p>}
      {data && (
        <>
          <HealthSection health={data.health} onRefresh={reload} />
          <hr />
          <TeamsSection teams={data.teams} users={data.usage} reload={reload} />
          <hr />
          <UsageSection usage={data.usage} />
          <hr />
          <AuditSection people={data.usage} />
        </>
      )}
    </div>
  );
}

function HealthSection({ health, onRefresh }: { health: Health; onRefresh: () => void }) {
  const { t } = useI18n();
  const { database, llm, queue, failures, storage } = health;
  const llmProblem = !llm.reachable
    ? t('admin.llmDown', { url: llm.url })
    : !llm.modelInstalled
      ? t('admin.modelMissing', { model: llm.model })
      : null;
  return (
    <section>
      <div className="title-row">
        <h2>{t('admin.health')}</h2>
        <button type="button" onClick={onRefresh}>
          {t('admin.refresh')}
        </button>
      </div>
      <dl className="details health">
        <dt>{t('admin.database')}</dt>
        <dd className={database.ok ? 'success' : 'error'}>{database.ok ? t('admin.ok') : database.error}</dd>
        <dt>{t('admin.llm', { model: llm.model })}</dt>
        <dd className={llmProblem ? 'error' : 'success'}>{llmProblem ?? t('admin.ok')}</dd>
        <dt>{t('admin.queue')}</dt>
        <dd>
          {t('admin.queueDetail', {
            queued: queue.queued,
            reading: queue.reading,
            writing: queue.writingExplanation,
          })}
        </dd>
        <dt>{t('admin.failures')}</dt>
        <dd className={failures.reading || failures.explanation ? 'warning-text' : undefined}>
          {t('admin.failuresDetail', { reading: failures.reading, explanation: failures.explanation })}
        </dd>
        <dt>{t('admin.storage')}</dt>
        <dd>
          {t('admin.storageDetail', { documents: storage.documents, size: formatSize(storage.uploadsBytes) })}
          {storage.missingFiles > 0 && (
            <span className="error"> · {t('admin.missingFiles', { count: storage.missingFiles })}</span>
          )}
        </dd>
      </dl>
    </section>
  );
}

function UsageSection({ usage }: { usage: Usage[] }) {
  const { t } = useI18n();
  return (
    <section>
      <h2>{t('admin.usage')}</h2>
      <p>
        <small className="hint">{t('admin.usageHint')}</small>
      </p>
      <table>
        <thead>
          <tr>
            <th>{t('common.name')}</th>
            <th>{t('common.email')}</th>
            <th>{t('account.role')}</th>
            <th>{t('admin.documents')}</th>
          </tr>
        </thead>
        <tbody>
          {usage.map((u) => (
            <tr key={u.id}>
              <td>{u.name ?? '-'}</td>
              <td>{u.email}</td>
              <td>{u.role === 'ADMIN' ? t('role.admin') : t('role.user')}</td>
              <td>{u.documents}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
