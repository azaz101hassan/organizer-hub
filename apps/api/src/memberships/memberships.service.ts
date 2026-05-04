import { Injectable, Logger } from '@nestjs/common';
import {
  MembershipTier,
  Prisma,
  SubscriptionStatus,
} from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { StripeClient } from '../billing/stripe.client';
import type { Stripe } from '../billing/stripe-types';

// Subscription statuses that count as "the user has a live membership for
// coverage purposes." Mirrors the gating list documented in the plan: TRIALING
// and PAST_DUE both grant coverage (Stripe's recommendation — TRIALING is in
// the grace window before first payment, PAST_DUE is in the dunning window
// before final cancellation), PAUSED keeps the slot held but does not grant
// coverage in this app's policy.
const COVERAGE_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.PAST_DUE,
]);

// Stripe statuses we consider "candidates" when picking which subscription to
// mirror locally. PAUSED is included so we can mirror its existence (and not
// silently drop the row), but it won't pass COVERAGE_STATUSES at read time.
const MIRROR_CANDIDATE_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'trialing',
  'past_due',
  'paused',
]);

export interface MembershipView {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  tier: MembershipTier;
  tierLevel: number;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  updatedAt: Date;
}

// Map a Stripe Price `lookup_key` (the canonical id we configure in the
// Stripe Dashboard, e.g. `membership_gold_monthly`) to a local tier/level.
// Strict: an unknown lookup_key throws — `syncStripeData` would rather skip
// the upsert than persist a row with a misaligned tier.
function tierForLookupKey(lookupKey: string | null | undefined): {
  tier: MembershipTier;
  tierLevel: number;
} {
  switch (lookupKey) {
    case 'membership_bronze_monthly':
    case 'membership_bronze_yearly':
      return { tier: MembershipTier.BRONZE, tierLevel: 1 };
    case 'membership_silver_monthly':
    case 'membership_silver_yearly':
      return { tier: MembershipTier.SILVER, tierLevel: 2 };
    case 'membership_gold_monthly':
    case 'membership_gold_yearly':
      return { tier: MembershipTier.GOLD, tierLevel: 3 };
    default:
      throw new Error(
        `Unknown membership lookup_key: ${lookupKey ?? '<null>'}`,
      );
  }
}

// Map a Stripe subscription.status string to the local enum. Stripe sends
// these as lowercase strings; we mirror the full set so a `status: 'unpaid'`
// from Stripe lands as SubscriptionStatus.UNPAID locally, not as a fallback
// "best guess" — the local enum is intentionally exhaustive.
function statusFromStripe(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case 'active':
      return SubscriptionStatus.ACTIVE;
    case 'trialing':
      return SubscriptionStatus.TRIALING;
    case 'past_due':
      return SubscriptionStatus.PAST_DUE;
    case 'canceled':
      return SubscriptionStatus.CANCELED;
    case 'unpaid':
      return SubscriptionStatus.UNPAID;
    case 'incomplete':
      return SubscriptionStatus.INCOMPLETE;
    case 'incomplete_expired':
      return SubscriptionStatus.INCOMPLETE_EXPIRED;
    case 'paused':
      return SubscriptionStatus.PAUSED;
    default:
      throw new Error(`Unknown Stripe subscription status: ${stripeStatus}`);
  }
}

