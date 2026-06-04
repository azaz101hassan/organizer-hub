import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { DonationsService } from './donations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { ListMineDto } from './dto/list-mine.dto';

@Controller('donations')
@UseGuards(JwtAuthGuard)
export class DonationsReadController {
  constructor(private readonly donations: DonationsService) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListMineDto) {
    return this.donations.listForUser({
      userSub: user.sub,
      mode: query.mode,
      status: query.status,
    });
  }

  @Get('by-session/:id')
  bySession(@CurrentUser() user: AuthenticatedUser, @Param('id') sessionId: string) {
    if (sessionId.length === 0 || sessionId.length > 256) {
      throw new BadRequestException('invalid session id');
    }
    return this.donations.findBySession({ userSub: user.sub, sessionId });
  }
}
