/**
 * Minimal Resend API client using the platform `fetch` (available natively
 * in Vercel/Cloudflare Workers/Node 18+ runtimes) instead of the full
 * `resend` npm SDK. Keeping this dependency-free makes the pattern portable
 * to any serverless runtime without worrying about SDK/runtime
 * compatibility, and makes the HTTP contract with Resend fully visible.
 *
 * Resend API docs: https://resend.com/docs/api-reference/emails/send-email
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * @param {{
 *   apiKey: string,
 *   from: string,
 *   to: string | string[],
 *   subject: string,
 *   html: string,
 *   text?: string,
 *   replyTo?: string,
 *   tags?: { name: string, value: string }[]
 * }} params
 * @returns {Promise<{ ok: boolean, status: number, id?: string, error?: string }>}
 */
async function sendTransactionalEmail(params) {
  const { apiKey, from, to, subject, html, text, replyTo, tags } = params;

  if (!apiKey) {
    throw new Error('sendTransactionalEmail: apiKey is required (set RESEND_API_KEY)');
  }
  if (!from) {
    throw new Error('sendTransactionalEmail: from is required (set FROM_EMAIL)');
  }
  if (!to) {
    throw new Error('sendTransactionalEmail: to is required (set NOTIFY_EMAIL)');
  }

  const body = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (text) body.text = text;
  if (replyTo) body.reply_to = replyTo;
  if (tags && tags.length) body.tags = tags;

  let response;
  try {
    response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    // Network-level failure (DNS, TLS, timeout): this is exactly the class
    // of failure that a no-code platform's native sender would swallow
    // silently. Here it surfaces as a thrown/loggable error instead.
    return {
      ok: false,
      status: 0,
      error: `network error calling Resend API: ${networkErr.message}`,
    };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON response body; fall through with payload = null.
  }

  if (!response.ok) {
    const message = payload && payload.message ? payload.message : response.statusText;
    return { ok: false, status: response.status, error: message };
  }

  return { ok: true, status: response.status, id: payload && payload.id };
}

module.exports = { sendTransactionalEmail, RESEND_API_URL };
