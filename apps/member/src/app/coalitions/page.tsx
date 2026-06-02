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
  const coalitions = await publicApiFetch<CoalitionListItem[]>("/coalitions");

  return (
    <PublicShell>
      <div className="container">
        <Eyebrow>Initiatives</Eyebrow>
        <Display as="h1" size="xl">Where to give</Display>
        <Lede>Pick an initiative to see the campaigns inside.</Lede>
        <div className="grid-3-narrow">
          {coalitions.map((c) => (
            <CoalitionCard key={c.id} {...c} />
          ))}
        </div>
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
