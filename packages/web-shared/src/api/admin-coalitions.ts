import { apiFetch } from "./client";

export interface AdminCoalitionRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  displayOrder: number;
  status: string;
  updatedAt: string;
  _count: { campaigns: number };
}

export interface CoalitionListPage {
  items: AdminCoalitionRow[];
  nextCursor: string | null;
}

export interface ListCoalitionsAdminParams {
  status?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export function listCoalitionsAdmin(
  orgId: string,
  params: ListCoalitionsAdminParams = {},
): Promise<CoalitionListPage> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v));
  }
  const query = qs.toString();
  return apiFetch<CoalitionListPage>(
    `/orgs/${encodeURIComponent(orgId)}/coalitions${query ? `?${query}` : ""}`,
  );
}
