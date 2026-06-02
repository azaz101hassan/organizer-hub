import { redirect, notFound } from "next/navigation";
import {
  ApiError,
  apiFetch,
  UnauthorizedError,
  getHouseOrgId,
  donationsEnabledForOrg,
} from "@organizer-hub/web-shared";
import {
  DataTable,
  type Column,
  Pill,
} from "@organizer-hub/web-shared/ui";
import { PageHead } from "../../components/PageHead";
import NewCoalitionDialog from "./NewCoalitionDialog";
import Filters from "./Filters";

export const dynamic = "force-dynamic";

type CoalitionStatus = "ACTIVE" | "ARCHIVED";

interface CoalitionRow {
  id: string;
  name: string;
  slug: string;
  status: CoalitionStatus;
  updatedAt: string;
  _count: { campaigns: number };
}

interface SearchParams {
  status?: string;
  q?: string;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function CoalitionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const orgId = getHouseOrgId();
  const params = await searchParams;

  const enabled = await donationsEnabledForOrg();
  if (!enabled) notFound();

  let coalitions: CoalitionRow[] = [];
  try {
    coalitions = await apiFetch<CoalitionRow[]>(
      `/orgs/${encodeURIComponent(orgId)}/coalitions`,
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) {
      coalitions = [];
    } else {
      throw err;
    }
  }

  // Client-side filter by status and q (done after fetch — list is small)
  const statusFilter = params.status && params.status !== "all" ? params.status : null;
  const qFilter = params.q?.toLowerCase().trim() ?? null;

  const filtered = coalitions.filter((c) => {
    if (statusFilter && c.status !== statusFilter) return false;
    if (qFilter && !c.name.toLowerCase().includes(qFilter)) return false;
    return true;
  });

  const columns: Column<CoalitionRow>[] = [
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
      key: "slug",
      header: "Slug",
      cell: (c) => (
        <span className="mono faint" style={{ fontSize: 12 }}>
          {c.slug}
        </span>
      ),
    },
    {
      key: "campaigns",
      header: "Campaigns",
      numeric: true,
      width: 110,
      cell: (c) => (
        <span className="mono" style={{ fontSize: 13.5 }}>
          {c._count.campaigns}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: 110,
      cell: (c) =>
        c.status === "ACTIVE" ? (
          <Pill tone="active">Active</Pill>
        ) : (
          <Pill tone="lapsed">Archived</Pill>
        ),
    },
    {
      key: "updatedAt",
      header: "Updated",
      width: 130,
      cell: (c) => (
        <span className="faint" style={{ fontSize: 12 }}>
          {fmtDate(c.updatedAt)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHead
        title="Coalitions"
        sub="Group campaigns into themed fundraising collections."
        actions={<NewCoalitionDialog />}
      />

      <Filters params={params} />

      <DataTable
        columns={columns}
        rows={filtered}
        empty="No coalitions match the current filters."
      />
    </>
  );
}
