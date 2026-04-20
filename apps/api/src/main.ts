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
if (envFile) loadDotenv({ path: envFile });

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });
  const port = Number(process.env.API_PORT) || 3001;
  await app.listen(port);
  console.log(`[api] listening on http://localhost:${port}`);
}

void bootstrap();
