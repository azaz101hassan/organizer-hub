import { apiFetch } from "./client";

export interface AdminCampaignRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  targetAmountCents: number;
  currency: string;
  deadline: string | null;
  displayOrder: number;
  status: string;
  coalitionId: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  coalition: {
    id: string;
    slug: string;
    name: string;
    status: string;
  };
}

export interface CampaignListPage {
  items: AdminCampaignRow[];
  nextCursor: string | null;
}

export interface ListCampaignsAdminParams {
  coalitionId?: string;
  cursor?: string;
  limit?: number;
}

export function listCampaignsAdmin(
  orgId: string,
  params: ListCampaignsAdminParams = {},
): Promise<CampaignListPage> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v));
  }
  const query = qs.toString();
  return apiFetch<CampaignListPage>(
    `/orgs/${encodeURIComponent(orgId)}/campaigns${query ? `?${query}` : ""}`,
  );
}
