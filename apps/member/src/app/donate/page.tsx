import { cache } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ApiError,
  publicApiFetch,
} from "@organizer-hub/web-shared";
import {
  Eyebrow,
  Display,
  Lede,
  Card,
  ProgressBar,
  DonatePanel,
  type DonationCadence,
} from "@organizer-hub/web-shared/ui";
import { PublicShell } from "../../components/PublicShell";
import { donateNow } from "../campaigns/actions";

export const dynamic = "force-dynamic";

const GENERAL_FUND_SLUG = "general-fund";
const VALID_CADENCES: DonationCadence[] = ["ONCE", "MONTHLY", "QUARTERLY", "YEARLY"];

interface CampaignDetail {
  campaign: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    targetAmountCents: number;
    currency: string;
    deadline: string | null;
    status: "ACTIVE" | "COMPLETE";
    raisedCents: number;
    donorCount: number;
    recentGiftCount: number;
  };
  coalition: { id: string; slug: string; name: string };
}

const getGeneralFund = cache(() =>
  publicApiFetch<CampaignDetail>(`/campaigns/${GENERAL_FUND_SLUG}`),
);

export async function generateMetadata() {
  return {
    title: "Support the work",
    description: "Your gift supports everything we do, year-round.",
    openGraph: {
      title: "Support the work",
      description: "Your gift supports everything we do, year-round.",
    },
    twitter: { card: "summary" },
  };
}

export default async function DonatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let data: CampaignDetail;
  try {
    data = await getGeneralFund();
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const nowMs = new Date().valueOf();
  const deadlineMs = data.campaign.deadline
    ? new Date(data.campaign.deadline).getTime()
    : null;
  const validDeadlineMs =
    deadlineMs !== null && Number.isFinite(deadlineMs) ? deadlineMs : null;
  const isClosed =
    data.campaign.status === "COMPLETE" ||
    (validDeadlineMs !== null && validDeadlineMs < nowMs);

  const sp = await searchParams;

  const cadenceRaw = Array.isArray(sp.cadence) ? sp.cadence[0] : sp.cadence;
  const defaultCadence: DonationCadence =
    cadenceRaw && (VALID_CADENCES as string[]).includes(cadenceRaw)
      ? (cadenceRaw as DonationCadence)
      : "ONCE";

  const amountRaw = Array.isArray(sp.amount) ? sp.amount[0] : sp.amount;
  const parsedAmount = amountRaw ? Number(amountRaw) : NaN;
  const defaultAmountCents =
    /^\d+$/.test(amountRaw ?? "") &&
    Number.isFinite(parsedAmount) &&
    Number.isSafeInteger(parsedAmount) &&
    parsedAmount >= 100
      ? parsedAmount
      : undefined;

  const errorRaw = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  const sanitizedError = errorRaw
    ? errorRaw.replace(/[\r\n\t]/g, "").slice(0, 200)
    : null;

  const action = donateNow.bind(null, GENERAL_FUND_SLUG, "/donate");

  const raisedDollars = (data.campaign.raisedCents / 100).toLocaleString();
  const hasProgress =
    data.campaign.raisedCents > 0 || data.campaign.donorCount > 0;

  return (
    <PublicShell>
      <div className="container" style={{ paddingTop: 48, paddingBottom: 72 }}>
        <Eyebrow>General fund</Eyebrow>
        <Display as="h1" size="xl" style={{ margin: "10px 0 14px" }}>
          Support the work
        </Display>
        <Lede style={{ marginBottom: 36 }}>
          Your gift supports everything we do, year-round.
        </Lede>

        {sanitizedError ? (
          <p role="alert" className="alert alert--bad" style={{ marginBottom: 16 }}>
            {sanitizedError}
          </p>
        ) : null}

        {hasProgress ? (
          <Card padded>
            <ProgressBar
              valueCents={data.campaign.raisedCents}
              targetCents={data.campaign.targetAmountCents}
              label="General fund progress"
            />
            <p className="muted" style={{ marginTop: 12 }}>
              ${raisedDollars} raised · {data.campaign.donorCount}{" "}
              {data.campaign.donorCount === 1 ? "donor" : "donors"}
            </p>
          </Card>
        ) : null}

        <div style={{ marginTop: hasProgress ? 24 : 0 }}>
          <DonatePanel
            campaignId={data.campaign.id}
            defaultCurrency={data.campaign.currency}
            defaultCadence={defaultCadence}
            defaultAmountCents={defaultAmountCents}
            action={action}
            disabled={isClosed}
            disabledReason={
              isClosed
                ? "This campaign is no longer accepting donations."
                : undefined
            }
          />
        </div>

        <p className="muted" style={{ marginTop: 24 }}>
          Looking to support a specific cause?{" "}
          <Link className="link" href="/coalitions">
            Browse our active initiatives.
          </Link>
        </p>
      </div>
    </PublicShell>
  );
}
