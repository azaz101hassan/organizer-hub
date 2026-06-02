import { Display, Lede } from "@organizer-hub/web-shared/ui";
import { PublicShell } from "../../../components/PublicShell";

export default function NotFound() {
  return (
    <PublicShell>
      <div className="container" style={{ paddingTop: 48, paddingBottom: 72 }}>
        <Display as="h1" size="xl" style={{ marginBottom: 14 }}>
          Not found
        </Display>
        <Lede>We couldn&apos;t find that donation confirmation.</Lede>
      </div>
    </PublicShell>
  );
}
