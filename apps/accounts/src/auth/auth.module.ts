import { Module } from '@nestjs/common';
import { OidcModule } from '../oidc/oidc.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [OidcModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
