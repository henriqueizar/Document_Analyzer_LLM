'use client';

import { useState } from 'react';
import { apiFetch, errorMessage } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';

interface Member {
  id: string;
  name: string | null;
  email: string;
}

export interface SharedDocument {
  id: string;
  name: string;
  owner: string;
  sharedAt: string;
  status: string;
  explanationStatus: string | null;
}

export interface Team {
  id: string;
  name: string;
  members: Member[];
  /** Names, owners, dates and status only: never the content. */
  documents: SharedDocument[];
}

export interface UserOption {
  id: string;
  name: string | null;
  email: string;
}

/**
 * Teams, managed by administrators: members, and the documents shared with
 * each team (name, owner, date and status, never the content).
 */
export default function TeamsSection({
  teams,
  users,
  reload,
}: {
  teams: Team[];
  users: UserOption[];
  reload: () => Promise<unknown>;
}) {
  const { t, server } = useI18n();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  /** Runs a change and reloads; errors are shown under the section title. */
  async function change(request: Promise<Response>) {
    setError(null);
    const res = await request;
    if (!res.ok) setError(server(await errorMessage(res)));
    await reload();
    return res.ok;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const ok = await change(
      apiFetch('/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    );
    if (ok) setName('');
  }

  return (
    <section>
      <h2>{t('teams.title')}</h2>
      <p>
        <small className="hint">{t('teams.intro')}</small>
      </p>
      {error && <p role="alert" className="error">{error}</p>}
      {teams.length === 0 && <p>{t('teams.none')}</p>}
      {teams.map((team) => (
        <TeamRow key={team.id} team={team} users={users} change={change} />
      ))}
      <form onSubmit={create} className="inline-form team-create">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('teams.namePlaceholder')}
          aria-label={t('teams.namePlaceholder')}
          maxLength={60}
          required
        />
        <button type="submit">{t('teams.create')}</button>
      </form>
    </section>
  );
}

function TeamRow({
  team,
  users,
  change,
}: {
  team: Team;
  users: UserOption[];
  change: (request: Promise<Response>) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(team.name);
  const [adding, setAdding] = useState('');
  const display = (u: { name: string | null; email: string }) => u.name ?? u.email;
  const outside = users.filter((u) => !team.members.some((m) => m.id === u.id));

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const ok = await change(
      apiFetch(`/teams/${team.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    );
    if (ok) setRenaming(false);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!adding) return;
    await change(
      apiFetch(`/teams/${team.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: adding }),
      }),
    );
    setAdding('');
  }

  function removeMember(member: Member) {
    if (!window.confirm(t('teams.removeConfirm', { name: display(member), team: team.name }))) return;
    change(apiFetch(`/teams/${team.id}/members/${member.id}`, { method: 'DELETE' }));
  }

  function remove() {
    if (!window.confirm(t('teams.deleteConfirm', { name: team.name }))) return;
    change(apiFetch(`/teams/${team.id}`, { method: 'DELETE' }));
  }

  return (
    <div className="team">
      <div className="team-head">
        {renaming ? (
          <form onSubmit={rename} className="inline-form">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
            <button type="submit">{t('common.save')}</button>
            <button type="button" onClick={() => setRenaming(false)}>{t('common.cancel')}</button>
          </form>
        ) : (
          <strong>{team.name}</strong>
        )}
        {!renaming && (
          <span className="button-row">
            <button type="button" onClick={() => setRenaming(true)}>{t('teams.rename')}</button>
            <button type="button" className="danger" onClick={remove}>{t('teams.delete')}</button>
          </span>
        )}
      </div>
      <SharedDocuments team={team} change={change} />
      {team.members.length === 0 ? (
        <p><small>{t('teams.noMembers')}</small></p>
      ) : (
        <ul className="members">
          {team.members.map((m) => (
            <li key={m.id}>
              <span>
                {display(m)}
                {m.name && <small> {m.email}</small>}
              </span>
              <button
                type="button"
                onClick={() => removeMember(m)}
                aria-label={t('teams.removeMember', { name: display(m) })}
                title={t('teams.removeMember', { name: display(m) })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {outside.length > 0 && (
        <form onSubmit={add} className="inline-form">
          <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label={t('teams.chooseUser')}>
            <option value="">{t('teams.chooseUser')}</option>
            {outside.map((u) => (
              <option key={u.id} value={u.id}>
                {display(u)}
                {u.name ? ` (${u.email})` : ''}
              </option>
            ))}
          </select>
          <button type="submit" disabled={!adding}>{t('teams.addMember')}</button>
        </form>
      )}
    </div>
  );
}

function SharedDocuments({
  team,
  change,
}: {
  team: Team;
  change: (request: Promise<Response>) => Promise<boolean>;
}) {
  const { t, language } = useI18n();
  if (team.documents.length === 0) {
    return <p><small>{t('admin.noShared')}</small></p>;
  }
  function unshare(doc: SharedDocument) {
    if (!window.confirm(t('admin.unshareConfirm', { name: doc.name, team: team.name }))) return;
    change(apiFetch(`/admin/teams/${team.id}/documents/${doc.id}`, { method: 'DELETE' }));
  }
  return (
    <details className="shared-docs">
      <summary>{t('teams.sharedCount', { count: team.documents.length })}</summary>
      <table>
        <thead>
          <tr>
            <th>{t('admin.document')}</th>
            <th>{t('admin.owner')}</th>
            <th>{t('admin.sharedAt')}</th>
            <th>{t('admin.status')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {team.documents.map((d) => (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td>{d.owner}</td>
              <td>{new Date(d.sharedAt).toLocaleDateString(language === 'pt' ? 'pt-BR' : 'en')}</td>
              <td>{t(statusKey(d))}</td>
              <td>
                <button type="button" onClick={() => unshare(d)}>
                  {t('admin.unshare')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function statusKey(d: SharedDocument): MessageKey {
  if (d.status === 'PENDING') return 'status.queue';
  if (d.status === 'PROCESSING') return 'status.reading';
  if (d.status === 'FAILED') return 'status.failed';
  if (d.explanationStatus === 'PENDING' || d.explanationStatus === 'PROCESSING') return 'status.writing';
  if (d.explanationStatus === 'FAILED') return 'status.readyNoExplanation';
  return 'status.ready';
}
