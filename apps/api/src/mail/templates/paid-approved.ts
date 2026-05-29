import { PaidApprovedProps } from '../types';
import { button, escapeHtml, layout, mutedLink, paragraph } from './layout';

export interface RenderedMail {
  subject: string;
  html: string;
}

// PAID approval: the requester pays via the DIRECT Stripe Checkout URL. The
// link expires (R18), so the expiry is stated and the CTA is primary.
export function renderPaidApproved(
  props: PaidApprovedProps,
  webOrigin: string,
): RenderedMail {
  const requestsUrl = `${webOrigin}/dashboard/requests`;
  const body = [
    paragraph(`Hi ${escapeHtml(props.requesterName)},`),
    paragraph(
      `Your request for <strong>${escapeHtml(props.tierName)}</strong> at ` +
        `<strong>${escapeHtml(props.eventTitle)}</strong> was approved. ` +
        `Complete your payment to claim your ticket.`,
    ),
    button(props.checkoutUrl, 'Complete payment'),
    paragraph(
      `This payment link expires on ${escapeHtml(
        props.expiresAt.toUTCString(),
      )}. After that you can request a new spot.`,
    ),
    mutedLink(requestsUrl, 'View your requests'),
  ].join('');

  return {
    subject: `Your ticket request was approved — complete payment`,
    html: layout('Your request was approved', body),
  };
}
