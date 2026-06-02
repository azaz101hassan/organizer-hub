import Link from "next/link";
import { Card } from "../primitives/Card";
import { formatCurrencyPrefix } from "./currency";

export interface CoalitionCardProps {
  slug: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  childCampaignCount: number;
  totalRaisedCents: number;
  currency?: string;
}

export function CoalitionCard({
  slug,
  name,
  description,
  coverImageUrl,
  childCampaignCount,
  totalRaisedCents,
  currency,
}: CoalitionCardProps) {
  const prefix = formatCurrencyPrefix(currency);
  const safeCents = Number.isFinite(totalRaisedCents) ? totalRaisedCents : 0;
  const dollars = (safeCents / 100).toLocaleString();
  const campaignLabel =
    childCampaignCount === 1 ? "1 campaign" : `${childCampaignCount} campaigns`;

  return (
    <Link href={`/coalitions/${slug}`} className="card-link">
      <Card padded>
        {coverImageUrl && <img src={coverImageUrl} alt="" />}
        <h3>{name}</h3>
        {description && <p>{description}</p>}
        <p>
          {campaignLabel} · {prefix}{dollars} raised
        </p>
      </Card>
    </Link>
  );
}
