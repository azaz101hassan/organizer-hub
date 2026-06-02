import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import {
  ApiError,
  UnauthorizedError,
  getHouseOrgId,
  donationsEnabledForOrg,
  listCoalitionsAdmin,
  type AdminCoalitionRow,
  type CoalitionListPage,
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

interface SearchParams {
  status?: string;
  q?: string;
  cursor?: string;
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

  let page: CoalitionListPage = { items: [], nextCursor: null };
  try {
    page = await listCoalitionsAdmin(orgId, {
      ...(params.cursor ? { cursor: params.cursor } : {}),
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) {
      page = { items: [], nextCursor: null };
    } else {
      throw err;
    }
  }

  // Client-side filter by status and q (applied to the current page)
  const statusFilter = params.status && params.status !== "all" ? params.status : null;
  const qFilter = params.q?.toLowerCase().trim() ?? null;

  const filtered = page.items.filter((c: AdminCoalitionRow) => {
    if (statusFilter && c.status !== statusFilter) return false;
    if (qFilter && !c.name.toLowerCase().includes(qFilter)) return false;
    return true;
  });

  const nextHref = (() => {
    if (!page.nextCursor) return null;
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.q) qs.set("q", params.q);
    qs.set("cursor", page.nextCursor);
    return `/coalitions?${qs.toString()}`;
  })();

  const columns: Column<AdminCoalitionRow>[] = [
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
      {nextHref && (
        <div style={{ marginTop: 16 }}>
          <Link href={nextHref} className="link" style={{ fontSize: 13.5 }}>
            Next page →
          </Link>
        </div>
      )}
    </>
  );
}
