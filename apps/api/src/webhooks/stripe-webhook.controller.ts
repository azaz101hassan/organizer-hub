import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { StripeWebhookVerifier } from '../billing/stripe-webhook.verifier';
import { recordProcessedWebhookEvent } from '../billing/webhook-event.helper';
import { StripeWebhookService } from './stripe-webhook.service';

// Unauthenticated endpoint — Stripe authenticates via the Stripe-Signature
// header instead of a bearer token. The endpoint is intentionally tiny:
// verify → dispatch → dedupe → ack. ThrottlerGuard caps the
// unauthenticated-signature-flood cost; Stripe's own retry budget ensures
// legitimate redeliveries still get through within the 60-per-minute window.
@Controller('webhooks/stripe')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly verifier: StripeWebhookVerifier,
    private readonly stripeWebhookService: StripeWebhookService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    const rawBody = req.rawBody;
    if (!rawBody) {
      // Should never happen — main.ts and the test bootstrap both pass
      // rawBody: true. If it does, the signature can't be verified so the
      // safe default is 400.
      throw new BadRequestException('Missing raw request body');
    }

    // verifier.construct returns the verified Stripe.Event or throws
    // BadRequestException. Bad signatures land as 400; the handler chain
    // below never runs.
    const event = this.verifier.construct(rawBody, signature);

    // Process-first-then-INSERT: run the side effect, then record the dedupe
    // row. Stripe redelivery re-runs the idempotent side effect, then this
    // INSERT hits P2002 and the duplicate ack returns 200. The waitlist payment
    // branches (issue / dead-request refund) record the dedupe row themselves —
    // inside the issuance tx, or after the refund — and signal `recorded` so we
    // don't write it twice.
    let result;
    try {
      result = await this.stripeWebhookService.handle(event);
    } catch (err) {
      // Bubble up so Stripe retries — but log the underlying cause first.
      this.logger.error(
        `Webhook ${event.type} ${event.id} handler failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }

    if (!result.recorded) {
      const dedupe = await recordProcessedWebhookEvent(
        this.prisma,
        event.id,
        event.type,
      );
      if (dedupe === 'duplicate') {
        this.logger.log(
          `Acked duplicate webhook ${event.id} (${event.type}) without side effects`,
        );
      }
    }

    return { received: true };
  }
}
