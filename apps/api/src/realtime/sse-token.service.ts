import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

interface TokenEntry {
  userId: string;
  orgId: string;
  expiresAt: number;
}

// Short TTL: a healthy client mints, then connects immediately, so 60s is
// generous. The TTL bounds natural growth; the size cap covers a mint burst.
const TTL_MS = 60_000;
const MAX_TOKENS = 1000;

// Mints + verifies the single-use, opaque query tokens that authenticate the
// SSE stream (EventSource can't send an Authorization header). The token is
// 256 bits of randomness held ONLY in this in-memory store — it is NOT a JWT
// and carries no signature, so it can never be replayed against JwtAuthGuard
// (which only accepts a signed JWS for API_AUDIENCE). That structural
// separation is the deepening sec-H1 guarantee. Single-instance posture: a
// token minted on instance A can't be burned on instance B (U13 ops note).
@Injectable()
export class SseTokenService {
  // Insertion-ordered (Map) so eviction is FIFO — oldest outstanding first.
  private readonly tokens = new Map<string, TokenEntry>();

  mint(userId: string, orgId: string): string {
    this.evictExpired();
    while (this.tokens.size >= MAX_TOKENS) {
      const oldest = this.oldestKey();
      if (oldest === undefined) break;
      this.tokens.delete(oldest);
    }
    const token = randomBytes(32).toString('hex');
    this.tokens.set(token, { userId, orgId, expiresAt: Date.now() + TTL_MS });
    return token;
  }

  // Single-use: the token is deleted on the first lookup whether or not it is
  // still valid, so a replay (or a burned token presented again) always fails.
  verifyAndBurn(token: string): { userId: string; orgId: string } | null {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    this.tokens.delete(token);
    if (entry.expiresAt < Date.now()) return null;
    return { userId: entry.userId, orgId: entry.orgId };
  }

  // For leak assertions in tests.
  outstandingCount(): number {
    return this.tokens.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [token, entry] of this.tokens) {
      if (entry.expiresAt < now) this.tokens.delete(token);
    }
  }

  // The oldest outstanding key (insertion order) for FIFO eviction. for-of
  // yields a typed `string`, avoiding the `any` from iterator.next().value.
  private oldestKey(): string | undefined {
    for (const key of this.tokens.keys()) return key;
    return undefined;
  }
}
