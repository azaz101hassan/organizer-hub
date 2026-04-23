import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { PublicEventsService } from './public-events.service';

@Controller('public/events')
export class PublicEventsController {
  constructor(private readonly events: PublicEventsService) {}

  @Get()
  list(
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.events.listUpcoming({ cursor, limit });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.events.getById(id);
  }
}
