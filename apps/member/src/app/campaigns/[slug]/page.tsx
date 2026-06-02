import { cache } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ApiError,
  publicApiFetch,
  donationsEnabledForOrg as donationsEnabledForOrgRaw,
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
import { PublicShell } from "../../../components/PublicShell";
import { Fact } from "../../../components/Fact";
import { donateNow } from "../actions";

export const dynamic = "force-dynamic";

const VALID_CADENCES: DonationCadence[] = ["ONCE", "MONTHLY", "QUARTERLY", "YEARLY"];

interface CampaignDetail {
  campaign: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    coverImageUrl: string | null;
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

const donationsEnabled = cache(donationsEnabledForOrgRaw);
const getCampaign = cache((slug: string) =>
  publicApiFetch<CampaignDetail>(`/campaigns/${encodeURIComponent(slug)}`),
);

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ cadence?: string; amount?: string; error?: string }>;
}) {
  if (!(await donationsEnabled())) notFound();
  const { slug } = await params;
  const sp = await searchParams;

  let data: CampaignDetail;
  try {
    data = await getCampaign(slug);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const nowMs = new Date().valueOf();
  const isClosed =
    data.campaign.status === "COMPLETE" ||
    (data.campaign.deadline !== null &&
      new Date(data.campaign.deadline).getTime() < nowMs);

  const safeRaised = Number.isFinite(data.campaign.raisedCents)
    ? data.campaign.raisedCents
    : 0;
  const safeTarget = Number.isFinite(data.campaign.targetAmountCents)
    ? data.campaign.targetAmountCents
    : 0;

  const rawCadence = sp.cadence;
  const defaultCadence: DonationCadence =
    rawCadence && (VALID_CADENCES as string[]).includes(rawCadence)
      ? (rawCadence as DonationCadence)
      : "ONCE";

  const parsedAmount = sp.amount ? Number(sp.amount) : NaN;
  const defaultAmountCents = Number.isFinite(parsedAmount) ? parsedAmount : undefined;

  const action = donateNow.bind(null, data.campaign.slug);

  return (
    <PublicShell>
      <div className="container" style={{ paddingTop: 48, paddingBottom: 72 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 360px",
            gap: 48,
            alignItems: "start",
          }}
        >
          <article>
            {data.campaign.coverImageUrl ? (
              <img
                src={data.campaign.coverImageUrl}
                alt=""
                style={{ marginBottom: 24, width: "100%", borderRadius: 8 }}
              />
            ) : null}
            <Eyebrow>
              <Link href={`/coalitions/${data.coalition.slug}`}>{data.coalition.name}</Link>
            </Eyebrow>
            <Display as="h1" size="xl" style={{ margin: "10px 0 14px" }}>
              {data.campaign.name}
            </Display>
            {data.campaign.description ? (
              <Lede style={{ marginBottom: 24 }}>{data.campaign.description}</Lede>
            ) : null}
            {data.campaign.recentGiftCount > 0 && (
              <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
                {data.campaign.recentGiftCount} gift{data.campaign.recentGiftCount === 1 ? "" : "s"} in the last 30 days.
              </p>
            )}
          </article>

          <aside>
            <Card padded>
              <ProgressBar
                valueCents={safeRaised}
                targetCents={safeTarget}
                label={`Fundraising progress for ${data.campaign.name}`}
              />
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                <Fact icon="dollar" label="Raised">
                  ${(safeRaised / 100).toLocaleString()}
                </Fact>
                <Fact icon="pie" label="Goal">
                  ${(safeTarget / 100).toLocaleString()}
                </Fact>
                <Fact icon="users" label="Donors">
                  {data.campaign.donorCount}
                </Fact>
                {data.campaign.deadline && (
                  <Fact icon="calendar" label="Ends">
                    {new Date(data.campaign.deadline).toLocaleDateString()}
                  </Fact>
                )}
              </div>
            </Card>

            {sp.error ? (
              <p role="alert" style={{ marginTop: 16, marginBottom: 0, color: "var(--bad)" }}>
                {sp.error}
              </p>
            ) : null}

            <div style={{ marginTop: 16 }}>
              <DonatePanel
                campaignId={data.campaign.id}
                defaultCurrency={data.campaign.currency}
                defaultCadence={defaultCadence}
                defaultAmountCents={defaultAmountCents}
                action={action}
                disabled={isClosed}
                disabledReason={
                  isClosed ? "This campaign is no longer accepting donations." : undefined
                }
              />
            </div>
          </aside>
        </div>
      </div>
    </PublicShell>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (!(await donationsEnabled())) return { title: "Campaign" };
  const { slug } = await params;
  try {
    const data = await getCampaign(slug);
    return {
      title: data.campaign.name,
      description:
        data.campaign.description?.slice(0, 160) ??
        `Support ${data.campaign.name}.`,
      openGraph: {
        title: data.campaign.name,
        description: data.campaign.description ?? undefined,
        images: data.campaign.coverImageUrl
          ? [data.campaign.coverImageUrl]
          : undefined,
      },
      twitter: { card: "summary_large_image" },
    };
  } catch {
    return { title: "Campaign" };
  }
}
