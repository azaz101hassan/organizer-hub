import "server-only";
import { cookies } from "next/headers";

export class UnauthorizedError extends Error {
  constructor(message = "unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`api ${status}: ${body.slice(0, 200)}`);
    this.name = "ApiError";
  }
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

// Per-app cookie name. Each app sets OH_ACCESS_TOKEN_COOKIE in its
// .env.local so the prefixed cookies written by the middleware (e.g.,
// oh_member_access_token, oh_admin_access_token) can co-exist in the same
// browser. Falls back to the bare "access_token" name for backwards
// compatibility with older deployments.
function accessTokenCookieName(): string {
  return process.env.OH_ACCESS_TOKEN_COOKIE ?? "access_token";
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: ApiFetchOptions = {},
): Promise<T> {
  const store = await cookies();
  const accessToken = store.get(accessTokenCookieName())?.value;
  if (!accessToken) throw new UnauthorizedError("missing access token");

  const headers = new Headers(opts.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (opts.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: opts.cache ?? "no-store",
  });

  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new ApiError(res.status, await res.text());

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function publicApiFetch<T = unknown>(
  path: string,
  opts: Omit<ApiFetchOptions, "body"> = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    cache: opts.cache ?? "no-store",
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
