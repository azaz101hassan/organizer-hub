import { BadRequestException } from '@nestjs/common';

export interface TupleCursor {
  at: Date;
  id: string;
}

// `|` is safe as a separator because cuids (the id format used throughout the
// api schema) are alphanumeric and never contain it. Revisit if a different id
// format is introduced.
export function encodeTupleCursor(c: TupleCursor): string {
  return Buffer.from(`${c.at.toISOString()}|${c.id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeTupleCursor(raw: string): TupleCursor {
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
  const at = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (Number.isNaN(at.getTime()) || !id) {
    throw new BadRequestException('invalid cursor');
  }
  return { at, id };
}
