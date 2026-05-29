import { atCap } from './capacity';

describe('atCap', () => {
  it('is never at cap when cap is null (Phase 3 behavior)', () => {
    expect(atCap({ cap: null }, 999)).toBe(false);
  });

  it('is not at cap below the cap', () => {
    expect(atCap({ cap: 10 }, 9)).toBe(false);
  });

  it('is at cap when issuedCount equals cap', () => {
    expect(atCap({ cap: 10 }, 10)).toBe(true);
  });

  it('is at cap when issuedCount exceeds cap (accepted soft over-issue)', () => {
    expect(atCap({ cap: 10 }, 11)).toBe(true);
  });
});
