const { normalizeSubmission } = require('./sanitize');
const { renderNotificationEmail } = require('./render-email');
const { sendTransactionalEmail } = require('./resend-client');

/**
 * Core, runtime-agnostic handler for a form-submission webhook.
 *
 * This function deliberately does not know about Vercel, Cloudflare
 * Workers, Express, or any other HTTP framework. It takes a plain object
 * (the parsed JSON body) plus a config object, and returns a plain result
 * object describing what happened. Thin adapters in `api/webhook.js` (and
 * `test/handle-submission.test.js`) translate that to/from a specific
 * runtime's request/response shape.
 *
 * Design choices worth calling out:
 *  - Invalid payloads still return a 2xx-shaped "handled" result rather than
 *    throwing, because most no-code platforms will retry (sometimes
 *    aggressively) on a non-2xx webhook response, which can turn one bad
 *    payload into a retry storm. We log the rejection instead of bouncing
 *    it back as an HTTP error.
 *  - Every outcome (accepted-and-sent, accepted-but-send-failed,
 *    rejected-invalid) is returned with enough detail to log, because
 *    "the webhook returned 200" must never be conflated with "the email
 *    was delivered."
 *
 * @param {unknown} rawPayload - parsed JSON body from the incoming webhook
 * @param {{
 *   resendApiKey: string,
 *   fromEmail: string,
 *   notifyEmail: string,
 *   sourceLabel?: string,
 *   webhookSecret?: string,
 *   providedSecret?: string,
 * }} config
 * @returns {Promise<{
 *   outcome: 'sent' | 'send_failed' | 'rejected_invalid' | 'unauthorized',
 *   httpStatus: number,
 *   errors: string[],
 *   emailId?: string,
 *   normalized?: ReturnType<typeof normalizeSubmission>['data'],
 * }>}
 */
async function handleSubmission(rawPayload, config) {
  // Optional shared-secret check. Many no-code platforms let you add a
  // custom header or query param to outbound webhooks; if configured, this
  // provides a cheap layer of protection against random internet traffic
  // hitting the endpoint and triggering emails.
  if (config.webhookSecret) {
    if (config.providedSecret !== config.webhookSecret) {
      return {
        outcome: 'unauthorized',
        httpStatus: 401,
        errors: ['webhook secret missing or incorrect'],
      };
    }
  }

  const { valid, errors, data } = normalizeSubmission(rawPayload);

  if (!valid) {
    // Respond 200 so the sending platform does not treat this as a
    // transient failure and retry-storm us, but the caller (api/webhook.js)
    // is expected to log `errors` somewhere visible (console -> platform
    // log aggregator at minimum).
    return {
      outcome: 'rejected_invalid',
      httpStatus: 200,
      errors,
      normalized: data,
    };
  }

  const { subject, html, text } = renderNotificationEmail(data, {
    sourceLabel: config.sourceLabel,
  });

  const result = await sendTransactionalEmail({
    apiKey: config.resendApiKey,
    from: config.fromEmail,
    to: config.notifyEmail,
    subject,
    html,
    text,
    // If the submitter gave us their email, wire it up as reply-to so the
    // business can hit "reply" and respond directly to the lead.
    replyTo: data.email || undefined,
    tags: [{ name: 'category', value: 'form_submission_fallback' }],
  });

  if (!result.ok) {
    return {
      outcome: 'send_failed',
      // 502: the webhook itself was received and understood, but the
      // downstream send failed. Returning a non-2xx here is intentional:
      // unlike a malformed payload, this IS a transient-looking failure
      // (Resend outage, bad API key, rate limit) worth surfacing so
      // monitoring/alerting on the receiving end (or the no-code platform's
      // own webhook-failure log, if it has one) can catch it.
      httpStatus: 502,
      errors: [result.error || 'unknown error sending via Resend'],
      normalized: data,
    };
  }

  return {
    outcome: 'sent',
    httpStatus: 200,
    errors: [],
    emailId: result.id,
    normalized: data,
  };
}

module.exports = { handleSubmission };
