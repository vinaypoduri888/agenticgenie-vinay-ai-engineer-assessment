"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "agenticgenie_token";
const USER_KEY = "agenticgenie_user";

export interface StoredUser {
  id: string;
  email: string;
  name: string;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: StoredUser): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // localStorage unavailable (private browsing, etc.) — session just
    // won't persist across reloads; not fatal for this demo-scale app.
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Every call goes through here — auth header injection is automatic (never
 * trust the UI to remember to attach it), and every non-2xx response is
 * turned into a thrown ApiError carrying the server's real error code, so
 * callers can show the server's actual reason rather than a generic
 * failure message. Never swallows an error into a fake success. */
export async function apiFetch<T>(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    idempotencyKey?: string;
    headers?: Record<string, string>;
  },
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    ...options?.headers,
  };

  const response = await fetch(`${API_URL}${path}`, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const code = parsed?.error?.code ?? "UNKNOWN_ERROR";
    const message = parsed?.error?.message ?? `Request failed with status ${response.status}`;
    throw new ApiError(response.status, code, message);
  }

  return parsed as T;
}

export function formatMinor(amountMinor: number): string {
  return `₹${(amountMinor / 100).toFixed(2)}`;
}
