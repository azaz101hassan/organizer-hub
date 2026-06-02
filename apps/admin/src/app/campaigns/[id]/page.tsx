import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ApiError,
  apiFetch,
  UnauthorizedError,
  getHouseOrgId,
  donationsEnabledForOrg,
} from "@organizer-hub/web-shared";
import {
  Card,
  DataTable,
  type Column,
  Pill,
  type PillTone,
  ProgressBar,
} from "@organizer-hub/web-shared/ui";
import { PageHead } from "../../../components/PageHead";
import CampaignEditForm from "./CampaignEditForm";
import StatusActions from "./StatusActions";

export const dynamic = "force-dynamic";

type CampaignStatus = "DRAFT" | "ACTIVE" | "COMPLETE" | "ARCHIVED";
type DonationStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "CANCELED" | "FAILED";
type DonationMode = "ONE_TIME" | "RECURRING";

interface CoalitionLite {
  id: string;
  slug: string;
  name: string;
  status: string;
}

interface CampaignDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  targetAmountCents: number;
  currency: string;
  deadline: string | null;
  status: CampaignStatus;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  coalitionId: string;
  coalition: CoalitionLite;
  raisedCents: number;
  donorCount: number;
  activeRecurringCount: number;
}

interface DonationRow {
  id: string;
  userId: string;
  mode: DonationMode;
  cadence: string;
  amountCents: number;
  currency: string;
  status: DonationStatus;
  createdAt: string;
  canceledAt: string | null;
}

function fmtCurrency(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const STATUS_PILL: Record<CampaignStatus, { tone: PillTone; label: string }> = {
  DRAFT: { tone: "pending", label: "Draft" },
  ACTIVE: { tone: "active", label: "Active" },
  COMPLETE: { tone: "paid", label: "Complete" },
  ARCHIVED: { tone: "lapsed", label: "Archived" },
};

const DONATION_STATUS_PILL: Record<DonationStatus, { tone: PillTone; label: string }> = {
  PENDING: { tone: "pending", label: "Pending" },
  ACTIVE: { tone: "active", label: "Active" },
  COMPLETED: { tone: "paid", label: "Completed" },
  CANCELED: { tone: "lapsed", label: "Canceled" },
  FAILED: { tone: "lapsed", label: "Failed" },
};

const CADENCE_LABEL: Record<string, string> = {
  ONCE: "Once",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

const MODE_LABEL: Record<DonationMode, string> = {
  ONE_TIME: "One-time",
  RECURRING: "Recurring",
};

export default async function AdminCampaignDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const orgId = getHouseOrgId();
  const enabled = await donationsEnabledForOrg();
  if (!enabled) notFound();

  const { id } = await params;

  let campaign: CampaignDetail;
  let donations: DonationRow[] = [];
  try {
    [campaign, donations] = await Promise.all([
      apiFetch<CampaignDetail>(
        `/orgs/${encodeURIComponent(orgId)}/campaigns/${encodeURIComponent(id)}`,
      ),
      apiFetch<DonationRow[]>(
        `/orgs/${encodeURIComponent(orgId)}/donations?campaignId=${encodeURIComponent(id)}`,
      ),
    ]);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const { tone: statusTone, label: statusLabel } =
    STATUS_PILL[campaign.status] ?? { tone: "pending" as PillTone, label: campaign.status };

  const columns: Column<DonationRow>[] = [
    {
      key: "userId",
      header: "Donor",
      cell: (d) => (
        // userId is shown truncated; a user-name lookup service does not exist yet.
        <span className="mono faint" style={{ fontSize: 12 }}>
          {d.userId.length > 12 ? `${d.userId.slice(0, 12)}…` : d.userId}
        </span>
      ),
    },
    {
      key: "mode",
      header: "Mode",
      width: 100,
      cell: (d) => (
        <Pill tone={d.mode === "RECURRING" ? "active" : "pending"}>
          {MODE_LABEL[d.mode] ?? d.mode}
        </Pill>
      ),
    },
    {
      key: "cadence",
      header: "Cadence",
      width: 100,
      cell: (d) => (
        <span className="faint" style={{ fontSize: 13 }}>
          {CADENCE_LABEL[d.cadence] ?? d.cadence}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      width: 110,
      cell: (d) => (
        <span className="mono" style={{ fontSize: 13.5 }}>
          {fmtCurrency(d.amountCents, d.currency)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: 110,
      cell: (d) => {
        const pill =
          DONATION_STATUS_PILL[d.status] ?? { tone: "pending" as PillTone, label: d.status };
        return <Pill tone={pill.tone}>{pill.label}</Pill>;
      },
    },
    {
      key: "createdAt",
      header: "Created",
      width: 120,
      cell: (d) => (
        <span className="faint" style={{ fontSize: 12 }}>
          {fmtDate(d.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHead
        title={campaign.name}
        crumb={
          <Link href={`/coalitions/${campaign.coalition.id}`} className="link">
            ← {campaign.coalition.name}
          </Link>
        }
        actions={<StatusActions campaign={{ id: campaign.id, status: campaign.status, coalitionId: campaign.coalitionId }} />}
      />

      {/* Status badge row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <Pill tone={statusTone}>{statusLabel}</Pill>
        <span className="faint" style={{ fontSize: 12 }}>
          {campaign.slug}
        </span>
      </div>

      {/* KPI grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <Card>
          <p
            style={{
              margin: "0 0 4px",
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Raised
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: "var(--ink)",
              letterSpacing: "-0.02em",
            }}
          >
            {fmtCurrency(campaign.raisedCents, campaign.currency)}
          </p>
        </Card>
        <Card>
          <p
            style={{
              margin: "0 0 4px",
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Goal
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: "var(--ink)",
              letterSpacing: "-0.02em",
            }}
          >
            {fmtCurrency(campaign.targetAmountCents, campaign.currency)}
          </p>
        </Card>
        <Card>
          <p
            style={{
              margin: "0 0 4px",
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Donors
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: "var(--ink)",
              letterSpacing: "-0.02em",
            }}
          >
            {String(campaign.donorCount)}
          </p>
        </Card>
        <Card>
          <p
            style={{
              margin: "0 0 4px",
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Active recurring
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: "var(--ink)",
              letterSpacing: "-0.02em",
            }}
          >
            {String(campaign.activeRecurringCount)}
          </p>
        </Card>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 28 }}>
        <ProgressBar
          valueCents={campaign.raisedCents}
          targetCents={campaign.targetAmountCents}
          label={`${campaign.name} fundraising progress`}
        />
      </div>

      {/* Edit form */}
      <Card>
        <CampaignEditForm campaign={campaign} />
      </Card>

      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          margin: "32px 0 12px",
          color: "var(--ink)",
        }}
      >
        Donations
      </h2>

      <DataTable
        columns={columns}
        rows={donations}
        empty="No donations on this campaign yet."
      />
    </>
  );
}
