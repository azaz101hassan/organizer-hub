import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../auth/jwt-auth.guard';
import { QueryPaymentEventsDto } from './dto/query-payment-events.dto';
import { PaymentEventsReadService } from './payment-events.read.service';

// Single-tenant: admin reads pass `?organizationId=…` (the house org id from
// admin app env); member reads omit it and the controller routes to the
// caller-scoped path. Permissions are enforced inside the service.
@Controller('payment-events')
@UseGuards(JwtAuthGuard)
export class PaymentEventsController {
  constructor(private readonly reads: PaymentEventsReadService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryPaymentEventsDto,
  ) {
    if (query.organizationId) {
      return this.reads.listForAdmin(user.sub, query);
    }
    return this.reads.listForUser(user.sub, query);
  }

  @Get(':id')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.reads.getDetail(user.sub, id);
  }
}

// Admin CSV stream — at /transactions.csv (not /payment-events.csv) per spec.
// Auth and role enforced inside adminStream. Streams rows as they're
// fetched in batches of 500.
@Controller()
@UseGuards(JwtAuthGuard)
export class TransactionsCsvController {
  constructor(private readonly reads: PaymentEventsReadService) {}

  @Get('transactions.csv')
  async csv(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryPaymentEventsDto,
    @Res() res: Response,
  ): Promise<void> {
    if (!query.organizationId) {
      throw new BadRequestException('organizationId required');
    }
    res.setHeader('content-type', 'text/csv');
    res.setHeader(
      'content-disposition',
      `attachment; filename="transactions-${query.organizationId}.csv"`,
    );
    const cols = [
      'id',
      'createdAt',
      'kind',
      'status',
      'amountCents',
      'currency',
      'userId',
      'stripePaymentIntentId',
      'stripeRefundId',
      'stripeChargeId',
      'description',
    ] as const;
    res.write(cols.join(',') + '\n');
    try {
      for await (const row of this.reads.adminStream(
        user.sub,
        query.organizationId,
        query,
      )) {
        const line = cols
          .map((c) => csvEscape((row as unknown as Record<string, unknown>)[c]))
          .join(',');
        res.write(line + '\n');
      }
    } finally {
      res.end();
    }
  }
}

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
