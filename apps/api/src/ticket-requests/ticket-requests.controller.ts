import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../auth/jwt-auth.guard';
import { TicketRequestsService } from './ticket-requests.service';

// Requester-facing waitlist surface (U8). Authenticated but org-agnostic — a
// caller sees and cancels only their own requests (scoped by sub in the
// service WHERE clause). Distinct from the org-scoped admin queue at
// /orgs/:orgId/requests.
@Controller('requests')
@UseGuards(JwtAuthGuard)
export class TicketRequestsController {
  constructor(private readonly requests: TicketRequestsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.requests.listForUser(user.sub);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.requests.getForUser(user.sub, id);
  }

  // The live Checkout link + expiry for an APPROVED-awaiting-payment PAID
  // request (U11 "Complete payment" CTA). The web has no Stripe secret, so it
  // fetches the URL server-side here only when rendering that one state.
  @Get(':id/payment-link')
  paymentLink(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.requests.getPaymentLink(user.sub, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.requests.cancel(user.sub, id);
  }
}
