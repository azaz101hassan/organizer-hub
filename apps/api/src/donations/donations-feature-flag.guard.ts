import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class DonationsFeatureFlagGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const org = req.organization as { donationsEnabled?: boolean } | undefined;
    if (!org || !org.donationsEnabled) {
      throw new NotFoundException();
    }
    return true;
  }
}
