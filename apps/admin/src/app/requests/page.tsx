import { notFound, redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError, getHouseOrgId } from "@organizer-hub/web-shared";
import type { AdminQueuePage } from "@organizer-hub/web-shared";
import WaitlistQueue from "./WaitlistQueue";

export const dynamic = "force-dynamic";

export default async function AdminRequestsPage() {
  const orgId = getHouseOrgId();

  let page: AdminQueuePage;
  let token: string;
  try {
    const [queue, minted] = await Promise.all([
      apiFetch<AdminQueuePage>(`/orgs/${orgId}/requests`),
      apiFetch<{ token: string }>(`/orgs/${orgId}/requests/stream-token`, {
        method: "POST",
      }),
    ]);
    page = queue;
    token = minted.token;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    // RolesGuard 404-hides non-members and 403s non-admins.
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      notFound();
    }
    throw err;
  }

  const apiBase =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Ticket requests
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Pending requests for at-capacity tiers across this organization.
      </p>

      <WaitlistQueue
        orgId={orgId}
        apiBase={apiBase}
        initialItems={page.items}
        initialToken={token}
        truncated={page.nextCursor !== null}
      />
    </div>
  );
}
