import { Test } from '@nestjs/testing';
import { PaymentEventKind, PaymentEventStatus } from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentEventsService } from './payment-events.service';

// These tests exercise PaymentEventsService against the real api_db.
// Unlike most service specs in this codebase (which mock Prisma), this
// suite verifies database-level guarantees that a mock cannot model:
// the (PI, kind) partial unique index, the stripeRefundId unique, and
// the silent-replay semantics around P2002. Mocking Prisma would reduce
// these to tautologies.
describe('PaymentEventsService', () => {
  let service: PaymentEventsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [PaymentEventsService, PrismaService],
    }).compile();
    service = mod.get(PaymentEventsService);
    prisma = mod.get(PrismaService);
    await prisma.paymentEvent.deleteMany();
  });
  afterAll(async () => prisma.$disconnect());

  it('upsertPendingCharge inserts a PENDING TICKET row', async () => {
    await service.upsertPendingCharge(prisma, {
      userId: 'user_1',
      kind: PaymentEventKind.TICKET,
      amountCents: 2500,
      currency: 'usd',
      stripePaymentIntentId: 'pi_1',
      stripeCheckoutSessionId: 'cs_1',
    });
    const row = await prisma.paymentEvent.findFirst({ where: { stripePaymentIntentId: 'pi_1' } });
    expect(row?.status).toBe(PaymentEventStatus.PENDING);
    expect(row?.amountCents).toBe(2500);
  });

  it('upsertPendingCharge is idempotent on the (PI, kind) partial unique', async () => {
    const input = { userId: 'user_1', kind: PaymentEventKind.TICKET, amountCents: 2500, currency: 'usd', stripePaymentIntentId: 'pi_dup', stripeCheckoutSessionId: 'cs_dup' };
    await service.upsertPendingCharge(prisma, input);
    await service.upsertPendingCharge(prisma, input);
    const count = await prisma.paymentEvent.count({ where: { stripePaymentIntentId: 'pi_dup' } });
    expect(count).toBe(1);
  });

  it('finalizeCharge transitions PENDING -> SUCCEEDED', async () => {
    await service.upsertPendingCharge(prisma, { userId: 'u', kind: PaymentEventKind.TICKET, amountCents: 100, currency: 'usd', stripePaymentIntentId: 'pi_2', stripeCheckoutSessionId: 'cs_2' });
    await service.finalizeCharge(prisma, 'pi_2', { status: PaymentEventStatus.SUCCEEDED, succeededAt: new Date() });
    const row = await prisma.paymentEvent.findFirst({ where: { stripePaymentIntentId: 'pi_2' } });
    expect(row?.status).toBe(PaymentEventStatus.SUCCEEDED);
    expect(row?.succeededAt).toBeTruthy();
  });

  it('insertRefund stores a negative-amount REFUND row keyed on stripeRefundId', async () => {
    await service.insertRefund(prisma, { userId: 'u', amountCents: 100, currency: 'usd', stripePaymentIntentId: 'pi_3', stripeRefundId: 're_1' });
    const row = await prisma.paymentEvent.findUnique({ where: { stripeRefundId: 're_1' } });
    expect(row?.amountCents).toBe(-100);
    expect(row?.kind).toBe(PaymentEventKind.REFUND);
  });

  it('insertRefund is idempotent on stripeRefundId', async () => {
    const input = { userId: 'u', amountCents: 100, currency: 'usd', stripePaymentIntentId: 'pi_4', stripeRefundId: 're_dup' };
    await service.insertRefund(prisma, input);
    await service.insertRefund(prisma, input);
    const count = await prisma.paymentEvent.count({ where: { stripeRefundId: 're_dup' } });
    expect(count).toBe(1);
  });

  it('two partial refunds on the same PI both succeed', async () => {
    await service.insertRefund(prisma, { userId: 'u', amountCents: 60, currency: 'usd', stripePaymentIntentId: 'pi_p', stripeRefundId: 're_a' });
    await service.insertRefund(prisma, { userId: 'u', amountCents: 40, currency: 'usd', stripePaymentIntentId: 'pi_p', stripeRefundId: 're_b' });
    const rows = await prisma.paymentEvent.findMany({ where: { stripePaymentIntentId: 'pi_p', kind: PaymentEventKind.REFUND } });
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(-100);
  });
});
