// A tiny now() seam so the scheduled sweep's `startsAt <= now` boundary is
// deterministic under test (mirrors the inject-the-SDK-behind-a-token discipline
// in nestjs-stripe-testing-seam.md). Production binds `systemClock`; e2e overrides
// the CLOCK token with a fake whose instant the test controls.
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export const systemClock: Clock = {
  now: () => new Date(),
};
