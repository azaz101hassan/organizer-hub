import { Display, Lede } from "@organizer-hub/web-shared/ui";
import { PublicShell } from "../../components/PublicShell";

export default function NotFound() {
  return (
    <PublicShell>
      <div className="container">
        <Display as="h1" size="xl">
          Not found
        </Display>
        <Lede>The initiative you were looking for isn&apos;t here.</Lede>
      </div>
    </PublicShell>
  );
}
