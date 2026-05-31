import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentEventsService } from './payment-events.service';
import { PaymentEventsReadService } from './payment-events.read.service';

@Module({
  imports: [PrismaModule],
  providers: [PaymentEventsService, PaymentEventsReadService],
  exports: [PaymentEventsService, PaymentEventsReadService],
})
export class PaymentEventsModule {}
