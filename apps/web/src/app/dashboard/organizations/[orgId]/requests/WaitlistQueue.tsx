"use client";

import { useEffect, useRef, useState } from "react";
import type { AdminTicketRequestView } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import {
  approveRequest,
  refetchQueue,
  rejectRequest,
  remintStreamToken,
} from "./actions";

type ConnState = "live" | "reconnecting" | "revoked";

interface Props {
  orgId: string;
  apiBase: string;
  initialItems: AdminTicketRequestView[];
  initialToken: string;
  truncated: boolean;
}

function displayName(r: AdminTicketRequestView): string {
  return r.userName ?? r.userEmail ?? "a requester";
}

export default function WaitlistQueue({
  orgId,
  apiBase,
  initialItems,
  initialToken,
  truncated,
}: Props) {
  const [rows, setRows] = useState<AdminTicketRequestView[]>(initialItems);
  const [conn, setConn] = useState<ConnState>("live");
  const [announcement, setAnnouncement] = useState("");

  // Refs let the long-lived EventSource handlers read current state without
  // re-subscribing on every render.
  const rowsRef = useRef(rows);
  const esRef = useRef<EventSource | null>(null);
  const reconnectingRef = useRef(false);
  const revokedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  function announce(message: string): void {
    if (!mountedRef.current) return;
    setAnnouncement(message);
  }

  function dropRow(id: string): void {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  useEffect(() => {
    mountedRef.current = true;

    function parseId(e: MessageEvent): string | null {
      try {
        const data = JSON.parse(e.data) as { id?: string };
        return data.id ?? null;
      } catch {
        return null;
      }
    }

    function connect(token: string): void {
      const es = new EventSource(
        `${apiBase}/orgs/${orgId}/requests/stream?token=${encodeURIComponent(token)}`,
      );
      esRef.current = es;

      es.addEventListener("open", () => {
        if (!mountedRef.current) return;
        const wasReconnecting = reconnectingRef.current;
        reconnectingRef.current = false;
        setConn("live");
        if (wasReconnecting) announce("Queue reconnected");
      });

      // A new request — the created payload lacks admin display fields, so
      // refetch the populated queue and announce the additions.
      es.addEventListener("request.created", () => {
        void (async () => {
          const items = await refetchQueue(orgId);
          if (!mountedRef.current) return;
          const known = new Set(rowsRef.current.map((r) => r.id));
          const added = items.filter((i) => !known.has(i.id));
          setRows(items);
          if (added.length === 1) {
            announce(`Request from ${displayName(added[0])} added to the queue`);
          } else if (added.length > 1) {
            announce(`${added.length} new requests added to the queue`);
          }
        })();
      });

      // Any update / removal moves the request out of PENDING, so it leaves the
      // queue. Drop by id (the payload always carries one).
      const onLeave = (verb: string) => (e: Event) => {
        const id = parseId(e as MessageEvent);
        if (!id) return;
        const existing = rowsRef.current.find((r) => r.id === id);
        dropRow(id);
        if (existing) {
          announce(`Request from ${displayName(existing)} ${verb}`);
        }
      };
      es.addEventListener("request.updated", onLeave("updated"));
      es.addEventListener("request.removed", onLeave("removed"));

      es.onerror = () => {
        es.close();
        if (revokedRef.current) return;
        if (!reconnectingRef.current) {
          reconnectingRef.current = true;
          setConn("reconnecting");
          announce("Queue disconnected — reconnecting");
        }
        scheduleReconnect(1000);
      };
    }

    // Single-use tokens mean native auto-reconnect (which reuses the burned
    // URL) can't resume — re-mint a fresh token, then open a new connection.
    function scheduleReconnect(delay: number): void {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void (async () => {
          const res = await remintStreamToken(orgId);
          if (!mountedRef.current) return;
          if (res.accessRevoked) {
            revokedRef.current = true;
            setConn("revoked");
            return;
          }
          if (res.token) {
            connect(res.token);
            return;
          }
          // Transient failure — back off and retry.
          scheduleReconnect(Math.min(delay * 2, 15000));
        })();
      }, delay);
    }

    connect(initialToken);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      esRef.current?.close();
    };
    // Connect once on mount; orgId/apiBase/initialToken are stable per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = groupByEvent(rows);

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <ConnectionIndicator conn={conn} />
        {truncated && (
          <p className="text-xs text-zinc-500">
            Showing the most recent requests.
          </p>
        )}
      </div>

      {/* Screen-reader announcements for queue changes (R22). */}
      <div role="log" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {conn === "revoked" && (
        <div className="mt-4 rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-700 dark:text-red-300">
          Your access has changed — reload the page.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            No pending requests.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-6">
          {grouped.map(([eventTitle, eventRows]) => (
            <section key={eventTitle}>
              <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {eventTitle}
              </h2>
              <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                {eventRows.map((row) => (
                  <RequestRow
                    key={row.id}
                    orgId={orgId}
                    row={row}
                    onResolved={(verb) => {
                      dropRow(row.id);
                      announce(`Request from ${displayName(row)} ${verb}`);
                    }}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function groupByEvent(
  rows: AdminTicketRequestView[],
): Array<[string, AdminTicketRequestView[]]> {
  const map = new Map<string, AdminTicketRequestView[]>();
  for (const r of rows) {
    const list = map.get(r.event.title) ?? [];
    list.push(r);
    map.set(r.event.title, list);
  }
  return [...map.entries()];
}

function ConnectionIndicator({ conn }: { conn: ConnState }) {
  if (conn === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Live
      </span>
    );
  }
  if (conn === "reconnecting") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
        <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
        Reconnecting…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
      <span className="h-2 w-2 rounded-full bg-red-500" />
      Disconnected
    </span>
  );
}

function RequestRow({
  orgId,
  row,
  onResolved,
}: {
  orgId: string;
  row: AdminTicketRequestView;
  onResolved: (verb: string) => void;
}) {
  const [pending, setPending] = useState<null | "approve" | "reject">(null);
  const [confirmingOverCap, setConfirmingOverCap] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const atCap =
    row.ticketType.cap !== null && row.issuedCount >= row.ticketType.cap;

  async function doApprove(): Promise<void> {
    setPending("approve");
    setError(null);
    const res = await approveRequest(orgId, row.id);
    if (res.ok) {
      onResolved("approved");
      return;
    }
    setError(res.error ?? "Approve failed.");
    setPending(null);
    setConfirmingOverCap(false);
  }

  async function doReject(): Promise<void> {
    setPending("reject");
    setError(null);
    const res = await rejectRequest(orgId, row.id);
    if (res.ok) {
      onResolved("rejected");
      return;
    }
    setError(res.error ?? "Reject failed.");
    setPending(null);
  }

  const busy = pending !== null;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {row.userName ?? row.userEmail ?? "Unknown requester"}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {row.ticketType.name}
          {" · "}
          {row.intent === "PAID" ? "Paid" : "Free"}
          {" · "}
          requested {formatDateTime(row.createdAt)}
        </p>
        {error && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {confirmingOverCap ? (
          <>
            <span className="text-xs text-amber-700 dark:text-amber-400">
              At cap ({row.issuedCount}/{row.ticketType.cap}) — confirm approve?
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void doApprove()}
              className="rounded-full bg-amber-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-amber-500 disabled:opacity-50 transition"
            >
              {pending === "approve" ? "Approving…" : "Confirm"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingOverCap(false)}
              className="rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (atCap) setConfirmingOverCap(true);
                else void doApprove();
              }}
              className="rounded-full bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-emerald-500 disabled:opacity-50 transition"
            >
              {pending === "approve" ? "Approving…" : "Approve"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void doReject()}
              className="rounded-full border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 px-3 py-1.5 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 transition"
            >
              {pending === "reject" ? "Rejecting…" : "Reject"}
            </button>
          </>
        )}
      </div>
    </li>
  );
}
