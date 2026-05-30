import type { TicketRequestStatus } from "@/lib/api/types";

const LABEL: Record<TicketRequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED_BY_USER: "Cancelled",
  EXPIRED: "Expired",
};

const BADGE: Record<TicketRequestStatus, string> = {
  PENDING:
    "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
  APPROVED:
    "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
  REJECTED: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
  CANCELLED_BY_USER:
    "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
  EXPIRED: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
};

export function RequestStatusBadge({
  status,
}: {
  status: TicketRequestStatus;
}) {
  return (
    <span
      className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-wide ${BADGE[status]}`}
    >
      {LABEL[status]}
    </span>
  );
}
