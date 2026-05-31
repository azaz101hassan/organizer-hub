import Link from "next/link";
import { readSession } from "@organizer-hub/web-shared";

export default async function Home() {
  const session = await readSession({ session: "oh_member_session", refresh: "oh_member_refresh", accessToken: "oh_member_access_token" });

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-black px-6">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-10 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          OrganizerHub
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          One pane of glass for event organizers.
        </p>

        <div className="mt-8">
          {session ? (
            <>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                Signed in as{" "}
                <strong className="text-zinc-900 dark:text-zinc-50">
                  {session.email ?? session.sub}
                </strong>
              </p>
              {session.name && (
                <p className="text-xs text-zinc-500 mt-1">({session.name})</p>
              )}
              <div className="mt-6 flex items-center justify-center gap-3">
                <Link
                  href="/dashboard"
                  className="inline-block rounded-full bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-5 py-2 text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 transition"
                >
                  Dashboard
                </Link>
                <a
                  href="/auth/logout"
                  className="inline-block rounded-full border border-zinc-300 dark:border-zinc-700 px-5 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                >
                  Sign out
                </a>
              </div>
            </>
          ) : (
            <a
              href="/auth/login"
              className="inline-block rounded-full bg-blue-600 text-white px-6 py-2.5 text-sm font-medium hover:bg-blue-500 transition"
            >
              Sign in
            </a>
          )}
        </div>

        <div className="mt-6 border-t border-zinc-200 dark:border-zinc-800 pt-4 flex items-center justify-center gap-4">
          <Link
            href="/events"
            className="text-sm text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50"
          >
            Browse events →
          </Link>
          <span aria-hidden className="text-zinc-300 dark:text-zinc-700">
            ·
          </span>
          <Link
            href="/membership"
            className="text-sm text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50"
          >
            Become a member →
          </Link>
        </div>
      </div>
    </main>
  );
}
