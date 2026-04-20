import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from './auth/current-user.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from './auth/jwt-auth.guard';

@Controller()
export class AppController {
  @Get('health')
  health(): { ok: true } {
    return { ok: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
