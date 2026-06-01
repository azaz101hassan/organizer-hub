import type { Prisma, PrismaClient } from '@organizer-hub/db/api';

export function coalitionFactory(
  overrides: Partial<Prisma.CoalitionUncheckedCreateInput> = {},
): Prisma.CoalitionUncheckedCreateInput {
  const id = overrides.id ?? `coal_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    organizationId: overrides.organizationId ?? 'org_test',
    name: overrides.name ?? 'Test coalition',
    slug: overrides.slug ?? `test-coalition-${id.slice(-4)}`,
    description: overrides.description ?? null,
    coverImageUrl: overrides.coverImageUrl ?? null,
    status: overrides.status ?? 'ACTIVE',
    displayOrder: overrides.displayOrder ?? 0,
    ...overrides,
  };
}

export function campaignFactory(
  overrides: Partial<Prisma.CampaignUncheckedCreateInput> = {},
): Prisma.CampaignUncheckedCreateInput {
  const id = overrides.id ?? `camp_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    organizationId: overrides.organizationId ?? 'org_test',
    coalitionId: overrides.coalitionId ?? 'coal_test',
    name: overrides.name ?? 'Test campaign',
    slug: overrides.slug ?? `test-campaign-${id.slice(-4)}`,
    description: overrides.description ?? null,
    coverImageUrl: overrides.coverImageUrl ?? null,
    targetAmountCents: overrides.targetAmountCents ?? 500_000,
    currency: overrides.currency ?? 'usd',
    deadline: overrides.deadline ?? null,
    status: overrides.status ?? 'ACTIVE',
    displayOrder: overrides.displayOrder ?? 0,
    ...overrides,
  };
}

export function donationFactory(
  overrides: Partial<Prisma.DonationUncheckedCreateInput> = {},
): Prisma.DonationUncheckedCreateInput {
  const id = overrides.id ?? `don_${Math.random().toString(36).slice(2, 10)}`;
  const mode = overrides.mode ?? 'ONE_TIME';
  return {
    id,
    organizationId: overrides.organizationId ?? 'org_test',
    userId: overrides.userId ?? 'user_test',
    campaignId: overrides.campaignId ?? 'camp_test',
    mode,
    cadence: overrides.cadence ?? (mode === 'ONE_TIME' ? 'ONCE' : 'MONTHLY'),
    amountCents: overrides.amountCents ?? 2_500,
    currency: overrides.currency ?? 'usd',
    status: overrides.status ?? 'PENDING',
    stripeCustomerId: overrides.stripeCustomerId ?? null,
    stripeCheckoutSessionId: overrides.stripeCheckoutSessionId ?? null,
    stripeSubscriptionId: overrides.stripeSubscriptionId ?? null,
    displayNameOptIn: overrides.displayNameOptIn ?? false,
    canceledAt: overrides.canceledAt ?? null,
    ...overrides,
  };
}

export async function seedActiveRecurringDonation(
  prisma: PrismaClient,
  opts: {
    userId: string;
    campaignId: string;
    organizationId: string;
    amountCents?: number;
    cadence?: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  },
): Promise<{ donationId: string; stripeSubscriptionId: string }> {
  const stripeSubscriptionId = `sub_test_${Math.random().toString(36).slice(2, 10)}`;
  const donation = await prisma.donation.create({
    data: donationFactory({
      userId: opts.userId,
      campaignId: opts.campaignId,
      organizationId: opts.organizationId,
      mode: 'RECURRING',
      cadence: opts.cadence ?? 'MONTHLY',
      amountCents: opts.amountCents ?? 2_500,
      status: 'ACTIVE',
      stripeSubscriptionId,
    }),
  });
  await prisma.paymentEvent.create({
    data: {
      organizationId: opts.organizationId,
      userId: opts.userId,
      kind: 'DONATION',
      status: 'SUCCEEDED',
      amountCents: donation.amountCents,
      currency: donation.currency,
      donationId: donation.id,
      stripePaymentIntentId: `pi_test_${donation.id}`,
      stripeInvoiceId: `inv_test_${donation.id}`,
      stripeChargeId: `ch_test_${donation.id}`,
      succeededAt: new Date(),
    },
  });
  return { donationId: donation.id, stripeSubscriptionId };
}
