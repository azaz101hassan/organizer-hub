import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  TicketRequestIntent,
  TicketRequestStatus,
} from '@organizer-hub/db/api';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../auth/jwt-auth.guard';
import { MembershipsService } from '../memberships/memberships.service';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistStream } from '../realtime/waitlist-stream';
import {
  createPendingRequest,
  findOpenRequestForUser,
} from '../ticket-requests/create-pending-request';
import { BillingService } from './billing.service';
import { CreateMembershipCheckoutDto } from './dto/create-membership-checkout.dto';
import { CreateTicketCheckoutDto } from './dto/create-ticket-checkout.dto';

// Discriminated result of POST /billing/checkout/ticket: a Stripe Checkout URL
// when under cap, or a waitlist request when at cap. Callers switch on `kind`
// (never structural url-presence) so a future third outcome can't overload it.
export type TicketCheckoutResult =
  | { kind: 'checkout'; url: string }
  | { kind: 'request'; requestId: string; status: TicketRequestStatus };

// Authenticated billing surface. The matching unauth side — Stripe webhooks
// — lives in apps/api/src/webhooks/ to make the auth/no-auth split obvious
// at the file-tree level.
@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly memberships: MembershipsService,
    // For the at-cap branch the controller (not BillingService) orchestrates
    // the waitlist intake, so BillingService never imports ticket-requests and
    // the module graph stays acyclic. Prisma + WaitlistStream are @Global; the
    // intake helpers are plain functions, so no module import is needed.
    private readonly prisma: PrismaService,
    private readonly stream: WaitlistStream,
  ) {}

  @Post('checkout/membership')
  @HttpCode(HttpStatus.OK)
  async createMembershipCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMembershipCheckoutDto,
  ): Promise<{ url: string }> {
    const session = await this.billing.createMembershipCheckoutSession(
      user.sub,
      dto.lookupKey,
      user.email,
    );
    return { url: session.url };
  }

  @Post('membership/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelMembership(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ status: 'scheduled' }> {
    await this.billing.cancelMembership(user.sub);
    // Sync immediately so the dashboard reflects cancel_at_period_end=true
    // without waiting for Stripe's webhook to arrive.
    const customer = await this.billing.getOrCreateStripeCustomer(user.sub);
    await this.memberships.syncStripeData(customer.stripeCustomerId);
    return { status: 'scheduled' };
  }

  // Gate ordering (R3, AE1): 404 / not-PUBLISHED -> existing-PAID 409 ->
  // existing-open request (return it, idempotent) -> atCap -> checkout | request.
  @Post('checkout/ticket')
  @HttpCode(HttpStatus.OK)
  async createTicketCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTicketCheckoutDto,
  ): Promise<TicketCheckoutResult> {
    const evaluation = await this.billing.evaluateTicketIntake(
      user.sub,
      dto.ticketTypeId,
    );

    // Already in the queue for this tier → return the existing request, even if
    // the tier has since dropped under cap (so the affordance stays "pending").
    const open = await findOpenRequestForUser(
      this.prisma,
      user.sub,
      dto.ticketTypeId,
    );
    if (open) {
      return { kind: 'request', requestId: open.id, status: open.status };
    }

    if (!evaluation.atCap) {
      const session = await this.billing.createTicketCheckoutSession(
        user.sub,
        dto.ticketTypeId,
        user.email,
      );
      return { kind: 'checkout', url: session.url };
    }

    const created = await createPendingRequest(
      { prisma: this.prisma, stream: this.stream },
      {
        userId: user.sub,
        userEmail: user.email,
        userName: user.name,
        ticketTypeId: dto.ticketTypeId,
        eventId: evaluation.ticketType.eventId,
        orgId: evaluation.ticketType.organizationId,
        intent: TicketRequestIntent.PAID,
      },
    );
    return { kind: 'request', requestId: created.id, status: created.status };
  }
}
