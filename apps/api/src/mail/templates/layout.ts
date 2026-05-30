// Shared rendering helpers for the transactional email templates. Plain HTML
// strings (not react-email) on purpose — three small emails do not justify
// pulling React/JSX into this nest-build/tsc backend. Every dynamic value MUST
// pass through escapeHtml so a crafted event title or reject reason cannot
// inject markup into mail sent from the trusted domain (R26).

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Wraps body markup in a minimal, email-client-safe document shell.
export function layout(heading: string, bodyHtml: string): string {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(heading)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">',
    '<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">',
    `<h1 style="font-size:18px;margin:0 0 16px;">${escapeHtml(heading)}</h1>`,
    bodyHtml,
    '</div></body></html>',
  ].join('');
}

export function paragraph(text: string): string {
  return `<p style="font-size:14px;line-height:1.6;margin:0 0 16px;">${text}</p>`;
}

// `href` is expected to be a server-controlled URL (a Stripe Checkout URL or a
// WEB_ORIGIN-rooted deep link); it is attribute-escaped defensively.
export function button(href: string, label: string): string {
  return [
    `<p style="margin:0 0 16px;"><a href="${escapeHtml(href)}"`,
    'style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;',
    'padding:10px 20px;border-radius:9999px;font-size:14px;font-weight:600;">',
    `${escapeHtml(label)}</a></p>`,
  ].join('');
}

export function mutedLink(href: string, label: string): string {
  return `<p style="font-size:13px;color:#71717a;margin:0;"><a href="${escapeHtml(
    href,
  )}" style="color:#3f3f46;">${escapeHtml(label)}</a></p>`;
}
