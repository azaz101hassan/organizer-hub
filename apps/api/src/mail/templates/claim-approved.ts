import { ClaimApprovedProps } from '../types';
import { escapeHtml, layout, mutedLink, paragraph } from './layout';
import { RenderedMail } from './paid-approved';

// MEMBERSHIP_CLAIM approval: the Ticket is issued inline at approval, so this
// email simply confirms it (no payment step).
export function renderClaimApproved(
  props: ClaimApprovedProps,
  webOrigin: string,
): RenderedMail {
  const requestsUrl = `${webOrigin}/dashboard/requests`;
  const body = [
    paragraph(`Hi ${escapeHtml(props.requesterName)},`),
    paragraph(
      `Good news — your request for <strong>${escapeHtml(
        props.tierName,
      )}</strong> at <strong>${escapeHtml(props.eventTitle)}</strong> was ` +
        `approved and your ticket has been issued.`,
    ),
    mutedLink(requestsUrl, 'View your ticket'),
  ].join('');

  return {
    subject: `Your free ticket is confirmed`,
    html: layout('Your ticket is confirmed', body),
  };
}
