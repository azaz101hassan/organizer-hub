import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import {
  apiFetch,
  UnauthorizedError,
} from "@organizer-hub/web-shared";
import { Eyebrow, Display, Lede, Card } from "@organizer-hub/web-shared/ui";
import { PublicShell } from "../../../components/PublicShell";

export const dynamic = "force-dynamic";

export const metadata = { title: "Thank you for your donation" };

interface SessionLookup {
  donationId: string;
  mode: "ONE_TIME" | "RECURRING";
  campaignSlug: string;
}

export default async function DonateThanksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const sessionIdRaw = Array.isArray(sp.session_id)
    ? sp.session_id[0]
    : sp.session_id;

  if (!sessionIdRaw) redirect("/donate");
  const sessionId = sessionIdRaw.slice(0, 256);

  let lookup: SessionLookup | null = null;
  try {
    lookup = await apiFetch<SessionLookup>(
      `/donations/by-session/${encodeURIComponent(sessionId)}`,
    );
    if (lookup?.campaignSlug) {
      revalidatePath(`/campaigns/${lookup.campaignSlug}`);
    }
    revalidatePath("/donate");
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      const returnPath = `/donate/thanks?session_id=${encodeURIComponent(sessionId)}`;
      redirect(`/auth/login?next=${encodeURIComponent(returnPath)}`);
    }
    lookup = null;
  }

  const dashboardHref =
    lookup?.mode === "RECURRING"
      ? "/dashboard/donations"
      : "/dashboard/payments?kind=DONATION";

  return (
    <PublicShell>
      <div className="container" style={{ paddingTop: 48, paddingBottom: 72 }}>
        <Eyebrow>Donation confirmed</Eyebrow>
        <Display as="h1" size="xl" style={{ margin: "10px 0 14px" }}>
          Thank you!
        </Display>

        {lookup ? (
          <>
            <Lede style={{ marginBottom: 36 }}>
              {lookup.mode === "RECURRING"
                ? "Your recurring donation is confirmed. We're grateful for your ongoing support."
                : "Your donation is on its way. Check your email for a receipt."}
            </Lede>

            <Card padded>
              <p className="muted">
                Your giving history is in your dashboard.
              </p>
              <div
                style={{
                  marginTop: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <Link className="link" href={dashboardHref}>
                  View in your dashboard
                </Link>
                <Link
                  className="link"
                  href={`/campaigns/${lookup.campaignSlug}`}
                >
                  Back to campaign
                </Link>
              </div>
            </Card>
          </>
        ) : (
          <>
            <Lede style={{ marginBottom: 36 }}>
              Your donation is on its way. Check your email for a receipt.
            </Lede>

            <Card padded>
              <p className="muted">
                You can view your giving history from your dashboard.
              </p>
              <div
                style={{
                  marginTop: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <Link className="link" href="/">
                  Return home
                </Link>
                <Link className="link" href="/coalitions">
                  Browse coalitions
                </Link>
              </div>
            </Card>
          </>
        )}
      </div>
    </PublicShell>
  );
}
