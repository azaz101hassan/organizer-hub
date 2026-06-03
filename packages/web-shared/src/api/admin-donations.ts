import { apiFetch } from "./client";

export interface AdminDonationRow {
  id: string;
  userId: string;
  organizationId: string;
  campaignId: string;
  mode: string;
  cadence: string;
  amountCents: number;
  currency: string;
  status: string;
  createdAt: string;
  canceledAt: string | null;
  campaign: {
    id: string;
    slug: string;
    name: string;
    coalition: { id: string; slug: string; name: string };
  };
}

export interface DonationListPage {
  items: AdminDonationRow[];
  nextCursor: string | null;
}

export interface ListDonationsAdminParams {
  campaignId?: string;
  mode?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}

export function listDonationsAdmin(
  orgId: string,
  params: ListDonationsAdminParams = {},
): Promise<DonationListPage> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v));
  }
  const query = qs.toString();
  return apiFetch<DonationListPage>(
    `/orgs/${encodeURIComponent(orgId)}/donations${query ? `?${query}` : ""}`,
  );
}
