'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, errorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Member {
  id: string;
  name: string | null;
  email: string;
}

interface Team {
  id: string;
  name: string;
  members: Member[];
  sharedDocuments: number;
}

interface UserOption {
  id: string;
  name: string | null;
  email: string;
}

async function fetchTeams(): Promise<Team[]> {
  const res = await apiFetch('/teams');
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

/**
 * Teams, managed by administrators. The administrator sees who is in each team
 * and how many documents are shared with it, never the documents themselves.
 */
export default function TeamsSection({ users }: { users: UserOption[] }) {
  const { t, server } = useI18n();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetchTeams().then(setTeams, (e: Error) => setError(server(e.message))),
    [server],
  );

  useEffect(() => {
    let cancelled = false;
    fetchTeams().then(
      (list) => !cancelled && setTeams(list),
      (e: Error) => !cancelled && setError(server(e.message)),
    );
    return () => {
      cancelled = true;
    };
  }, [server]);

  /** Runs a change and reloads; errors are shown under the section title. */
  async function change(request: Promise<Response>) {
    setError(null);
    const res = await request;
    if (!res.ok) setError(server(await errorMessage(res)));
    await load();
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
      {teams?.length === 0 && <p>{t('teams.none')}</p>}
      {teams?.map((team) => (
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
      <small>{t('teams.sharedCount', { count: team.sharedDocuments })}</small>
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
