import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ApiError,
  apiFetch,
  UnauthorizedError,
  getHouseOrgId,
  listCampaignsAdmin,
  type CampaignListPage,
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
import StatusActions from "./StatusActions";

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

const COALITION_STATUS_PILL: Record<string, { tone: PillTone; label: string }> = {
  ACTIVE: { tone: "active", label: "Active" },
  ARCHIVED: { tone: "lapsed", label: "Archived" },
};

const CAMPAIGN_STATUS_PILL: Record<CampaignStatus, { tone: PillTone; label: string }> = {
  DRAFT: { tone: "pending", label: "Draft" },
  ACTIVE: { tone: "active", label: "Active" },
  COMPLETE: { tone: "paid", label: "Complete" },
  ARCHIVED: { tone: "lapsed", label: "Archived" },
};

export default async function CoalitionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { id } = await params;
  const { cursor } = await searchParams;
  const orgId = getHouseOrgId();

  let coalition: CoalitionDetail;
  let campaignPage: CampaignListPage = { items: [], nextCursor: null };

  try {
    [coalition, campaignPage] = await Promise.all([
      apiFetch<CoalitionDetail>(
        `/orgs/${encodeURIComponent(orgId)}/coalitions/${encodeURIComponent(id)}`,
      ),
      listCampaignsAdmin(orgId, {
        coalitionId: id,
        ...(cursor ? { cursor } : {}),
      }),
    ]);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const campaigns = campaignPage.items as unknown as CampaignRow[];
  const nextCampaignHref = campaignPage.nextCursor
    ? `/coalitions/${encodeURIComponent(id)}?cursor=${encodeURIComponent(campaignPage.nextCursor)}`
    : null;
  const backToStartHref = cursor
    ? `/coalitions/${encodeURIComponent(id)}`
    : null;

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

  const { tone: coalitionStatusTone, label: coalitionStatusLabel } =
    COALITION_STATUS_PILL[coalition.status] ?? { tone: "pending" as PillTone, label: coalition.status };

  return (
    <>
      <PageHead
        title={coalition.name}
        crumb={
          <Link href="/coalitions" className="link">
            ← Coalitions
          </Link>
        }
        actions={
          <>
            <StatusActions coalition={{ id: coalition.id, status: coalition.status }} />
            <NewCampaignDialog coalitionId={id} />
          </>
        }
      />

      {/* Status badge row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <Pill tone={coalitionStatusTone}>{coalitionStatusLabel}</Pill>
        <span className="faint" style={{ fontSize: 12 }}>
          {coalition.slug}
        </span>
      </div>

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
      {(backToStartHref || nextCampaignHref) && (
        <div
          style={{
            marginTop: 16,
            display: "flex",
            justifyContent: "space-between",
            fontSize: 13.5,
          }}
        >
          {backToStartHref ? (
            <Link href={backToStartHref} className="link">
              ← Back to start
            </Link>
          ) : (
            <span />
          )}
          {nextCampaignHref ? (
            <Link href={nextCampaignHref} className="link">
              Next page →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </>
  );
}
