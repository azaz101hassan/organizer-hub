import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Type,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { JwtAuthGuard } from '../../src/auth/jwt-auth.guard';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface SubHolder {
  value: string;
}

export function makeSubHolder(initial = 'user-a'): SubHolder {
  return { value: initial };
}

export function stubJwtAuthGuard(holder: SubHolder): Type<CanActivate> {
  return class implements CanActivate {
    canActivate(ctx: ExecutionContext): boolean {
      const req = ctx.switchToHttp().getRequest<Request>();
      req.user = { sub: holder.value, claims: { sub: holder.value } };
      return true;
    }
  };
}

export class DenyAllGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    return false;
  }
}

// Provider override descriptor for tests that need to swap injectables —
// typically the Stripe seam (StripeClient + StripeWebhookVerifier). Pass an
// array to bootTestApp() and each entry becomes
// `.overrideProvider(token).useValue|useClass(...)` on the testing module.
export type ProviderOverride =
  | { token: Type<unknown> | string | symbol; useValue: unknown }
  | { token: Type<unknown> | string | symbol; useClass: Type<unknown> };

export async function bootTestApp(
  guard: Type<CanActivate>,
  providerOverrides: ProviderOverride[] = [],
): Promise<{
  app: INestApplication<App>;
  prisma: PrismaService;
}> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(JwtAuthGuard)
    .useClass(guard);

  for (const override of providerOverrides) {
    const ob = builder.overrideProvider(override.token);
    if ('useValue' in override) {
      builder = ob.useValue(override.useValue);
    } else {
      builder = ob.useClass(override.useClass);
    }
  }

  const moduleFixture = await builder.compile();

  // rawBody: true mirrors production main.ts so e2e webhook tests can exercise
  // the StripeWebhookVerifier path end-to-end (and so any future raw-body
  // consumer in the AppModule doesn't break under test only).
  const app: INestApplication<App> = moduleFixture.createNestApplication({
    rawBody: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}
