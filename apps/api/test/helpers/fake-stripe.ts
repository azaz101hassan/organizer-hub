/* eslint-disable @typescript-eslint/require-await -- the fake mirrors the
 * Stripe SDK's async surface so production code can `await` it; the fake
 * itself has no real async work, but the API contract has to match. */
import { BadRequestException } from '@nestjs/common';
import type { Stripe } from '../../src/billing/stripe-types';

// Lightweight in-memory Stripe stand-ins used by e2e specs. Each fake records
// the calls it received so tests can assert "stripe.X.create was invoked with
// these args" without booting a real network call. Scope grows as new units
// land — start narrow and add methods only when a test needs them.
//
// The fake exposes its own in-house parameter shapes (FakeCustomerCreateParams,
// etc.) rather than reaching into the Stripe SDK types — Stripe's params are
// inferred-with-undefined under our CJS-mode type shim, and we don't need
// the exact SDK contract for test doubles.

// ---------- Public shapes ----------

export type FakeSubscriptionStatus =
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused';

export interface FakeCheckoutSession {
  id: string;
  url: string | null;
  mode: 'subscription' | 'payment';
  customer: string;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
  payment_intent?: string | null;
  subscription?: string | null;
  expires_at?: number | null;
  status?: 'open' | 'complete' | 'expired';
}

export interface FakeStripeCall {
  method: string;
  args: unknown[];
}

export interface FakeStripePrice {
  id: string;
  lookup_key: string | null;
  product: string;
  unit_amount: number;
  currency: string;
  active: boolean;
}

export interface FakeStripeProduct {
  id: string;
  name: string;
  active: boolean;
}

export interface FakeStripeSubscription {
  id: string;
  customer: string;
  status: FakeSubscriptionStatus;
  cancel_at_period_end: boolean;
  metadata?: Record<string, string>;
  items: {
    data: Array<{
      id: string;
      price: FakeStripePrice;
      current_period_end: number; // unix seconds
    }>;
  };
}

export interface FakeStripeInvoice {
  id: string;
  customer: string;
  subscription: string | null;
  status: string;
}

// ---------- In-house param shapes (subset of Stripe SDK) ----------

interface CustomerCreateP {
  email?: string;
  metadata?: Record<string, string>;
}
interface ProductCreateP {
  name: string;
  active?: boolean;
}
interface ProductUpdateP {
  name?: string;
  active?: boolean;
}
interface PriceCreateP {
  product: string;
  unit_amount?: number;
  currency: string;
  lookup_key?: string;
  recurring?: { interval: 'month' | 'year' };
}
interface PriceUpdateP {
  active?: boolean;
}
interface PriceListP {
  lookup_keys?: string[];
  active?: boolean;
  limit?: number;
}
interface SubListP {
  customer: string;
  status?: string;
  limit?: number;
}
interface SubUpdateP {
  cancel_at_period_end?: boolean;
  items?: Array<{ id: string; price: string }>;
  proration_behavior?: 'always_invoice' | 'none' | 'create_prorations';
}
interface CheckoutCreateP {
  mode?: 'subscription' | 'payment';
  customer?: string;
  client_reference_id?: string;
  metadata?: Record<string, string>;
  line_items?: Array<{ price: string; quantity?: number }>;
  success_url?: string;
  cancel_url?: string;
  expires_at?: number;
}
interface PortalCreateP {
  customer: string;
  return_url?: string;
}
interface RefundCreateP {
  payment_intent?: string;
}
interface RequestOptionsP {
  idempotencyKey?: string;
}

export interface FakeStripeCharge {
  id: string;
  metadata: Record<string, string>;
}

export class FakeStripeClient {
  readonly calls: FakeStripeCall[] = [];
  readonly customers = new Map<
    string,
    { id: string; metadata: Record<string, string>; email?: string }
  >();
  readonly products = new Map<string, FakeStripeProduct>();
  readonly prices = new Map<string, FakeStripePrice>();
  readonly subscriptions = new Map<string, FakeStripeSubscription>();
  readonly checkoutSessions = new Map<string, FakeCheckoutSession>();
  // idempotencyKey -> sessionId, so a retried create with the same key returns
  // the same session (mirrors Stripe; the two-admin approve race shares one).
  private readonly idempotentSessions = new Map<string, string>();
  readonly invoices = new Map<string, FakeStripeInvoice>();
  readonly charges = new Map<string, FakeStripeCharge>();
  readonly refunds: Array<{
    payment_intent: string;
    idempotencyKey?: string;
  }> = [];
  private nextId = 1;

