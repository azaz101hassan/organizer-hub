import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { EventsModule } from './events/events.module';
import { MembershipsModule } from './memberships/memberships.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PrismaModule } from './prisma/prisma.module';
import { PublicModule } from './public/public.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // The ThrottlerGuard is NOT registered globally; the webhook controller
    // opts in via @UseGuards(ThrottlerGuard). Other routes are unaffected,
    // which keeps Phase 2 auth/events e2e specs green and lets us scope rate
    // limits to public, unauth surfaces only.
    ThrottlerModule.forRoot([{ name: 'default', limit: 60, ttl: 60_000 }]),
    PrismaModule,
    AuthModule,
    BillingModule,
    MembershipsModule,
    OrganizationsModule,
    EventsModule,
    PublicModule,
    WebhooksModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
