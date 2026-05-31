import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@organizer-hub/web-shared";
import NavLinks from "./NavLinks";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await readSession({
    session: "oh_member_session",
    refresh: "oh_member_refresh",
    accessToken: "oh_member_access_token",
  });
  if (!session) redirect("/auth/login");

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link
            href="/dashboard"
            className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            OrganizerHub
          </Link>
          <div className="flex items-center gap-4">
            <NavLinks />
            <div className="flex items-center gap-4 text-xs text-zinc-500">
              <span className="hidden sm:inline">
                {session.email ?? session.sub}
              </span>
              <a
                href="/auth/logout"
                className="text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50"
              >
                Sign out
              </a>
            </div>
          </div>
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-6 py-8">{children}</div>
    </div>
  );
}
