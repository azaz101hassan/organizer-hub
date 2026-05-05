// Response shapes mirrored from apps/api views. Kept narrow on purpose — only
// the fields the web app actually reads. Update when the api adds new fields.

export type OrganizationRole = "OWNER" | "ADMIN" | "MEMBER";

export type EventStatus = "DRAFT" | "PUBLISHED" | "CANCELLED";

export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  role: OrganizationRole;
  createdAt: string;
}

export interface EventView {
  id: string;
  organizationId: string;
  title: string;
  slug: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  venue: string | null;
  status: EventStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicEventView {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  venue: string | null;
  publishedAt: string | null;
  organization: { name: string; slug: string };
}

export interface PublicEventsPage {
  items: PublicEventView[];
  nextCursor: string | null;
}

export type MembershipTier = "BRONZE" | "SILVER" | "GOLD";

export type SubscriptionStatus =
  | "ACTIVE"
  | "TRIALING"
  | "PAST_DUE"
  | "CANCELED"
  | "UNPAID"
  | "INCOMPLETE"
  | "INCOMPLETE_EXPIRED"
  | "PAUSED";

export interface MembershipPlanView {
  lookupKey: string;
  tier: MembershipTier;
  tierLevel: number;
  displayName: string;
  cadence: string;
}

export interface MembershipView {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  tier: MembershipTier;
  tierLevel: number;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  updatedAt: string;
}
