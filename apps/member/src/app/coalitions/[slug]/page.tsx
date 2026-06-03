import { cache } from "react";
import { notFound } from "next/navigation";
import Image from "next/image";
import {
  ApiError,
  publicApiFetch,
} from "@organizer-hub/web-shared";
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
  }[];
}

const getCoalition = cache((slug: string) =>
  publicApiFetch<CoalitionDetail>(`/coalitions/${encodeURIComponent(slug)}`),
);

export default async function CoalitionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let data: CoalitionDetail;
  try {
    data = await getCoalition(slug);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <PublicShell>
      <div
        className="container"
        style={{ paddingTop: 48, paddingBottom: 72 }}
      >
        {data.coalition.coverImageUrl ? (
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
              src={data.coalition.coverImageUrl}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, 960px"
              style={{ objectFit: "cover" }}
            />
          </div>
        ) : null}
        <Eyebrow>Initiative</Eyebrow>
        <Display as="h1" size="xl" style={{ margin: "10px 0 14px" }}>
          {data.coalition.name}
        </Display>
        {data.coalition.description ? (
          <Lede style={{ marginBottom: 36 }}>{data.coalition.description}</Lede>
        ) : (
          <div style={{ marginBottom: 36 }} />
        )}

        {data.campaigns.length === 0 ? (
          <Card padded>
            <p className="muted">
              No active campaigns right now. Check back soon.
            </p>
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
    const data = await getCoalition(slug);
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
