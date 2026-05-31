"use server";

import { ApiError, apiFetch, UnauthorizedError } from "@organizer-hub/web-shared";
import type {
  AdminQueuePage,
  AdminTicketRequestView,
} from "@organizer-hub/web-shared";

export interface ActionResult {
  ok?: boolean;
  error?: string;
}

// Approve dispatches by intent server-side (claim issues inline, paid mints a
// link). A 409 means another admin / the scheduler already moved it.
export async function approveRequest(
  orgId: string,
  id: string,
): Promise<ActionResult> {
  try {
    await apiFetch(`/orgs/${orgId}/requests/${id}/approve`, { method: "POST" });
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

export async function rejectRequest(
  orgId: string,
  id: string,
): Promise<ActionResult> {
  try {
    await apiFetch(`/orgs/${orgId}/requests/${id}/reject`, {
      method: "POST",
      body: {},
    });
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

export interface RemintResult {
  token?: string;
  // The caller was demoted / removed (401/403/404) — the client must stop
  // trying to reconnect and surface a reload notice instead.
  accessRevoked?: boolean;
  error?: string;
}

// Mint a fresh single-use stream token on reconnect (the prior one was burned
// at connect). Re-runs RolesGuard, so a just-demoted admin is denied here.
export async function remintStreamToken(
  orgId: string,
): Promise<RemintResult> {
  try {
    const res = await apiFetch<{ token: string }>(
      `/orgs/${orgId}/requests/stream-token`,
      { method: "POST" },
    );
    return { token: res.token };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { accessRevoked: true };
    if (
      err instanceof ApiError &&
      (err.status === 403 || err.status === 404)
    ) {
      return { accessRevoked: true };
    }
    return { error: "reconnect failed" };
  }
}

// A new request arrived over SSE but the created payload lacks the admin
// display fields — refetch the (fully populated) first page of the queue.
export async function refetchQueue(
  orgId: string,
): Promise<AdminTicketRequestView[]> {
  try {
    const page = await apiFetch<AdminQueuePage>(`/orgs/${orgId}/requests`);
    return page.items;
  } catch {
    return [];
  }
}

function toActionError(err: unknown): ActionResult {
  if (err instanceof UnauthorizedError) {
    return { error: "Your session expired — reload the page." };
  }
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return { error: "Already decided by someone else." };
    }
    return { error: `Action failed (${err.status}).` };
  }
  return { error: "Something went wrong — please try again." };
}
