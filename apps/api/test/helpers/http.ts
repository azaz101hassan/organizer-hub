import type { Response } from 'supertest';

export function jsonBody<T>(res: Response): T {
  return res.body as T;
}