  // The fake's `stripe` property mirrors `stripeClient.stripe.<…>` access from
  // the production code. Typed as `unknown` and cast at the boundary — the
  // production code never sees the FakeStripeClient directly, only its
  // structural surface through the StripeClient provider override.
  get stripe(): unknown {
    return {
      customers: {
        create: async (params: CustomerCreateP): Promise<{ id: string }> => {
          this.calls.push({ method: 'customers.create', args: [params] });
          const id = `cus_test_${this.nextId++}`;
          this.customers.set(id, {
            id,
            metadata: params.metadata ?? {},
            email: params.email,
          });
          return { id };
        },
        retrieve: async (
          id: string,
        ): Promise<{ id: string; metadata: Record<string, string> }> => {
          this.calls.push({ method: 'customers.retrieve', args: [id] });
          const c = this.customers.get(id);
          if (!c) throw new Error(`No such customer: ${id}`);
          return { id: c.id, metadata: c.metadata };
        },
      },
      products: {
        create: async (params: ProductCreateP): Promise<FakeStripeProduct> => {
          this.calls.push({ method: 'products.create', args: [params] });
          const id = `prod_test_${this.nextId++}`;
          const prod: FakeStripeProduct = {
            id,
            name: params.name,
            active: true,
          };
          this.products.set(id, prod);
          return prod;
        },
        update: async (
          id: string,
          params: ProductUpdateP,
        ): Promise<FakeStripeProduct> => {
          this.calls.push({ method: 'products.update', args: [id, params] });
          const prod = this.products.get(id);
          if (!prod) throw new Error(`No such product: ${id}`);
          if (params.name !== undefined) prod.name = params.name;
          if (params.active !== undefined) prod.active = params.active;
          return prod;
        },
      },
      prices: {
        create: async (params: PriceCreateP): Promise<FakeStripePrice> => {
          this.calls.push({ method: 'prices.create', args: [params] });
          const id = `price_test_${this.nextId++}`;
          const price: FakeStripePrice = {
            id,
            lookup_key: params.lookup_key ?? null,
            product: params.product,
            unit_amount: params.unit_amount ?? 0,
            currency: params.currency,
            active: true,
          };
          this.prices.set(id, price);
          return price;
        },
        update: async (
          id: string,
          params: PriceUpdateP,
        ): Promise<FakeStripePrice> => {
          this.calls.push({ method: 'prices.update', args: [id, params] });
          const p = this.prices.get(id);
          if (!p) throw new Error(`No such price: ${id}`);
          if (params.active !== undefined) p.active = params.active;
          return p;
        },
        list: async (
          params: PriceListP,
        ): Promise<{ data: FakeStripePrice[] }> => {
          this.calls.push({ method: 'prices.list', args: [params] });
          const wanted = params.lookup_keys ?? [];
          const out = [...this.prices.values()].filter(
            (p) =>
              p.active &&
              p.lookup_key !== null &&
              wanted.includes(p.lookup_key),
          );
          return { data: out };
        },
      },
      subscriptions: {
        list: async (
          params: SubListP,
        ): Promise<{ data: FakeStripeSubscription[] }> => {
          this.calls.push({ method: 'subscriptions.list', args: [params] });
          const out = [...this.subscriptions.values()].filter(
            (s) => s.customer === params.customer,
          );
          return { data: out };
        },
        retrieve: async (
          id: string,
        ): Promise<
          FakeStripeSubscription & { metadata: Record<string, string> }
        > => {
          this.calls.push({ method: 'subscriptions.retrieve', args: [id] });
          const sub = this.subscriptions.get(id);
          if (!sub) throw new Error(`No such subscription: ${id}`);
          return { ...sub, metadata: sub.metadata ?? {} };
        },
        update: async (
          id: string,
          params: SubUpdateP,
        ): Promise<FakeStripeSubscription> => {
          this.calls.push({
            method: 'subscriptions.update',
            args: [id, params],
          });
          const sub = this.subscriptions.get(id);
          if (!sub) throw new Error(`No such subscription: ${id}`);
          if (params.cancel_at_period_end !== undefined) {
            sub.cancel_at_period_end = params.cancel_at_period_end;
          }
          return sub;
        },
      },
      checkout: {
        sessions: {
          create: async (
            params: CheckoutCreateP,
            options?: RequestOptionsP,
          ): Promise<FakeCheckoutSession> => {
            this.calls.push({
              method: 'checkout.sessions.create',
              args: [params, options],
            });
            const key = options?.idempotencyKey;
            if (key) {
              const existingId = this.idempotentSessions.get(key);
              const existing = existingId
                ? this.checkoutSessions.get(existingId)
                : undefined;
              if (existing) return existing;
            }
            const id = `cs_test_${this.nextId++}`;
            const url = `https://checkout.stripe.test/${id}`;
            const session: FakeCheckoutSession = {
              id,
              url,
              mode: params.mode ?? 'payment',
              customer: params.customer ?? '',
              client_reference_id: params.client_reference_id ?? null,
              metadata: params.metadata ?? {},
              // A real payment-mode session carries a PaymentIntent once paid;
              // pre-populate one so a queued checkout.session.completed for this
              // session has something to (refund or record) against.
              payment_intent: params.mode === 'payment' ? `pi_${id}` : null,
              subscription: null,
              expires_at: params.expires_at ?? null,
              status: 'open',
            };
            this.checkoutSessions.set(id, session);
            if (key) this.idempotentSessions.set(key, id);
            return session;
          },
          retrieve: async (id: string): Promise<FakeCheckoutSession> => {
            this.calls.push({
              method: 'checkout.sessions.retrieve',
              args: [id],
            });
            const session = this.checkoutSessions.get(id);
            if (!session) throw new Error(`No such checkout session: ${id}`);
            return session;
          },
        },
      },
      billingPortal: {
        sessions: {
          create: async (
            params: PortalCreateP,
          ): Promise<{ id: string; url: string }> => {
            this.calls.push({
              method: 'billingPortal.sessions.create',
              args: [params],
            });
            const id = `bps_test_${this.nextId++}`;
            return { id, url: `https://billing.stripe.test/${id}` };
          },
        },
      },
      refunds: {
        create: async (
          params: RefundCreateP,
          options?: RequestOptionsP,
        ): Promise<{ id: string }> => {
          this.calls.push({
            method: 'refunds.create',
            args: [params, options],
          });
          // Idempotency: a redelivered dead-request event reuses the same key,
          // so Stripe collapses it to one refund. Mirror that here — dedupe the
          // recorded refunds by idempotency key (falling back to payment_intent).
          const key = options?.idempotencyKey ?? params.payment_intent;
          const already = key
            ? this.refunds.some((r) => r.idempotencyKey === key)
            : false;
          const id = `re_test_${this.nextId++}`;
          if (typeof params.payment_intent === 'string' && !already) {
            this.refunds.push({
              payment_intent: params.payment_intent,
              idempotencyKey: options?.idempotencyKey,
            });
          }
          return { id };
        },
      },
      charges: {
        retrieve: async (id: string): Promise<FakeStripeCharge> => {
          this.calls.push({ method: 'charges.retrieve', args: [id] });
          const charge = this.charges.get(id);
          if (!charge) throw new Error(`No such charge: ${id}`);
          return charge;
        },
      },
    };
  }

