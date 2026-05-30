import { RejectedProps } from '../types';
import { escapeHtml, layout, mutedLink, paragraph } from './layout';
import { RenderedMail } from './paid-approved';

// Shared by admin reject and scheduler auto-reject (R21, template c). The
// admin-supplied reason is rendered only when present, and ALWAYS escaped — a
// crafted reason must not inject HTML/links into mail from the trusted domain.
export function renderRejected(
  props: RejectedProps,
  webOrigin: string,
): RenderedMail {
  const requestsUrl = `${webOrigin}/dashboard/requests`;
  const reason = props.reason?.trim();
  const body = [
    paragraph(`Hi ${escapeHtml(props.requesterName)},`),
    paragraph(
      `Your request for <strong>${escapeHtml(props.tierName)}</strong> at ` +
        `<strong>${escapeHtml(props.eventTitle)}</strong> wasn't approved.`,
    ),
    reason ? paragraph(`Organizer note: ${escapeHtml(reason)}`) : '',
    mutedLink(requestsUrl, 'Browse other tickets'),
  ].join('');

  return {
    subject: `Update on your ticket request`,
    html: layout('Update on your request', body),
  };
}
