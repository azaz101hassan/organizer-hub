import { ConflictException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@organizer-hub/db/api';

const SLUG_MAX_ATTEMPTS = 5;

export function slugify(input: string, fallback = 'item'): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || fallback;
}

export async function createWithUniqueSlug<T>(
  base: string,
  create: (slug: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < SLUG_MAX_ATTEMPTS; attempt++) {
    const slug =
      attempt === 0
        ? base
        : `${base}-${randomBytes(2).toString('hex')}`;
    try {
      return await create(slug);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        continue;
      }
      throw err;
    }
  }
  throw new ConflictException('could not allocate a unique slug');
}
