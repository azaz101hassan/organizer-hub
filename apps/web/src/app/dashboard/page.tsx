import Link from "next/link";
import { redirect } from "next/navigation";
import { apiFetch, UnauthorizedError } from "@/lib/api/client";
import type { OrganizationView } from "@/lib/api/types";

const ROLE_BADGE: Record<OrganizationView["role"], string> = {
  OWNER:
    "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
  ADMIN: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
  MEMBER: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
};

export default async function DashboardPage() {
  let orgs: OrganizationView[];
  try {
    orgs = await apiFetch<OrganizationView[]>("/organizations");
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    throw err;
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Your organizations
        </h1>
        <Link
          href="/dashboard/organizations/new"
          className="rounded-full bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-4 py-2 text-xs font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 transition"
        >
          New organization
        </Link>
      </div>

      {orgs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            You don&apos;t belong to any organizations yet.
          </p>
          <Link
            href="/dashboard/organizations/new"
            className="mt-4 inline-block rounded-full bg-blue-600 text-white px-5 py-2 text-sm font-medium hover:bg-blue-500 transition"
          >
            Create your first organization
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {orgs.map((org) => (
            <li key={org.id}>
              <Link
                href={`/dashboard/organizations/${org.id}`}
                className="block rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 hover:border-zinc-400 dark:hover:border-zinc-600 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-medium text-zinc-900 dark:text-zinc-50">
                      {org.name}
                    </h2>
                    {org.description && (
                      <p className="mt-1 text-xs text-zinc-500 line-clamp-2">
                        {org.description}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${ROLE_BADGE[org.role]}`}
                  >
                    {org.role}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
