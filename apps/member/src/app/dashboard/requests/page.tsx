import { redirect } from "next/navigation";
import { apiFetch, UnauthorizedError } from "@organizer-hub/web-shared";
import type { RequesterTicketRequestView } from "@organizer-hub/web-shared";
import { Card, Display, Eyebrow, Lede } from "@organizer-hub/web-shared/ui";
import RequestList from "./RequestList";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  let requests: RequesterTicketRequestView[];
  try {
    requests = await apiFetch<RequesterTicketRequestView[]>("/requests");
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    throw err;
  }

  return (
    <div>
      <Eyebrow muted style={{ marginBottom: 8 }}>Requests</Eyebrow>
      <Display as="h1" size="lg" style={{ marginBottom: 8 }}>
        Your requests
      </Display>
      <Lede style={{ marginBottom: 32, fontSize: 15 }}>
        Tickets you&apos;ve requested for at-capacity tiers.
      </Lede>

      {requests.length === 0 ? (
        <Card style={{ padding: "40px 32px", textAlign: "center", borderStyle: "dashed" }}>
          <p className="muted" style={{ fontSize: 14 }}>
            You haven&apos;t requested any tickets yet.
          </p>
        </Card>
      ) : (
        <RequestList requests={requests} />
      )}
    </div>
  );
}
