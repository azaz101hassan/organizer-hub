import { cookies } from "next/headers";
import { decodeJwt } from "jose";

interface SessionClaims {
  sub?: string;
  email?: string;
  name?: string;
  email_verified?: boolean;
}

async function readSession(): Promise<SessionClaims | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) return null;
  try {
    // Phase 1: parse only. Phase 2 will verify signature against the IdP's JWKS.
    return decodeJwt(token) as SessionClaims;
  } catch {
    return null;
  }
}

export default async function Home() {
  const session = await readSession();

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
              <a
                href="/auth/logout"
                className="mt-6 inline-block rounded-full bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-6 py-2.5 text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 transition"
              >
                Sign out
              </a>
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
      </div>
    </main>
  );
}
