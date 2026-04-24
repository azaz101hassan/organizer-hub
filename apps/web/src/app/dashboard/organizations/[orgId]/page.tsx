import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError } from "@/lib/api/client";
import type { OrganizationView } from "@/lib/api/types";

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  let org: OrganizationView;
  try {
    org = await apiFetch<OrganizationView>(`/organizations/${orgId}`);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← All organizations
        </Link>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {org.name}
            </h1>
            {org.description && (
              <p className="mt-1 text-sm text-zinc-500">{org.description}</p>
            )}
          </div>
          <span className="shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
            {org.role}
          </span>
        </div>
      </div>

      <section>
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Events
        </h2>
        <div className="mt-3 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">
          Event management arrives in the next update.
        </div>
      </section>
    </div>
  );
}
