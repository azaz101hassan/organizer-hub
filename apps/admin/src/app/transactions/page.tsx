import { redirect } from "next/navigation";
import {
  ApiError,
  apiFetch,
  UnauthorizedError,
  getHouseOrgId,
  listPaymentEvents,
  type PaymentEventListPage,
} from "@organizer-hub/web-shared";
import { PageHead } from "../../components/PageHead";
import Filters from "./Filters";
import TransactionsTable from "./TransactionsTable";

interface SearchParams {
  cursor?: string;
  kind?: string;
  status?: string;
  userEmail?: string;
  from?: string;
  to?: string;
  campaignId?: string;
  recurringOnly?: string;
}

interface CampaignOption {
  id: string;
  name: string;
}

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const orgId = getHouseOrgId();
  const params = await searchParams;
  let page: PaymentEventListPage;
  try {
    const { recurringOnly, ...restParams } = params;
    page = await listPaymentEvents({
      organizationId: orgId,
      ...restParams,
      ...(recurringOnly === "true" || recurringOnly === "false"
        ? { recurringOnly }
        : {}),
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) {
      page = { items: [], nextCursor: null };
    } else {
      throw err;
    }
  }

  let campaigns: CampaignOption[] = [];
  if (params.kind === "DONATION") {
    try {
      campaigns = await apiFetch<CampaignOption[]>(
        `/orgs/${encodeURIComponent(orgId)}/campaigns`,
      );
    } catch (err) {
      if (err instanceof UnauthorizedError) redirect("/auth/login");
      // Non-fatal: render the page with no campaign options if the fetch fails.
      campaigns = [];
    }
  }

  return (
    <>
      <PageHead
        title="Transactions"
        sub="Payments, refunds, and disputes mirrored from Stripe."
      />
      <Filters params={params} orgId={orgId} campaigns={campaigns} />
      <TransactionsTable
        items={page.items}
        nextCursor={page.nextCursor}
        params={params}
      />
    </>
  );
}
