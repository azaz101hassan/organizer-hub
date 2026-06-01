import Link from "next/link";
import { Card } from "../primitives/Card";
import { ProgressBar } from "../data/ProgressBar";

export interface CampaignCardProps {
  slug: string;
  name: string;
  coverImageUrl: string | null;
  targetAmountCents: number;
  raisedCents: number;
  donorCount: number;
  deadline: Date | string | null;
  currency?: string;
}

function formatCurrencyPrefix(currency: string): string {
  if (currency.toLowerCase() === "usd") return "$";
  return `${currency.toUpperCase()} `;
}

function daysLeft(deadline: Date | string): number {
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86_400_000));
}

export function CampaignCard({
  slug,
  name,
  coverImageUrl,
  targetAmountCents,
  raisedCents,
  donorCount,
  deadline,
  currency = "usd",
}: CampaignCardProps) {
  const prefix = formatCurrencyPrefix(currency);
  const raisedDollars = (raisedCents / 100).toLocaleString();
  const targetDollars = (targetAmountCents / 100).toLocaleString();
  const donorLabel = donorCount === 1 ? "1 donor" : `${donorCount} donors`;

  let deadlinePart: string | null = null;
  if (deadline !== null) {
    const days = daysLeft(deadline);
    deadlinePart = days === 1 ? "1 day left" : `${days} days left`;
  }

  return (
    <Link href={`/campaigns/${slug}`} className="card-link">
      <Card padded>
        {coverImageUrl && <img src={coverImageUrl} alt="" />}
        <h3>{name}</h3>
        <ProgressBar
          valueCents={raisedCents}
          targetCents={targetAmountCents}
          label={`${name} progress`}
        />
        <p>
          {prefix}{raisedDollars} raised of {prefix}{targetDollars}
        </p>
        <p>
          {donorLabel}
          {deadlinePart && ` · ${deadlinePart}`}
        </p>
      </Card>
    </Link>
  );
}
