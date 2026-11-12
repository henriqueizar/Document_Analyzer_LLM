'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api';

export interface TeamSummary {
  id: string;
  name: string;
}

/**
 * Teams of the signed-in user. Sharing is only offered to people in a team, so
 * an installation used by one person never shows anything about it.
 * null while loading.
 */
export function useMyTeams(email: string | null | undefined): TeamSummary[] | null {
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    apiFetch('/teams/mine')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: TeamSummary[]) => !cancelled && setTeams(list))
      .catch(() => !cancelled && setTeams([]));
    return () => {
      cancelled = true;
    };
  }, [email]);
  return teams;
}
