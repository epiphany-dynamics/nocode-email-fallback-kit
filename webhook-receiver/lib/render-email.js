const { escapeHtml } = require('./sanitize');

/**
 * Render the notification email sent to the business inbox whenever a form
 * is submitted. Kept deliberately simple (table-based, inline styles) so it
 * renders correctly in Outlook/Microsoft 365, which is the single most
 * common "why didn't the notification arrive/render" culprit for
 * business-owner inboxes.
 *
 * @param {{
 *   name: string,
 *   email: string,
 *   phone: string,
 *   subject: string,
 *   message: string,
 *   extra: Record<string, string>
 * }} data
 * @param {{ sourceLabel?: string, submittedAt?: Date }} [opts]
 * @returns {{ subject: string, html: string, text: string }}
 */
function renderNotificationEmail(data, opts = {}) {
  const sourceLabel = opts.sourceLabel || 'Website contact form';
  const submittedAt = opts.submittedAt instanceof Date ? opts.submittedAt : new Date();
  const timestamp = submittedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const subject = `[${sourceLabel}] ${data.subject || 'New submission'}`;

  const extraRows = Object.entries(data.extra || {});

  const rowHtml = (label, value) => {
    if (!value) return '';
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:13px;color:#6b7280;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:14px;color:#111827;">${escapeHtml(value)}</td>
      </tr>`;
  };

  const extraHtml = extraRows.map(([key, value]) => rowHtml(key, value)).join('');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,sans-serif;">
            <tr>
              <td style="background:#111827;padding:16px 24px;">
                <span style="color:#ffffff;font-size:15px;font-weight:bold;">${escapeHtml(sourceLabel)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 24px 4px 24px;">
                <h2 style="margin:0 0 4px 0;font-size:18px;color:#111827;">${escapeHtml(data.subject || 'New submission')}</h2>
                <p style="margin:0;font-size:12px;color:#9ca3af;">Received ${escapeHtml(timestamp)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 24px 24px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
                  ${rowHtml('Name', data.name)}
                  ${rowHtml('Email', data.email)}
                  ${rowHtml('Phone', data.phone)}
                  ${extraHtml}
                </table>
                ${data.message ? `
                <div style="margin-top:16px;">
                  <div style="font-size:13px;color:#6b7280;margin-bottom:4px;">Message</div>
                  <div style="font-size:14px;color:#111827;white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;">${escapeHtml(data.message)}</div>
                </div>` : ''}
              </td>
            </tr>
            <tr>
              <td style="padding:12px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:11px;color:#9ca3af;">Sent by the webhook fallback notifier. Reply directly to this email to reach the submitter if their email address was captured above.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textLines = [
    `${sourceLabel}: ${data.subject || 'New submission'}`,
    `Received: ${timestamp}`,
    '',
    data.name ? `Name: ${data.name}` : null,
    data.email ? `Email: ${data.email}` : null,
    data.phone ? `Phone: ${data.phone}` : null,
    ...extraRows.map(([key, value]) => `${key}: ${value}`),
    data.message ? `\nMessage:\n${data.message}` : null,
  ].filter((line) => line !== null);

  return { subject, html, text: textLines.join('\n') };
}

module.exports = { renderNotificationEmail };
