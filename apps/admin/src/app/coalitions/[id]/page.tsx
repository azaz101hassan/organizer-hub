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
import CoalitionEditForm from "./CoalitionEditForm";
import NewCampaignDialog from "./NewCampaignDialog";

export const dynamic = "force-dynamic";

type CampaignStatus = "DRAFT" | "ACTIVE" | "COMPLETE" | "ARCHIVED";

interface CoalitionDetail {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  coverImageUrl?: string | null;
  displayOrder?: number | null;
  status: string;
  _count: { campaigns: number };
}

interface CampaignRow {
  id: string;
  name: string;
  slug: string;
  status: CampaignStatus;
  targetAmountCents: number;
  // raisedCents is not returned by the list endpoint — aggregate rolls up in a later iteration.
  raisedCents?: number | null;
  deadline?: string | null;
}

// Deadline values come from a YYYY-MM-DD <input type="date">, parsed by the API
// as UTC midnight. Render with timeZone UTC so a PST admin reads back the same
// calendar date they typed in — not the previous day due to local-offset shift.
function fmtDeadline(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtUsd(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const CAMPAIGN_STATUS_PILL: Record<CampaignStatus, { tone: PillTone; label: string }> = {
  DRAFT: { tone: "pending", label: "Draft" },
  ACTIVE: { tone: "active", label: "Active" },
  COMPLETE: { tone: "paid", label: "Complete" },
  ARCHIVED: { tone: "lapsed", label: "Archived" },
};

export default async function CoalitionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const orgId = getHouseOrgId();

  if (!(await donationsEnabledForOrg())) notFound();

  let coalition: CoalitionDetail;
  let campaigns: CampaignRow[] = [];

  try {
    [coalition, campaigns] = await Promise.all([
      apiFetch<CoalitionDetail>(
        `/orgs/${encodeURIComponent(orgId)}/coalitions/${encodeURIComponent(id)}`,
      ),
      apiFetch<CampaignRow[]>(
        `/orgs/${encodeURIComponent(orgId)}/campaigns?coalitionId=${encodeURIComponent(id)}`,
      ),
    ]);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const columns: Column<CampaignRow>[] = [
    {
      key: "name",
      header: "Name",
      cell: (c) => (
        <span style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 500 }}>
          {c.name}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: 110,
      cell: (c) => {
        const { tone, label } = CAMPAIGN_STATUS_PILL[c.status] ?? { tone: "pending" as PillTone, label: c.status };
        return <Pill tone={tone}>{label}</Pill>;
      },
    },
    {
      key: "target",
      header: "Target",
      numeric: true,
      width: 120,
      cell: (c) => (
        <span className="mono" style={{ fontSize: 13.5 }}>
          {fmtUsd(c.targetAmountCents)}
        </span>
      ),
    },
    {
      key: "raised",
      header: "Progress",
      cell: (c) => (
        // raisedCents is not included in the list response; falls back to 0 until
        // U25 adds aggregate fields to the admin campaign detail/list endpoints.
        <ProgressBar
          valueCents={c.raisedCents ?? 0}
          targetCents={c.targetAmountCents}
          label={`${c.name} progress`}
        />
      ),
    },
    {
      key: "deadline",
      header: "Deadline",
      width: 120,
      cell: (c) => (
        <span className="faint" style={{ fontSize: 12 }}>
          {c.deadline ? fmtDeadline(c.deadline) : "—"}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHead
        title={coalition.name}
        crumb={
          <Link href="/coalitions" className="link">
            ← Coalitions
          </Link>
        }
        actions={<NewCampaignDialog coalitionId={id} />}
      />

      <Card>
        <CoalitionEditForm coalition={coalition} />
      </Card>

      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          margin: "32px 0 12px",
          color: "var(--ink)",
        }}
      >
        Campaigns
      </h2>

      <DataTable
        columns={columns}
        rows={campaigns}
        empty="No campaigns under this coalition yet."
      />
    </>
  );
}
