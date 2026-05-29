import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../auth/jwt-auth.guard';
import { ClaimTicketDto } from './dto/claim-ticket.dto';
import { TicketsService, type ClaimResult } from './tickets.service';

// Free-claim surface — paid ticket purchases go through
// /billing/checkout/ticket in the billing module. Splitting the two HTTP
// surfaces keeps the auth/no-Stripe distinction visible at the URL level:
// claim never touches Stripe, checkout always does.
@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post('claim')
  @HttpCode(HttpStatus.CREATED)
  claim(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClaimTicketDto,
  ): Promise<ClaimResult> {
    return this.tickets.claimFree(user.sub, dto.ticketTypeId, {
      email: user.email,
      name: user.name,
    });
  }
}
