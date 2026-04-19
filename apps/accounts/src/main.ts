import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.ACCOUNTS_PORT) || 3002;
  await app.listen(port);
  console.log(`[accounts] listening on http://localhost:${port}`);
}
bootstrap();
