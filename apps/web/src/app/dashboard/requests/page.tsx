import { redirect } from "next/navigation";
import { apiFetch, UnauthorizedError } from "@organizer-hub/web-shared";
import type { RequesterTicketRequestView } from "@organizer-hub/web-shared";
import RequestList from "./RequestList";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  let requests: RequesterTicketRequestView[];
  try {
    requests = await apiFetch<RequesterTicketRequestView[]>("/requests");
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    throw err;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Your requests
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Tickets you&apos;ve requested for at-capacity tiers.
      </p>

      {requests.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            You haven&apos;t requested any tickets yet.
          </p>
        </div>
      ) : (
        <RequestList requests={requests} />
      )}
    </div>
  );
}
