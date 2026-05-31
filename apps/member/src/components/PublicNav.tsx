import Link from "next/link";
import { readSession } from "@organizer-hub/web-shared";
import { NavLink } from "@organizer-hub/web-shared/ui";

export async function PublicNav() {
  const session = await readSession({
    session: "oh_member_session",
    refresh: "oh_member_refresh",
    accessToken: "oh_member_access_token",
  });
  return (
    <nav className="pubnav" aria-label="Main">
      <div className="container container--wide pubnav__inner">
        <Link href="/" className="brand">
          <span className="brand__mark" aria-hidden="true">
            O
          </span>
          <span className="brand__name">OrganizerHub</span>
        </Link>
        <div className="pubnav__links">
          <NavLink href="/events">Events</NavLink>
          <NavLink href="/membership">Membership</NavLink>
          {session ? (
            <>
              <NavLink href="/dashboard">Dashboard</NavLink>
              <Link
                href="/auth/logout"
                className="btn btn--ghost btn--sm"
                style={{ marginLeft: 6 }}
              >
                Sign out
              </Link>
            </>
          ) : (
            <Link
              href="/auth/login"
              className="btn btn--solid btn--sm"
              style={{ marginLeft: 6 }}
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
