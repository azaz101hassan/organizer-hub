import { Module } from '@nestjs/common';
import { PublicEventsController } from './public-events.controller';
import { PublicEventsService } from './public-events.service';

@Module({
  controllers: [PublicEventsController],
  providers: [PublicEventsService],
})
export class PublicModule {}
