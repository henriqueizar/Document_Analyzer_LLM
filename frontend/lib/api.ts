"use client";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

let cached: { token: string; expiresAt: number } | null = null;

async function getBackendToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - 30 > now) return cached.token;

  const res = await fetch("/api/backend-token", { cache: "no-store" });
  if (!res.ok) {
    cached = null;
    throw new Error("Not authenticated");
  }
  cached = await res.json();
  return cached!.token;
}

/** fetch() against the backend with the caller's short-lived bearer token. */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await getBackendToken()}`);
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

/** Extracts the backend's error message from a failed response. */
export async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return Array.isArray(body.message) ? body.message.join(", ") : body.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
