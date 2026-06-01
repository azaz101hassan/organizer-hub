import Link from "next/link";
import { Card } from "../primitives/Card";
import { ProgressBar } from "../data/ProgressBar";
import { formatCurrencyPrefix } from "./currency";

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

function daysLeft(deadline: Date | string): number | null {
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil((ms - Date.now()) / 86_400_000));
}

export function CampaignCard({
  slug,
  name,
  coverImageUrl,
  targetAmountCents,
  raisedCents,
  donorCount,
  deadline,
  currency,
}: CampaignCardProps) {
  const prefix = formatCurrencyPrefix(currency);
  const safeRaised = Number.isFinite(raisedCents) ? raisedCents : 0;
  const safeTarget = Number.isFinite(targetAmountCents) ? targetAmountCents : 0;
  const raisedDollars = (safeRaised / 100).toLocaleString();
  const targetDollars = (safeTarget / 100).toLocaleString();
  const donorLabel = donorCount === 1 ? "1 donor" : `${donorCount} donors`;

  const days = deadline !== null ? daysLeft(deadline) : null;
  const deadlinePart =
    days === null ? null : days === 1 ? "1 day left" : `${days} days left`;

  return (
    <Link href={`/campaigns/${slug}`} className="card-link">
      <Card padded>
        {coverImageUrl && <img src={coverImageUrl} alt="" />}
        <h3>{name}</h3>
        <ProgressBar
          valueCents={safeRaised}
          targetCents={safeTarget}
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