  // Test helpers — populate state without exercising the SDK surface.
  seedCharge(c: FakeStripeCharge): void {
    this.charges.set(c.id, c);
  }
  seedCheckoutSession(
    s: Pick<FakeCheckoutSession, 'id'> & Partial<FakeCheckoutSession>,
  ): FakeCheckoutSession {
    const session: FakeCheckoutSession = {
      id: s.id,
      url: s.url ?? `https://checkout.stripe.test/${s.id}`,
      mode: s.mode ?? 'payment',
      customer: s.customer ?? '',
      client_reference_id: s.client_reference_id ?? null,
      metadata: s.metadata ?? {},
      payment_intent: s.payment_intent ?? `pi_${s.id}`,
      subscription: s.subscription ?? null,
      expires_at: s.expires_at ?? null,
      status: s.status ?? 'open',
    };
    this.checkoutSessions.set(session.id, session);
    return session;
  }
  seedSubscription(s: FakeStripeSubscription): void {
    this.subscriptions.set(s.id, s);
  }
  seedPrice(p: FakeStripePrice): void {
    this.prices.set(p.id, p);
  }
  seedProduct(p: FakeStripeProduct): void {
    this.products.set(p.id, p);
  }
  reset(): void {
    this.calls.length = 0;
    this.customers.clear();
    this.products.clear();
    this.prices.clear();
    this.subscriptions.clear();
    this.checkoutSessions.clear();
    this.idempotentSessions.clear();
    this.invoices.clear();
    this.charges.clear();
    this.refunds.length = 0;
    this.nextId = 1;
  }
  callsFor(method: string): FakeStripeCall[] {
    return this.calls.filter((c) => c.method === method);
  }
}

// FakeStripeWebhookVerifier returns whatever Stripe.Event the test has queued
// up via `queueEvent(...)`. Tests can opt into the bad-signature path via
// `throwOnNextVerify()`.
export class FakeStripeWebhookVerifier {
  private queue: Stripe.Event[] = [];
  private throwOnNext = false;

  construct(
    _rawBody: Buffer | string,
    signature: string | undefined,
  ): Stripe.Event {
    // Mirror the real StripeWebhookVerifier failure modes: bad signature →
    // BadRequestException (the controller layer surfaces 400); missing
    // signature → same. The fake intentionally bubbles a non-Nest exception
    // when its queue is empty, since that's a *test wiring* bug, not a
    // production-shaped failure mode worth simulating.
    if (this.throwOnNext) {
      this.throwOnNext = false;
      throw new BadRequestException('Invalid webhook signature');
    }
    if (!signature) {
      throw new BadRequestException('Missing Stripe-Signature header');
    }
    const evt = this.queue.shift();
    if (!evt) throw new Error('FakeStripeWebhookVerifier: no event queued');
    return evt;
  }

  queueEvent(evt: Stripe.Event): void {
    this.queue.push(evt);
  }
  throwOnNextVerify(): void {
    this.throwOnNext = true;
  }
  reset(): void {
    this.queue.length = 0;
    this.throwOnNext = false;
  }
}
