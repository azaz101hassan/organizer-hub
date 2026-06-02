import { cache } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
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
  const deadlineMs = data.campaign.deadline
    ? new Date(data.campaign.deadline).getTime()
    : null;
  const validDeadlineMs =
    deadlineMs !== null && Number.isFinite(deadlineMs) ? deadlineMs : null;
  const isClosed =
    data.campaign.status === "COMPLETE" ||
    (validDeadlineMs !== null && validDeadlineMs < nowMs);

  const safeRaised = Number.isFinite(data.campaign.raisedCents)
    ? data.campaign.raisedCents
    : 0;
  const safeTarget = Number.isFinite(data.campaign.targetAmountCents)
    ? data.campaign.targetAmountCents
    : 0;

  const rawCadence = Array.isArray(sp.cadence) ? sp.cadence[0] : sp.cadence;
  const defaultCadence: DonationCadence =
    rawCadence && (VALID_CADENCES as string[]).includes(rawCadence)
      ? (rawCadence as DonationCadence)
      : "ONCE";

  const rawAmount = Array.isArray(sp.amount) ? sp.amount[0] : sp.amount;
  const parsedAmount = rawAmount ? Number(rawAmount) : NaN;
  const defaultAmountCents = Number.isFinite(parsedAmount) ? parsedAmount : undefined;

  const rawError = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  const sanitizedError = rawError
    ? rawError.slice(0, 200).replace(/[\r\n\t]+/g, " ")
    : null;

  const action = donateNow.bind(null, data.campaign.slug, undefined);

  return (
    <PublicShell>
      <div className="container" style={{ paddingTop: 48, paddingBottom: 72 }}>
        <div className="campaign-layout">
          <article>
            {data.campaign.coverImageUrl ? (
              <div
                style={{
                  position: "relative",
                  marginBottom: 24,
                  width: "100%",
                  aspectRatio: "16 / 7",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <Image
                  src={data.campaign.coverImageUrl}
                  alt=""
                  fill
                  sizes="(max-width: 768px) 100vw, 720px"
                  style={{ objectFit: "cover" }}
                />
              </div>
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
                {validDeadlineMs !== null && (
                  <Fact icon="calendar" label="Ends">
                    {new Date(validDeadlineMs).toLocaleDateString()}
                  </Fact>
                )}
              </div>
            </Card>

            {sanitizedError ? (
              <p role="alert" className="alert alert--bad" style={{ marginTop: 16 }}>
                {sanitizedError}
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
