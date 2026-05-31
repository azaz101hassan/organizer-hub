import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentEventsService } from './payment-events.service';
import { PaymentEventsReadService } from './payment-events.read.service';
import {
  PaymentEventsController,
  TransactionsCsvController,
} from './payment-events.controller';

@Module({
  imports: [PrismaModule],
  providers: [PaymentEventsService, PaymentEventsReadService],
  controllers: [PaymentEventsController, TransactionsCsvController],
  exports: [PaymentEventsService, PaymentEventsReadService],
})
export class PaymentEventsModule {}
