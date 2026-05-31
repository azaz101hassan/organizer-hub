import { redirect } from "next/navigation";
import {
  ApiError,
  UnauthorizedError,
  getHouseOrgId,
  listPaymentEvents,
  type PaymentEventListPage,
} from "@organizer-hub/web-shared";
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
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Transactions
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          All payments, refunds, and disputes mirrored from Stripe.
        </p>
      </div>
      <Filters params={params} orgId={orgId} />
      <TransactionsTable
        items={page.items}
        nextCursor={page.nextCursor}
        params={params}
      />
    </div>
  );
}
