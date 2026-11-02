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
    /** The parsed response, for a failure that still carries useful state. */
    public body?: unknown,
  ) {
    super(message);
  }
}

/** Every call goes through here. Auth is attached automatically, and a non-2xx
 * response becomes an ApiError carrying the server's own code and message, so
 * callers show the real reason and never turn a failure into a fake success. */
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

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options?.method ?? "GET",
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection and try again.");
  }

  const text = await response.text();
  let parsed: { error?: { code?: string; message?: string } } | null = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // A proxy's HTML error page, say. The status below still tells the caller.
  }

  if (response.status === 401 && token) {
    clearSession();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
  }

  if (!response.ok) {
    const code = parsed?.error?.code ?? "UNKNOWN_ERROR";
    const message = parsed?.error?.message ?? `Request failed with status ${response.status}`;
    throw new ApiError(response.status, code, message, parsed);
  }

  return parsed as T;
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** Amounts are stored in paise. Whole rupees drop the ".00". */
export function formatMinor(amountMinor: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
  }).format(amountMinor / 100);
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function statusLabel(status: string): string {
  const lower = status.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
