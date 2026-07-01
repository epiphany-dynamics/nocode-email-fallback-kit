/**
 * Handler for Resend's outbound delivery-event webhooks
 * (email.sent / email.delivered / email.bounced / email.complained /
 * email.delivery_delayed). Configure this URL in the Resend dashboard
 * under Webhooks, subscribed to the events you want visibility into.
 *
 * This is the piece that makes the whole pipeline observable rather than
 * "fire and hope": instead of assuming a 200 response from the send API
 * call means the message was delivered, this listener records what
 * actually happened to each message after Resend handed it off to the
 * receiving mail server.
 *
 * In a real deployment, replace the `recordEvent` function's console.log
 * with a write to whatever the team already uses for logs/alerts:
 * a database table, a Slack webhook for bounced/complained events, a
 * logging service, etc. The point demonstrated here is the shape of the
 * event and the signature verification, not a specific storage backend.
 *
 * Docs: https://resend.com/docs/dashboard/webhooks/event-types
 */
const { verifyResendWebhookSignature } = require('./verify-signature');

/**
 * @param {{
 *   type: string,
 *   created_at: string,
 *   data: { email_id?: string, to?: string[], from?: string, subject?: string, [key: string]: unknown }
 * }} event
 */
function recordEvent(event) {
  const severity = ['email.bounced', 'email.complained', 'email.delivery_delayed'].includes(event.type)
    ? 'WARN'
    : 'INFO';

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level: severity,
      event: 'resend_delivery_event',
      type: event.type,
      emailId: event.data && event.data.email_id,
      to: event.data && event.data.to,
      occurredAt: event.created_at,
      loggedAt: new Date().toISOString(),
    })
  );

  if (severity === 'WARN') {
    // This is the hook point for real alerting: page/Slack/email the team
    // when a bounce or spam complaint comes in, since these are the exact
    // signals a no-code platform's native email action would never
    // surface to anyone.
    // eslint-disable-next-line no-console
    console.warn(
      `ALERT: ${event.type} for email ${event.data && event.data.email_id} to ${
        event.data && event.data.to
      }. Wire this branch to real alerting (Slack webhook, PagerDuty, etc.) in production.`
    );
  }
}

/**
 * Vercel-style handler. See webhook-receiver/api/webhook.js for notes on
 * porting this adapter shape to other serverless runtimes.
 */
module.exports = async function deliveryEventHandler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed, use POST' });
    return;
  }

  // Signature verification requires the RAW body string, not a
  // pre-parsed object, because the HMAC is computed over the exact bytes
  // Resend sent. Ensure your runtime/framework is configured to give you
  // the raw body for this route (in Vercel, disable the default body
  // parser for this function; in Express, use `express.raw()` on this
  // route specifically).
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

  const verification = verifyResendWebhookSignature({
    payload: rawBody,
    svixId: req.headers['svix-id'],
    svixTimestamp: req.headers['svix-timestamp'],
    svixSignature: req.headers['svix-signature'],
    secret: process.env.RESEND_WEBHOOK_SECRET,
  });

  if (!verification.valid) {
    // eslint-disable-next-line no-console
    console.warn(`Rejected delivery-event webhook: ${verification.reason}`);
    res.status(401).json({ error: 'invalid signature', reason: verification.reason });
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: 'invalid JSON body' });
    return;
  }

  recordEvent(event);

  res.status(200).json({ received: true });
};
