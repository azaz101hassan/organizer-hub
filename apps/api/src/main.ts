// Load monorepo root .env before any imports that read process.env at module
// init (Prisma, ConfigService). Walks up from __dirname so it works under both
// ts-node (apps/api/src) and compiled (apps/api/dist/src) layouts.
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { config as loadDotenv } from 'dotenv';

function findUp(name: string, start: string = __dirname): string | undefined {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    const candidate = nodePath.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = nodePath.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envFile = findUp('.env');
if (envFile) {
  loadDotenv({ path: envFile });
  const repoRoot = nodePath.dirname(envFile);
  const apiEnvLocal = nodePath.join(repoRoot, 'apps', 'api', '.env.local');
  if (fs.existsSync(apiEnvLocal))
    loadDotenv({ path: apiEnvLocal, override: true });
}

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // rawBody: true keeps both parsed JSON and raw bytes available on each
  // request. The Stripe webhook controller reads req.rawBody for signature
  // verification (HMAC must run over the exact bytes Stripe signed); every
  // other controller is unaffected and uses the parsed body as before.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  const defaultOrigins = ['http://localhost:3000', 'http://localhost:3003'];
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : defaultOrigins;
  app.enableCors({ origin: allowedOrigins, credentials: true });
  const port = Number(process.env.API_PORT) || 3001;
  await app.listen(port);
  console.log(`[api] listening on http://localhost:${port}`);
}

void bootstrap();