function toView(row: Prisma.MembershipGetPayload<object>): MembershipView {
  return {
    userId: row.userId,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    status: row.status,
    tier: row.tier,
    tierLevel: row.tierLevel,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class MembershipsService {
  private readonly logger = new Logger(MembershipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClient,
  ) {}

  // Sync the local Membership mirror for a given Stripe customer. Called from
  // /success after Checkout completes AND from every webhook handler — the
  // Theo Browne pattern means the same code path produces the same end state
  // regardless of which event woke us up.
  //
  // Resolves userId from BillingCustomer first; falls back to the Stripe
  // Customer's metadata.userId if the local row hasn't landed yet (e.g.,
  // first-checkout race in U2). Returns null on still-unbound customers
  // rather than throwing — webhooks must ack 200.
  async syncStripeData(
    stripeCustomerId: string,
  ): Promise<MembershipView | null> {
    const userId = await this.resolveUserIdForCustomer(stripeCustomerId);
    if (!userId) {
      this.logger.warn(
        `syncStripeData: no userId bound to Stripe customer ${stripeCustomerId}; skipping mirror upsert`,
      );
      return null;
    }

    const list = await this.stripeClient.stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 10,
    });

    const candidates = list.data.filter((s) =>
      MIRROR_CANDIDATE_STATUSES.has(s.status),
    );

    if (candidates.length === 0) {
      // No live subscription remains. If we had a local row, mark CANCELED
      // (we don't delete — keeps the audit trail intact and lets coverage
      // checks see "previously had GOLD" if a feature ever wants that).
      const existing = await this.prisma.membership.findUnique({
        where: { userId },
      });
      if (existing && existing.status !== SubscriptionStatus.CANCELED) {
        const updated = await this.prisma.membership.update({
          where: { userId },
          data: { status: SubscriptionStatus.CANCELED },
        });
        return toView(updated);
      }
      return null;
    }

    const sub = this.pickWinningSubscription(candidates, stripeCustomerId);
    const item = sub.items.data[0];
    if (!item) {
      throw new Error(
        `Stripe subscription ${sub.id} has no items; cannot derive tier`,
      );
    }
    const { tier, tierLevel } = tierForLookupKey(item.price.lookup_key);

    // current_period_end moved off the top-level Subscription onto each item
    // in Stripe API 2025-03-31.basil+. The client is pinned to a later
    // version, so we read it from the item.
    const itemForPeriod = item as typeof item & {
      current_period_end?: number;
    };
    const periodEndSeconds = itemForPeriod.current_period_end;
    if (typeof periodEndSeconds !== 'number') {
      throw new Error(
        `Stripe subscription item ${item.id} missing current_period_end`,
      );
    }
    const currentPeriodEnd = new Date(periodEndSeconds * 1000);

    const upserted = await this.prisma.membership.upsert({
      where: { userId },
      create: {
        userId,
        stripeCustomerId,
        stripeSubscriptionId: sub.id,
        status: statusFromStripe(sub.status),
        tier,
        tierLevel,
        currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      },
      update: {
        stripeCustomerId,
        stripeSubscriptionId: sub.id,
        status: statusFromStripe(sub.status),
        tier,
        tierLevel,
        currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      },
    });
    return toView(upserted);
  }

  // Look up the current live membership for a user, if any. Returns null when
  // there is no row, when the row is CANCELED, or when status is otherwise
  // outside the coverage set. Callers should treat null as "no membership."
  async getActiveMembershipForUser(
    userId: string,
  ): Promise<MembershipView | null> {
    const row = await this.prisma.membership.findUnique({ where: { userId } });
    if (!row) return null;
    if (!COVERAGE_STATUSES.has(row.status)) return null;
    return toView(row);
  }

  // Returns true iff the user has an active membership whose tierLevel
  // satisfies a TicketType's coverage requirement. Real implementation lands
  // in U7/U8 when TicketType.min_tier_level exists. U3 leaves it as a stub
  // that returns false so call sites can already wire the check.
  canClaimFree(
    _userId: string,
    _eventId: string,
    _ticketTypeId: string,
  ): Promise<boolean> {
    return Promise.resolve(false);
  }

  // --- internals ---

  private async resolveUserIdForCustomer(
    stripeCustomerId: string,
  ): Promise<string | null> {
    const bound = await this.prisma.billingCustomer.findUnique({
      where: { stripeCustomerId },
    });
    if (bound) return bound.userId;

    // Orphan recovery: a Stripe Customer can exist without a BillingCustomer
    // row if the U2 lazy-create raced and the local INSERT was rolled back
    // after Stripe-side creation. Pull the metadata.userId Stripe was given
    // at creation time.
    try {
      const customer = (await this.stripeClient.stripe.customers.retrieve(
        stripeCustomerId,
      )) as Stripe.Customer & { deleted?: true };
      if (customer.deleted) return null;
      const userId = customer.metadata?.userId;
      return typeof userId === 'string' && userId.length > 0 ? userId : null;
    } catch (err) {
      this.logger.warn(
        `resolveUserIdForCustomer: stripe.customers.retrieve failed for ${stripeCustomerId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private pickWinningSubscription(
    candidates: Array<{
      id: string;
      status: string;
      cancel_at_period_end: boolean;
      items: {
        data: Array<{
          id: string;
          price: { lookup_key: string | null };
        }>;
      };
    }>,
    stripeCustomerId: string,
  ): (typeof candidates)[number] {
    if (candidates.length === 1) return candidates[0];

    // Defensive multi-subscription guard. The Stripe Dashboard's "Limit
    // customers to one subscription" toggle is the documented invariant
    // (see docs/phase-3-stripe-setup.md), but a misconfiguration must not
    // produce nondeterministic coverage reads across page renders.
    this.logger.warn(
      `pickWinningSubscription: customer ${stripeCustomerId} has ${candidates.length} candidate subscriptions; picking highest tier_level`,
    );
    let best = candidates[0];
    let bestLevel = -1;
    for (const sub of candidates) {
      const lookupKey = sub.items.data[0]?.price.lookup_key;
      let level = -1;
      try {
        level = tierForLookupKey(lookupKey).tierLevel;
      } catch {
        continue;
      }
      if (level > bestLevel) {
        best = sub;
        bestLevel = level;
      }
    }
    return best;
  }
}
