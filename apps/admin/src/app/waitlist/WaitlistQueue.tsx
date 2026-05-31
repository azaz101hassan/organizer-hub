"use client";

import { useEffect, useRef, useState } from "react";
import type { AdminTicketRequestView } from "@organizer-hub/web-shared";
import { formatDateTime } from "@organizer-hub/web-shared/client";
import { Button, Card, Pill } from "@organizer-hub/web-shared/ui";
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
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <ConnectionIndicator conn={conn} />
        {truncated && (
          <span className="faint" style={{ fontSize: 12 }}>
            Showing the most recent requests.
          </span>
        )}
      </div>

      {/* Screen-reader announcements for queue changes. */}
      <div role="log" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {conn === "revoked" && (
        <div
          className="card"
          style={{
            padding: "14px 18px",
            marginBottom: 20,
            borderColor: "var(--bad)",
            background: "var(--bad-soft)",
            color: "var(--bad)",
            fontSize: 14,
          }}
        >
          Your access has changed — reload the page.
        </div>
      )}

      {rows.length === 0 ? (
        <div
          className="card"
          style={{
            padding: "48px 24px",
            textAlign: "center",
            borderStyle: "dashed",
          }}
        >
          <p className="muted" style={{ fontSize: 14 }}>
            No pending requests.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {grouped.map(([eventTitle, eventRows]) => (
            <section key={eventTitle}>
              <p className="eyebrow eyebrow--muted" style={{ marginBottom: 8 }}>
                {eventTitle}
              </p>
              <Card>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
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
              </Card>
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
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          fontSize: 12,
          color: "var(--good)",
          fontWeight: 600,
        }}
      >
        <span
          className="dot"
          style={{ background: "var(--good)", flexShrink: 0 }}
        />
        Live
      </span>
    );
  }
  if (conn === "reconnecting") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          fontSize: 12,
          color: "var(--warn)",
          fontWeight: 600,
        }}
      >
        <span
          className="dot"
          style={{
            background: "var(--warn)",
            flexShrink: 0,
            animation: "ping 1.2s cubic-bezier(0,0,0.2,1) infinite",
          }}
        />
        Reconnecting…
      </span>
    );
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontSize: 12,
        color: "var(--bad)",
        fontWeight: 600,
      }}
    >
      <span
        className="dot"
        style={{ background: "var(--bad)", flexShrink: 0 }}
      />
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
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const atCap =
    row.ticketType.cap !== null && row.issuedCount >= row.ticketType.cap;

  async function doApprove(): Promise<void> {
    setPending("approve");
    setError(null);
    const res = await approveRequest(orgId, row.id);
    if (res.ok) {
      setLeaving(true);
      // Let the rowOut animation play before the parent removes the row.
      setTimeout(() => onResolved("approved"), 420);
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
      setLeaving(true);
      setTimeout(() => onResolved("rejected"), 420);
      return;
    }
    setError(res.error ?? "Reject failed.");
    setPending(null);
  }

  const busy = pending !== null;

  return (
    <li
      className={["qrow", leaving ? "qrow--leaving" : ""].filter(Boolean).join(" ")}
      style={{ flexWrap: "wrap", justifyContent: "space-between" }}
    >
      <div style={{ minWidth: 0, flex: "1 1 200px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
            {row.userName ?? row.userEmail ?? "Unknown requester"}
          </span>
          <Pill tone={row.intent === "PAID" ? "paid" : "pending"}>
            {row.intent === "PAID" ? "Paid" : "Free"}
          </Pill>
        </div>
        <p className="faint" style={{ fontSize: 12, marginTop: 3 }}>
          {row.ticketType.name}
          {" · "}
          requested {formatDateTime(row.createdAt)}
        </p>
        {error && (
          <p style={{ marginTop: 4, fontSize: 12, color: "var(--bad)" }}>
            {error}
          </p>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexShrink: 0,
          alignItems: "center",
          gap: 8,
        }}
      >
        {confirmingOverCap ? (
          <>
            <span
              style={{ fontSize: 12, color: "var(--warn)", fontWeight: 500 }}
            >
              At cap ({row.issuedCount}/{row.ticketType.cap}) — confirm?
            </span>
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => void doApprove()}
            >
              {pending === "approve" ? "Approving…" : "Confirm approve"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmingOverCap(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (atCap) setConfirmingOverCap(true);
                else void doApprove();
              }}
            >
              {pending === "approve" ? "Approving…" : "Approve"}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => void doReject()}
            >
              {pending === "reject" ? "Rejecting…" : "Reject"}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
