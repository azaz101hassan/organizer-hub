"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Toolbar } from "@organizer-hub/web-shared/ui";

const KINDS = [
  "TICKET",
  "MEMBERSHIP",
  "DONATION",
  "REFUND",
  "DISPUTE",
] as const;
const STATUSES = ["PENDING", "SUCCEEDED", "FAILED", "CANCELED"] as const;

interface FilterParams {
  cursor?: string;
  kind?: string;
  status?: string;
  userEmail?: string;
  from?: string;
  to?: string;
  campaignId?: string;
  recurringOnly?: string;
}

export interface CampaignOption {
  id: string;
  name: string;
}

export default function Filters({
  params,
  orgId,
  campaigns,
}: {
  params: FilterParams;
  orgId: string;
  campaigns: CampaignOption[];
}) {
  const router = useRouter();

  function hrefWith(key: keyof FilterParams, value: string | undefined) {
    return hrefWithMany({ [key]: value });
  }

  function hrefWithMany(updates: Partial<FilterParams>) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v && k !== "cursor" && !(k in updates)) qs.set(k, v);
    }
    for (const [k, v] of Object.entries(updates)) {
      if (v) qs.set(k, v);
    }
    const str = qs.toString();
    return `/transactions${str ? `?${str}` : ""}`;
  }

  // Kind chips: when clicking a non-DONATION kind while recurringOnly=true is
  // active, drop recurringOnly to keep the URL API-valid.
  function kindHref(value: string | undefined) {
    if (params.recurringOnly === "true" && value !== "DONATION") {
      return hrefWithMany({ kind: value, recurringOnly: undefined });
    }
    return hrefWith("kind", value);
  }

  // Recurring chip: toggling ON also forces kind=DONATION; toggling OFF leaves kind alone.
  function recurringHref(currentlyActive: boolean) {
    if (currentlyActive) {
      return hrefWithMany({ recurringOnly: undefined });
    }
    return hrefWithMany({ recurringOnly: "true", kind: "DONATION" });
  }

  function onCampaignChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(hrefWithMany({ campaignId: e.target.value || undefined }));
  }

  const csvHref = (() => {
    const qs = new URLSearchParams({ organizationId: orgId });
    for (const [k, v] of Object.entries(params)) {
      if (v && k !== "cursor") qs.set(k, v);
    }
    return `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/transactions.csv?${qs.toString()}`;
  })();

  return (
    <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 10 }}>
      <Toolbar>
        <FilterChip href={kindHref(undefined)} active={!params.kind}>
          All kinds
        </FilterChip>
        {KINDS.map((k) => (
          <FilterChip key={k} href={kindHref(k)} active={params.kind === k}>
            {k}
          </FilterChip>
        ))}
      </Toolbar>
      <Toolbar>
        <FilterChip href={hrefWith("status", undefined)} active={!params.status}>
          All statuses
        </FilterChip>
        {STATUSES.map((s) => (
          <FilterChip key={s} href={hrefWith("status", s)} active={params.status === s}>
            {s}
          </FilterChip>
        ))}
      </Toolbar>
      <Toolbar>
        <FilterChip
          href={recurringHref(params.recurringOnly === "true")}
          active={params.recurringOnly === "true"}
        >
          Recurring only
        </FilterChip>
      </Toolbar>
      {params.kind === "DONATION" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label htmlFor="campaign-filter" className="muted" style={{ fontSize: 12.5 }}>
            Campaign
          </label>
          <select
            id="campaign-filter"
            value={params.campaignId ?? ""}
            onChange={onCampaignChange}
            style={{ fontSize: 13, padding: "4px 8px" }}
          >
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}
      <a
        href={csvHref}
        download
        className="link"
        style={{ fontSize: 12.5, alignSelf: "flex-start" }}
      >
        Export CSV →
      </a>
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={active ? "chip chip--active" : "chip"} aria-pressed={active}>
      {children}
    </Link>
  );
}
