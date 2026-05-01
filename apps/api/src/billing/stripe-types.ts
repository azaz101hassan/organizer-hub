// Stripe v22's CJS d.ts uses `export = StripeConstructor` whose namespace
// only re-aliases the merged class as a TYPE — so the natural namespace path
// `Stripe.Event` cannot resolve in CJS-mode TypeScript (`module: nodenext`,
// no `"type": "module"`). The README's "use Stripe.X" pattern targets the
// ESM resolution path which we don't pick up here.
//
// We work around this by inferring resource types from the *runtime* shape of
// the Stripe instance (the `webhooks.constructEvent` return type, the
// `customers.create` first argument, etc.). Inference works because the CJS
// d.ts does correctly type the class instance's methods.

import type StripeFactory from 'stripe';

// The instance type — same merged class as in stripe.core.d.ts. Use this as
// the type of the field exposed on StripeClient.
export type Stripe = InstanceType<typeof StripeFactory>;

// Helper: infer the type of a method on the Stripe instance via the typeof
// operator. Cleaner than `Awaited<ReturnType<…>>` chains at call sites.
type StripeMethod<
  Path extends readonly string[],
  T = Stripe,
> = Path extends readonly [infer Head, ...infer Rest]
  ? Head extends keyof T
    ? Rest extends readonly string[]
      ? StripeMethod<Rest, T[Head]>
      : never
    : never
  : T;

// Public namespace alias: each member is inferred from the SDK shape. Add new
// ones as units start to need them.
//
// `Stripe.Event` is the verified-webhook payload (constructEvent's return
// type). `Stripe.Customer` / `Stripe.Subscription` etc. mirror what the SDK
// methods return.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Stripe {
  export type Event = Awaited<
    ReturnType<StripeMethod<['webhooks', 'constructEvent']>>
  >;
  export type Customer = Awaited<
    ReturnType<StripeMethod<['customers', 'create']>>
  >;
  export type CustomerCreateParams = Parameters<
    StripeMethod<['customers', 'create']>
  >[0];
  export type Subscription = Awaited<
    ReturnType<StripeMethod<['subscriptions', 'update']>>
  >;
  export type SubscriptionListParams = Parameters<
    StripeMethod<['subscriptions', 'list']>
  >[0];
  export type SubscriptionUpdateParams = Parameters<
    StripeMethod<['subscriptions', 'update']>
  >[1];
  export type Product = Awaited<
    ReturnType<StripeMethod<['products', 'create']>>
  >;
  export type ProductCreateParams = Parameters<
    StripeMethod<['products', 'create']>
  >[0];
  export type ProductUpdateParams = Parameters<
    StripeMethod<['products', 'update']>
  >[1];
  export type Price = Awaited<ReturnType<StripeMethod<['prices', 'create']>>>;
  export type PriceCreateParams = Parameters<
    StripeMethod<['prices', 'create']>
  >[0];
  export type PriceUpdateParams = Parameters<
    StripeMethod<['prices', 'update']>
  >[1];
  export type PriceListParams = Parameters<StripeMethod<['prices', 'list']>>[0];
  export type RefundCreateParams = Parameters<
    StripeMethod<['refunds', 'create']>
  >[0];
  export type Invoice = Awaited<
    ReturnType<StripeMethod<['invoices', 'retrieve']>>
  >;

  // eslint-disable-next-line @typescript-eslint/no-namespace
  export namespace Checkout {
    type Session_ = Awaited<
      ReturnType<StripeMethod<['checkout', 'sessions', 'create']>>
    >;
    export type Session = Session_;
    export type SessionCreateParams = Parameters<
      StripeMethod<['checkout', 'sessions', 'create']>
    >[0];
  }
  // eslint-disable-next-line @typescript-eslint/no-namespace
  export namespace BillingPortal {
    export type SessionCreateParams = Parameters<
      StripeMethod<['billingPortal', 'sessions', 'create']>
    >[0];
  }
}
