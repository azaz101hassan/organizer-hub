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
  membersExcluded: boolean;
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

export type TicketSource = "PAID" | "MEMBERSHIP_CLAIM";

export interface TicketTypeView {
  id: string;
  eventId: string;
  name: string;
  priceCents: number;
  minTierLevel: number;
  cap: number | null;
  issuedCount: number;
  stripeProductId: string;
  stripePriceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TicketTypePublicView {
  id: string;
  name: string;
  priceCents: number;
  minTierLevel: number;
}

export interface TicketView {
  id: string;
  userId: string;
  eventId: string;
  ticketTypeId: string;
  source: TicketSource;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  issuedAt: string;
}

export type CoverageVerdict = "OWNED" | "CLAIMABLE" | "BUY";

export type TicketRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED_BY_USER"
  | "EXPIRED";

// Discriminated response of POST /billing/checkout/ticket: a Stripe Checkout
// URL under cap, or a queued waitlist request at cap. Switch on `kind`.
export type TicketCheckoutResult =
  | { kind: "checkout"; url: string }
  | { kind: "request"; requestId: string; status: TicketRequestStatus };

// Discriminated response of POST /tickets/claim: an issued ticket under cap, or
// a queued MEMBERSHIP_CLAIM request at cap.
export type ClaimResult =
  | { kind: "ticket"; ticket: TicketView }
  | { kind: "request"; requestId: string; status: TicketRequestStatus };
