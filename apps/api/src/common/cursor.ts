import { BadRequestException } from '@nestjs/common';

export interface EventCursor {
  startsAt: Date;
  id: string;
}

export function encodeEventCursor(c: EventCursor): string {
  return Buffer.from(`${c.startsAt.toISOString()}|${c.id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeEventCursor(raw: string): EventCursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new BadRequestException('invalid cursor');
  }
  const sep = decoded.indexOf('|');
  if (sep <= 0 || sep === decoded.length - 1) {
    throw new BadRequestException('invalid cursor');
  }
  const startsAt = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (Number.isNaN(startsAt.getTime()) || !id) {
    throw new BadRequestException('invalid cursor');
  }
  return { startsAt, id };
}
