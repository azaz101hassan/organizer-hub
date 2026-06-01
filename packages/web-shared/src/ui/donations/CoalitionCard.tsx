import Link from "next/link";
import { Card } from "../primitives/Card";

export interface CoalitionCardProps {
  slug: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  childCampaignCount: number;
  totalRaisedCents: number;
  currency?: string;
}

function formatCurrencyPrefix(currency: string): string {
  if (currency.toLowerCase() === "usd") return "$";
  return `${currency.toUpperCase()} `;
}

export function CoalitionCard({
  slug,
  name,
  description,
  coverImageUrl,
  childCampaignCount,
  totalRaisedCents,
  currency = "usd",
}: CoalitionCardProps) {
  const prefix = formatCurrencyPrefix(currency);
  const dollars = (totalRaisedCents / 100).toLocaleString();
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
