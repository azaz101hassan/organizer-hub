import type { PaymentEventView } from "./types";
import { apiFetch } from "./client";

export interface PaymentEventListPage {
  items: PaymentEventView[];
  nextCursor: string | null;
}

export interface ListPaymentEventsParams {
  cursor?: string;
  limit?: number;
  kind?: string;
  status?: string;
  organizationId?: string;
  userEmail?: string;
  from?: string;
  to?: string;
  campaignId?: string;
  recurringOnly?: 'true' | 'false';
}

export function listPaymentEvents(
  params: ListPaymentEventsParams = {},
): Promise<PaymentEventListPage> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v));
  }
  return apiFetch<PaymentEventListPage>(
    `/payment-events?${qs.toString()}`,
  );
}

export function getPaymentEvent(id: string): Promise<PaymentEventView> {
  return apiFetch<PaymentEventView>(
    `/payment-events/${encodeURIComponent(id)}`,
  );
}
