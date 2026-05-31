import { redirect } from "next/navigation";
import {
  ApiError,
  UnauthorizedError,
  listPaymentEvents,
  type PaymentEventListPage,
} from "@organizer-hub/web-shared";
import PaymentsList from "./PaymentsList";

interface SearchParams {
  cursor?: string;
  kind?: string;
}

export const dynamic = "force-dynamic";

export default async function MyPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  let page: PaymentEventListPage;
  try {
    page = await listPaymentEvents(params);
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
          My payments
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every charge, renewal, refund, and dispute on your account.
        </p>
      </div>
      <PaymentsList
        items={page.items}
        nextCursor={page.nextCursor}
        params={params}
      />
    </div>
  );
}
