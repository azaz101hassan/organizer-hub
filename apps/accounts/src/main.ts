// Locate files relative to this module without caring about ts-node vs compiled
// layouts. Walk up from __dirname until the candidate exists.
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

// Load .env before any Nest/Prisma code runs.
const envFile = findUp('.env');
if (envFile) loadDotenv({ path: envFile });

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { OidcService } from './oidc/oidc.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const viewsDir = findUp('views');
  if (!viewsDir) throw new Error('views directory not found relative to ' + __dirname);
  app.setBaseViewsDir(viewsDir);
  app.setViewEngine('ejs');

  const cookieSecret = process.env.OIDC_COOKIE_KEYS?.split(',')[0] ?? 'dev-secret';
  app.use(cookieParser(cookieSecret));

  const oidc = app.get(OidcService);
  await oidc.initProvider();
  app.use('/oidc', oidc.provider.callback());

  const port = Number(process.env.ACCOUNTS_PORT) || 3002;
  await app.listen(port);
  console.log(`[accounts] listening on http://localhost:${port}`);
  console.log(`[accounts] OIDC discovery: http://localhost:${port}/oidc/.well-known/openid-configuration`);
}

void bootstrap();
