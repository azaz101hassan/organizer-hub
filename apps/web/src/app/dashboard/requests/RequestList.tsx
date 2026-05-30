import Link from "next/link";
import type { RequesterTicketRequestView } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { RequestStatusBadge } from "./RequestStatusBadge";

export default function RequestList({
  requests,
}: {
  requests: RequesterTicketRequestView[];
}) {
  return (
    <ul className="mt-6 divide-y divide-zinc-200 dark:divide-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      {requests.map((r) => (
        <li key={r.id}>
          <Link
            href={`/dashboard/requests/${r.id}`}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {r.event.title}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {r.ticketTypeName}
                {" · "}
                {r.intent === "PAID" ? "Paid" : "Free"}
                {" · "}
                requested {formatDateTime(r.createdAt)}
              </p>
            </div>
            <RequestStatusBadge status={r.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
