import { notFound } from "next/navigation";
import { publicApiFetch, donationsEnabledForOrg } from "@organizer-hub/web-shared";
import { Eyebrow, Display, Lede, Card, CampaignCard } from "@organizer-hub/web-shared/ui";
import { PublicShell } from "../../../components/PublicShell";

export const dynamic = "force-dynamic";

interface CoalitionDetail {
  coalition: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    coverImageUrl: string | null;
    childCampaignCount: number;
    totalRaisedCents: number;
  };
  campaigns: {
    id: string;
    slug: string;
    name: string;
    coverImageUrl: string | null;
    targetAmountCents: number;
    raisedCents: number;
    donorCount: number;
    deadline: string | null;
    status: "ACTIVE" | "COMPLETE";
  }[];
}

export default async function CoalitionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (!(await donationsEnabledForOrg())) notFound();
  const { slug } = await params;
  let data: CoalitionDetail;
  try {
    data = await publicApiFetch<CoalitionDetail>(
      `/coalitions/${encodeURIComponent(slug)}`,
    );
  } catch {
    notFound();
  }

  return (
    <PublicShell>
      <div className="container">
        {data.coalition.coverImageUrl ? (
          <img src={data.coalition.coverImageUrl} alt="" />
        ) : null}
        <Eyebrow>Initiative</Eyebrow>
        <Display as="h1" size="xl">
          {data.coalition.name}
        </Display>
        {data.coalition.description ? (
          <Lede>{data.coalition.description}</Lede>
        ) : null}

        {data.campaigns.length === 0 ? (
          <Card>
            <p>No active campaigns right now. Check back soon.</p>
          </Card>
        ) : (
          <div className="grid-3-narrow">
            {data.campaigns.map((c) => (
              <CampaignCard
                key={c.id}
                {...c}
                deadline={c.deadline ? new Date(c.deadline) : null}
              />
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  try {
    const data = await publicApiFetch<CoalitionDetail>(
      `/coalitions/${encodeURIComponent(slug)}`,
    );
    return {
      title: data.coalition.name,
      description:
        data.coalition.description?.slice(0, 160) ??
        `Support ${data.coalition.name}.`,
      openGraph: {
        title: data.coalition.name,
        description: data.coalition.description ?? undefined,
        images: data.coalition.coverImageUrl
          ? [data.coalition.coverImageUrl]
          : undefined,
      },
    };
  } catch {
    return { title: "Initiative" };
  }
}
