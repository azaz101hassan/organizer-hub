import { SseTokenService } from './sse-token.service';

describe('SseTokenService', () => {
  it('mints an opaque 256-bit hex token that is not a JWT (sec-H1)', () => {
    const svc = new SseTokenService();
    const token = svc.mint('user-1', 'org-1');
    // 32 random bytes → 64 hex chars, no dots: structurally not a JWS compact
    // string, so JwtAuthGuard (which only verifies signed JWTs) can never
    // accept it as a bearer.
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token.includes('.')).toBe(false);
  });

  it('verifyAndBurn returns the claims once, then null (single-use)', () => {
    const svc = new SseTokenService();
    const token = svc.mint('user-1', 'org-1');
    expect(svc.verifyAndBurn(token)).toEqual({
      userId: 'user-1',
      orgId: 'org-1',
    });
    expect(svc.verifyAndBurn(token)).toBeNull();
  });

  it('returns null for an unknown / forged token', () => {
    const svc = new SseTokenService();
    expect(svc.verifyAndBurn('not-a-real-token')).toBeNull();
  });

  it('mints unique tokens', () => {
    const svc = new SseTokenService();
    const a = svc.mint('u', 'o');
    const b = svc.mint('u', 'o');
    expect(a).not.toBe(b);
    expect(svc.outstandingCount()).toBe(2);
  });

  it('caps the store and evicts the oldest token (FIFO) on overflow', () => {
    const svc = new SseTokenService();
    const first = svc.mint('u', 'o');
    // 1000 cap → minting 1001 total evicts the first.
    for (let i = 0; i < 1000; i++) svc.mint('u', 'o');
    expect(svc.outstandingCount()).toBe(1000);
    expect(svc.verifyAndBurn(first)).toBeNull();
  });
});
