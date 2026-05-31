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
    @Query('labelId') labelId?: string,
  ) {
    return this.events.listUpcoming({ cursor, limit, labelId });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.events.getById(id);
  }
}
