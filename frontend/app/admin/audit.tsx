'use client';

import { useEffect, useState } from 'react';
import { apiFetch, errorMessage } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';

interface AuditEvent {
  id: string;
  createdAt: string;
  actorEmail: string;
  action: string;
  documentId: string | null;
  target: string | null;
  details: Record<string, unknown> | null;
}

const ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'USER_CREATED',
  'USER_DELETED',
  'DOCUMENT_UPLOAD',
  'DOCUMENT_VIEW',
  'DOCUMENT_DOWNLOAD',
  'DOCUMENT_ASK',
  'DOCUMENT_REPROCESS',
  'DOCUMENT_EXPLAIN_RETRY',
  'DOCUMENT_DELETE',
  'DOCUMENT_SHARING_CHANGED',
  'SHARING_REMOVED_BY_ADMIN',
  'TEAM_CREATED',
  'TEAM_RENAMED',
  'TEAM_DELETED',
  'TEAM_MEMBER_ADDED',
  'TEAM_MEMBER_REMOVED',
] as const;

/**
 * Activity log for the administrator: who did what, on which document and
 * when. Metadata only; the backend never stores the text of questions.
 */
export default function AuditSection({ people }: { people: { email: string; name: string | null }[] }) {
  const { t, server, language } = useI18n();
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ limit: '200', ...(actor && { actor }), ...(action && { action }) });
    apiFetch(`/admin/audit?${query}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await errorMessage(res));
        return res.json();
      })
      .then(
        (list: AuditEvent[]) => !cancelled && setEvents(list),
        (e: Error) => !cancelled && setError(server(e.message)),
      );
    return () => {
      cancelled = true;
    };
  }, [actor, action, server]);

  const label = (a: string) => {
    const key = `audit.action.${a}` as MessageKey;
    return (ACTIONS as readonly string[]).includes(a) ? t(key) : a;
  };

  function details(e: AuditEvent): string | null {
    const d = e.details ?? {};
    if (d.mode === 'STRICT' || d.mode === 'INTERPRETATION') {
      if (e.action === 'DOCUMENT_ASK') return t(d.mode === 'STRICT' ? 'audit.modeStrict' : 'audit.modeInterpretation');
    }
    if (Array.isArray(d.teams)) return d.teams.length ? t('audit.sharedWith', { teams: d.teams.join(', ') }) : t('audit.private');
    if (typeof d.from === 'string') return t('audit.from', { name: d.from });
    if (typeof d.team === 'string') return t('audit.team', { name: d.team });
    if (typeof d.documents === 'number' && e.action === 'USER_DELETED') {
      return d.mode === 'transfer'
        ? t('audit.docsTransferred', { count: d.documents, email: String(d.transferredTo ?? '') })
        : t('audit.docsDeleted', { count: d.documents });
    }
    return null;
  }

  const locale = language === 'pt' ? 'pt-BR' : 'en';
  return (
    <section>
      <h2>{t('audit.title')}</h2>
      <p>
        <small className="hint">{t('audit.intro')}</small>
      </p>
      <div className="audit-filters">
        <select value={actor} onChange={(e) => setActor(e.target.value)} aria-label={t('audit.who')}>
          <option value="">{t('audit.everyone')}</option>
          {people.map((p) => (
            <option key={p.email} value={p.email}>
              {p.name ? `${p.name} (${p.email})` : p.email}
            </option>
          ))}
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label={t('audit.action')}>
          <option value="">{t('audit.allActions')}</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {label(a)}
            </option>
          ))}
        </select>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {events?.length === 0 && <p>{t('audit.empty')}</p>}
      {events && events.length > 0 && (
        <table className="audit">
          <thead>
            <tr>
              <th>{t('audit.when')}</th>
              <th>{t('audit.who')}</th>
              <th>{t('audit.action')}</th>
              <th>{t('audit.about')}</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString(locale)}</td>
                <td>{e.actorEmail}</td>
                <td>{label(e.action)}</td>
                <td>
                  {e.target}
                  {details(e) && <small>{details(e)}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
