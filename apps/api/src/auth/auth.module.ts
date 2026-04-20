import { Global, Module } from '@nestjs/common';
import { JwksService } from './jwks.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  providers: [JwksService, JwtAuthGuard, RolesGuard],
  exports: [JwksService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
