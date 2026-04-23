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

export async function bootTestApp(guard: Type<CanActivate>): Promise<{
  app: INestApplication<App>;
  prisma: PrismaService;
}> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(guard)
    .compile();

  const app: INestApplication<App> = moduleFixture.createNestApplication();
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
