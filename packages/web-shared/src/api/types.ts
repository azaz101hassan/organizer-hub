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
  labelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventLabelView {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  sortOrder: number;
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
  label: { id: string; name: string; slug: string } | null;
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

export type CoverageVerdict = "OWNED" | "AT_CAP" | "CLAIMABLE" | "BUY";

export type TicketRequestIntent = "PAID" | "MEMBERSHIP_CLAIM";

// Per-TicketType coverage result from GET /memberships/me/coverage. For AT_CAP
// it carries the intake intent (which endpoint "Request a spot" posts to) and
// the caller's existing open request id, if any (→ "Request pending" deep-link).
export interface CoverageResult {
  verdict: CoverageVerdict;
  requestIntent?: TicketRequestIntent;
  openRequestId?: string | null;
}

export type TicketRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED_BY_USER"
  | "EXPIRED";

// Requester-facing request view (GET /requests, /requests/:id). hasTicket
// distinguishes APPROVED-awaiting-payment (PAID, false) from APPROVED-with-
// ticket (true).
export interface RequesterTicketRequestView {
  id: string;
  userId: string;
  ticketTypeId: string;
  eventId: string;
  intent: TicketRequestIntent;
  status: TicketRequestStatus;
  stripeCheckoutSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  event: { id: string; title: string; startsAt: string };
  ticketTypeName: string;
  ticketTypePriceCents: number;
  hasTicket: boolean;
}

// GET /requests/:id/payment-link — the live Checkout link + expiry for an
// APPROVED-awaiting-payment PAID request. url is null once Stripe expires it.
export interface PaymentLinkView {
  url: string | null;
  expiresAt: string | null;
}

// Admin queue row (GET /orgs/:orgId/requests). issuedCount + cap drive the
// over-cap approve confirm.
export interface AdminTicketRequestView {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  intent: TicketRequestIntent;
  status: TicketRequestStatus;
  createdAt: string;
  event: { id: string; title: string };
  ticketType: { id: string; name: string; cap: number | null };
  issuedCount: number;
}

export interface AdminQueuePage {
  items: AdminTicketRequestView[];
  nextCursor: string | null;
}

// What rides the WaitlistStream SSE channel. `data` is intentionally loose —
// request.created carries a base view; updated/removed often carry only
// { id, status }. The admin queue treats created as "refetch" and
// updated/removed as "drop row id" (any transition leaves the PENDING queue).
export interface WaitlistStreamEvent {
  type: "request.created" | "request.updated" | "request.removed";
  id: string;
  data: { id: string; status?: TicketRequestStatus };
}

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
