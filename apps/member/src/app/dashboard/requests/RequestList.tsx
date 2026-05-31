import Link from "next/link";
import type { RequesterTicketRequestView, TicketRequestStatus } from "@organizer-hub/web-shared";
import { formatDateTime } from "@organizer-hub/web-shared";
import { Badge } from "@organizer-hub/web-shared/ui";
import type { BadgeTone } from "@organizer-hub/web-shared/ui";

const STATUS_LABEL: Record<TicketRequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED_BY_USER: "Cancelled",
  EXPIRED: "Expired",
};

const STATUS_TONE: Record<TicketRequestStatus, BadgeTone> = {
  PENDING: "featured",
  APPROVED: "published",
  REJECTED: "cancelled",
  CANCELLED_BY_USER: "draft",
  EXPIRED: "draft",
};

export default function RequestList({
  requests,
}: {
  requests: RequesterTicketRequestView[];
}) {
  return (
    <ul
      style={{
        margin: 0,
        padding: 0,
        listStyle: "none",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        overflow: "hidden",
      }}
    >
      {requests.map((r, i) => (
        <li
          key={r.id}
          style={i > 0 ? { borderTop: "1px solid var(--line)" } : undefined}
        >
          <Link
            href={`/dashboard/requests/${r.id}`}
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "14px 20px",
              transition: "background .15s ease",
            }}
            className="request-row"
          >
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                {r.event.title}
              </p>
              <p className="faint" style={{ margin: "3px 0 0", fontSize: 12 }}>
                {r.ticketTypeName}
                {" · "}
                {r.intent === "PAID" ? "Paid" : "Free"}
                {" · "}
                requested {formatDateTime(r.createdAt)}
              </p>
            </div>
            <Badge tone={STATUS_TONE[r.status]}>
              {STATUS_LABEL[r.status]}
            </Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}
