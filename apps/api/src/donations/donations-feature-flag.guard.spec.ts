import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

function ctxWithOrg(donationsEnabled: boolean | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        organization: donationsEnabled === undefined ? undefined : { id: 'org_1', donationsEnabled },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('DonationsFeatureFlagGuard', () => {
  const guard = new DonationsFeatureFlagGuard();

  it('passes when the organization has donations enabled', () => {
    expect(guard.canActivate(ctxWithOrg(true))).toBe(true);
  });

  it('throws 404 when the flag is off (do not leak existence)', () => {
    expect(() => guard.canActivate(ctxWithOrg(false))).toThrow(NotFoundException);
  });

  it('throws 404 when the request has no resolved organization', () => {
    expect(() => guard.canActivate(ctxWithOrg(undefined))).toThrow(NotFoundException);
  });
});
