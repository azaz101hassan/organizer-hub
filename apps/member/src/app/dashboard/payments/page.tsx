import { redirect } from "next/navigation";
import {
  ApiError,
  UnauthorizedError,
  listPaymentEvents,
  type PaymentEventListPage,
} from "@organizer-hub/web-shared";
import { Display, Eyebrow, Lede } from "@organizer-hub/web-shared/ui";
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
      <Eyebrow muted style={{ marginBottom: 8 }}>Account</Eyebrow>
      <Display as="h1" size="lg" style={{ marginBottom: 8 }}>
        My payments
      </Display>
      <Lede style={{ marginBottom: 32, fontSize: 15 }}>
        Every charge, renewal, refund, and dispute on your account.
      </Lede>
      <PaymentsList
        items={page.items}
        nextCursor={page.nextCursor}
        params={params}
      />
    </div>
  );
}
