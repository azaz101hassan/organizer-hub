import Link from "next/link";
import { Display, Lede } from "@organizer-hub/web-shared/ui";
import { PublicShell } from "../../components/PublicShell";

export default function NotFound() {
  return (
    <PublicShell>
      <div className="container" style={{ paddingTop: 48, paddingBottom: 72 }}>
        <Display as="h1" size="xl" style={{ marginBottom: 14 }}>
          Not found
        </Display>
        <Lede style={{ marginBottom: 24 }}>
          Donations are not available right now.
        </Lede>
        <p>
          <Link className="link" href="/">
            Return home
          </Link>
        </p>
      </div>
    </PublicShell>
  );
}
