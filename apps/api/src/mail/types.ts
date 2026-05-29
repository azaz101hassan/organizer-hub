// Typed payloads for the three Phase 4 transactional emails (R21). Shared by
// the Mailer, the template builders, and the FakeMailer test double so the
// contract is single-sourced.

export interface PaidApprovedProps {
  requesterName: string;
  eventTitle: string;
  tierName: string;
  // The DIRECT Stripe-hosted Checkout URL (never a redirect through our
  // domain — R26). Rendered as the primary CTA.
  checkoutUrl: string;
  // When the Checkout link lapses (R18). Rendered so the requester knows the
  // window.
  expiresAt: Date;
}

export interface ClaimApprovedProps {
  requesterName: string;
  eventTitle: string;
  tierName: string;
}

export interface RejectedProps {
  requesterName: string;
  eventTitle: string;
  tierName: string;
  // Admin-supplied on manual reject; absent for scheduler auto-reject. Rendered
  // escaped — never as raw HTML (R26).
  reason?: string | null;
}

export type MailMessage =
  | { template: 'paid-approved'; to: string; props: PaidApprovedProps }
  | { template: 'claim-approved'; to: string; props: ClaimApprovedProps }
  | { template: 'rejected'; to: string; props: RejectedProps };

export type MailTemplateName = MailMessage['template'];
