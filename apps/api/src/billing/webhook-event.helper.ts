import { Logger } from '@nestjs/common';
import { Prisma } from '@organizer-hub/db/api';

const log = new Logger('WebhookEventHelper');

// Stripe duplicates webhook deliveries on retry; we dedupe by the `evt_…` id.
//
// Pattern: process-first-then-INSERT. The caller runs the durable business
// side effect first (e.g., syncStripeData upsert) and ends the same Prisma
// transaction by inserting the WebhookEvent row. On Stripe redelivery, the
// re-processed side effect is idempotent (upsert / unique-constraint catch),
// then this INSERT hits P2002 on `stripe_event_id` — we swallow it so the
// caller can ack 200 without re-running anything. The INSERT-first pattern
// would lose work if a handler crashed between commit of the dedupe row and
// completion of the side effect.
//
// The tx-scoped signature is deliberate: the helper must be called inside the
// caller's transaction so the dedupe row commits atomically with the work it
// guards.
export async function recordProcessedWebhookEvent(
  tx: Prisma.TransactionClient,
  stripeEventId: string,
  type: string,
): Promise<'recorded' | 'duplicate'> {
  try {
    await tx.webhookEvent.create({ data: { stripeEventId, type } });
    return 'recorded';
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      log.log(
        `Duplicate webhook ${stripeEventId} (${type}) — already processed`,
      );
      return 'duplicate';
    }
    throw err;
  }
}
