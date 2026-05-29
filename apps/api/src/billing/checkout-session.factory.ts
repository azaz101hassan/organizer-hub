import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StripeClient } from './stripe.client';

export interface MintTicketSessionParams {
  userSub: string;
  customerId: string;
  eventId: string;
  ticketTypeId: string;
  stripePriceId: string;
  // Waitlist (PAID-approval) only: stamped into metadata so the webhook can
  // cross-check the back-link, and combined with expiry + idempotency key.
  ticketRequestId?: string;
  // The Checkout link's lifetime (R18: 24h for waitlist approvals). Omitted for
  // the under-cap direct purchase, which has no expiry.
  expiresInSeconds?: number;
  // Collapses a two-admin approval race to one shared session.
  idempotencyKey?: string;
}

// The ticket Checkout-session minting primitive, extracted so both the
// under-cap direct purchase (BillingService) and the at-cap PAID approval
// (ticket-requests' approvePaid, via the @Global BillingModule) mint identically
// — customer scoping, metadata, expiry, idempotency. The factory depends only
// on Stripe + config (the caller resolves the customer), so it carries no
// dependency on ticket-requests and creates no cycle.
@Injectable()
export class CheckoutSessionFactory {
  constructor(
    private readonly stripeClient: StripeClient,
    private readonly config: ConfigService,
  ) {}

  async mintTicketSession(
    params: MintTicketSessionParams,
  ): Promise<{ id: string; url: string }> {
    const webOrigin =
      this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';

    const metadata: Record<string, string> = {
      userId: params.userSub,
      eventId: params.eventId,
      ticketTypeId: params.ticketTypeId,
    };
    if (params.ticketRequestId) {
      metadata.ticketRequestId = params.ticketRequestId;
    }

    const session = await this.stripeClient.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer: params.customerId,
        client_reference_id: params.userSub,
        metadata,
        line_items: [{ price: params.stripePriceId, quantity: 1 }],
        success_url: `${webOrigin}/events/${params.eventId}?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${webOrigin}/events/${params.eventId}?purchase=canceled`,
        ...(params.expiresInSeconds
          ? {
              expires_at:
                Math.floor(Date.now() / 1000) + params.expiresInSeconds,
            }
          : {}),
      },
      params.idempotencyKey
        ? { idempotencyKey: params.idempotencyKey }
        : undefined,
    );

    if (!session.url) {
      throw new Error(
        `Stripe Checkout Session ${session.id} returned without a url`,
      );
    }
    return { id: session.id, url: session.url };
  }
}
