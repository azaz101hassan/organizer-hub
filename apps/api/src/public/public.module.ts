import { Module } from '@nestjs/common';
import { PublicEventLabelsController } from './public-event-labels.controller';
import { PublicEventsController } from './public-events.controller';
import { PublicEventsService } from './public-events.service';

@Module({
  controllers: [PublicEventsController, PublicEventLabelsController],
  providers: [PublicEventsService],
})
export class PublicModule {}
