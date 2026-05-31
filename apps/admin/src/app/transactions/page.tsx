import { redirect } from "next/navigation";
import {
  ApiError,
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
    page = await listPaymentEvents({ organizationId: orgId, ...params });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) {
      page = { items: [], nextCursor: null };
    } else {
      throw err;
    }
  }

  return (
    <>
      <PageHead
        title="Transactions"
        sub="Payments, refunds, and disputes mirrored from Stripe."
      />
      <Filters params={params} orgId={orgId} />
      <TransactionsTable
        items={page.items}
        nextCursor={page.nextCursor}
        params={params}
      />
    </>
  );
}
