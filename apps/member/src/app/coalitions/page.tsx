import { notFound } from "next/navigation";
import { publicApiFetch, donationsEnabledForOrg } from "@organizer-hub/web-shared";
import { Eyebrow, Display, Lede, CoalitionCard } from "@organizer-hub/web-shared/ui";
import { PublicShell } from "../../components/PublicShell";

export const dynamic = "force-dynamic";

interface CoalitionListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  childCampaignCount: number;
  totalRaisedCents: number;
}

export default async function CoalitionsPage() {
  if (!(await donationsEnabledForOrg())) notFound();

  let coalitions: CoalitionListItem[] = [];
  try {
    coalitions = await publicApiFetch<CoalitionListItem[]>("/coalitions");
  } catch (err) {
    console.error("[CoalitionsPage] fetch failed:", err);
    coalitions = [];
  }

  return (
    <PublicShell>
      <div
        className="container"
        style={{ paddingTop: 48, paddingBottom: 72 }}
      >
        <Eyebrow>Initiatives</Eyebrow>
        <Display as="h1" size="xl" style={{ margin: "10px 0 14px" }}>
          Where to give
        </Display>
        <Lede style={{ marginBottom: 36 }}>
          Pick an initiative to see the campaigns inside.
        </Lede>
        {coalitions.length === 0 ? (
          <p className="muted">
            No initiatives are open right now. Check back soon.
          </p>
        ) : (
          <div className="grid-3-narrow">
            {coalitions.map((c) => (
              <CoalitionCard key={c.id} {...c} />
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  );
}

export async function generateMetadata() {
  return {
    title: "Where to give",
    description: "Browse our active initiatives.",
  };
}
