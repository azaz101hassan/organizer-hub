import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    appController = app.get<AppController>(AppController);
  });

  it('health() returns ok', () => {
    expect(appController.health()).toEqual({ ok: true });
  });
});
