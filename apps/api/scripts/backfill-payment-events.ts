import { config } from 'dotenv';
import path from 'node:path';
config({ path: path.resolve(__dirname, '../../../.env') });
config({ path: path.resolve(__dirname, '../.env.local'), override: false });

import {
  PrismaClient,
  PaymentEventKind,
  PaymentEventStatus,
  TicketSource,
  TicketRequestStatus,
} from '@organizer-hub/db/api';

const HOUSE_ORG_ID = 'org_house_000000000000000001';
const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  let inserted = 0;
  let skipped = 0;

  try {
    // 1. Paid Tickets -> TICKET rows
    const tickets = await prisma.ticket.findMany({
      where: {
        source: TicketSource.PAID,
        stripePaymentIntentId: { not: null },
      },
      select: {
        id: true,
        userId: true,
        stripeCheckoutSessionId: true,
        stripePaymentIntentId: true,
        issuedAt: true,
        ticketType: { select: { priceCents: true } },
      },
    });
    for (const t of tickets) {
      if (!t.stripePaymentIntentId) {
        skipped++;
        continue;
      }
      const exists = await prisma.paymentEvent.findFirst({
        where: {
          stripePaymentIntentId: t.stripePaymentIntentId,
          kind: {
            in: [
              PaymentEventKind.TICKET,
              PaymentEventKind.MEMBERSHIP,
              PaymentEventKind.DONATION,
            ],
          },
        },
      });
      if (exists) {
        skipped++;
        continue;
      }
      if (dryRun) {
        inserted++;
        continue;
      }
      await prisma.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID,
          userId: t.userId,
          kind: PaymentEventKind.TICKET,
          status: PaymentEventStatus.SUCCEEDED,
          amountCents: t.ticketType.priceCents,
          currency: 'usd',
          stripePaymentIntentId: t.stripePaymentIntentId,
          stripeCheckoutSessionId: t.stripeCheckoutSessionId,
          ticketId: t.id,
          succeededAt: t.issuedAt,
        },
      });
      inserted++;
    }

    // 2. TicketRequests with Stripe session but no Ticket -> PENDING / CANCELED rows
    const reqs = await prisma.ticketRequest.findMany({
      where: { stripeCheckoutSessionId: { not: null }, ticket: null },
      select: {
        id: true,
        userId: true,
        status: true,
        stripeCheckoutSessionId: true,
        ticketType: { select: { priceCents: true } },
      },
    });
    for (const r of reqs) {
      if (!r.stripeCheckoutSessionId) {
        skipped++;
        continue;
      }
      const exists = await prisma.paymentEvent.findFirst({
        where: {
          stripeCheckoutSessionId: r.stripeCheckoutSessionId,
          kind: PaymentEventKind.TICKET,
        },
      });
      if (exists) {
        skipped++;
        continue;
      }
      const status: PaymentEventStatus =
        r.status === TicketRequestStatus.APPROVED
          ? PaymentEventStatus.PENDING
          : r.status === TicketRequestStatus.CANCELLED_BY_USER
            ? PaymentEventStatus.CANCELED
            : r.status === TicketRequestStatus.EXPIRED
              ? PaymentEventStatus.CANCELED
              : PaymentEventStatus.PENDING;
      if (dryRun) {
        inserted++;
        continue;
      }
      await prisma.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID,
          userId: r.userId,
          kind: PaymentEventKind.TICKET,
          status,
          amountCents: r.ticketType.priceCents,
          currency: 'usd',
          stripeCheckoutSessionId: r.stripeCheckoutSessionId,
          ticketRequestId: r.id,
        },
      });
      inserted++;
    }

    // 3. Memberships -> one MEMBERSHIP row per subscription (most recent state).
    //    Historical renewals are NOT reconstructed in v1. The proxy PI key lets
    //    the row exist in the ledger without a real PI; live writes will use
    //    the actual renewal PI going forward.
    const memberships = await prisma.membership.findMany({
      select: {
        id: true,
        userId: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        tier: true,
        updatedAt: true,
      },
    });
    for (const m of memberships) {
      const proxy = `backfill_sub_${m.stripeSubscriptionId}`;
      const exists = await prisma.paymentEvent.findFirst({
        where: {
          stripePaymentIntentId: proxy,
          kind: PaymentEventKind.MEMBERSHIP,
        },
      });
      if (exists) {
        skipped++;
        continue;
      }
      if (dryRun) {
        inserted++;
        continue;
      }
      await prisma.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID,
          userId: m.userId,
          kind: PaymentEventKind.MEMBERSHIP,
          status: PaymentEventStatus.SUCCEEDED,
          amountCents: 0,
          currency: 'usd',
          description: `Membership (${m.tier}) — historical`,
          stripeCustomerId: m.stripeCustomerId,
          stripePaymentIntentId: proxy,
          membershipId: m.id,
          succeededAt: m.updatedAt,
        },
      });
      inserted++;
    }

    // 4. RefundLog -> REFUND rows. The original userId is not on RefundLog
    //    (refund-keyed not user-keyed), so use a sentinel; the read surface
    //    treats backfill_unknown rows as admin-only.
    const refunds = await prisma.refundLog.findMany();
    for (const r of refunds) {
      const exists = await prisma.paymentEvent.findFirst({
        where: {
          stripeCheckoutSessionId: r.stripeCheckoutSessionId,
          kind: PaymentEventKind.REFUND,
        },
      });
      if (exists) {
        skipped++;
        continue;
      }
      if (dryRun) {
        inserted++;
        continue;
      }
      await prisma.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID,
          userId: 'backfill_unknown',
          kind: PaymentEventKind.REFUND,
          status: PaymentEventStatus.SUCCEEDED,
          amountCents: -r.amountCents,
          currency: 'usd',
          description: `Refund (${r.reason}) — historical`,
          stripeCheckoutSessionId: r.stripeCheckoutSessionId,
          stripePaymentIntentId: r.stripePaymentIntentId,
          succeededAt: r.createdAt,
        },
      });
      inserted++;
    }

    console.log(
      `${dryRun ? '[dry-run] ' : ''}inserted=${inserted} skipped=${skipped}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
