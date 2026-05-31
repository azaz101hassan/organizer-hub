import { Module } from '@nestjs/common';
import { EventLabelsController } from './event-labels.controller';
import { EventLabelsService } from './event-labels.service';

@Module({
  controllers: [EventLabelsController],
  providers: [EventLabelsService],
  exports: [EventLabelsService],
})
export class EventLabelsModule {}
