import { IsIn } from 'class-validator';

// Validate the six known SKUs at the DTO layer rather than firing a Stripe
// API call for arbitrary input. The set mirrors the lookup_keys created in
// the Stripe Dashboard and seeded into the MembershipPlan table; adding a
// new SKU means adding it here too.
export const MEMBERSHIP_LOOKUP_KEYS = [
  'membership_bronze_monthly',
  'membership_bronze_yearly',
  'membership_silver_monthly',
  'membership_silver_yearly',
  'membership_gold_monthly',
  'membership_gold_yearly',
] as const;

export type MembershipLookupKey = (typeof MEMBERSHIP_LOOKUP_KEYS)[number];

export class CreateMembershipCheckoutDto {
  @IsIn(MEMBERSHIP_LOOKUP_KEYS)
  lookupKey!: MembershipLookupKey;
}
