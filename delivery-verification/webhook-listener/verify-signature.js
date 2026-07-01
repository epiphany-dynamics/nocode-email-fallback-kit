/**
 * Verifies Resend webhook signatures using the Svix protocol (Resend's
 * event webhooks are delivered via Svix under the hood, using the
 * standard Svix headers and HMAC-SHA256 signing scheme).
 *
 * This matters because a delivery-event webhook listener is itself a
 * public endpoint: without signature verification, anyone who finds the
 * URL could POST fake "delivered" events to it and mask real failures in
 * your logs. Skipping this step defeats the entire point of building an
 * observable pipeline.
 *
 * Reference: https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
 * (Svix signing scheme: https://docs.svix.com/receiving/verifying-payloads/how)
 *
 * No external dependency (the `svix` npm package wraps this same logic;
 * it's reimplemented here in ~30 lines so the verification logic is fully
 * visible rather than a black box import).
 */
const crypto = require('node:crypto');

/**
 * @param {{
 *   payload: string,          // raw request body, exactly as received
 *   svixId: string,           // "svix-id" header
 *   svixTimestamp: string,    // "svix-timestamp" header
 *   svixSignature: string,    // "svix-signature" header (space-separated list of "v1,<sig>")
 *   secret: string,           // webhook signing secret from Resend dashboard, format "whsec_..."
 *   toleranceSeconds?: number // reject timestamps older/newer than this (replay protection)
 * }} params
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyResendWebhookSignature(params) {
  const { payload, svixId, svixTimestamp, svixSignature, secret, toleranceSeconds = 300 } = params;

  if (!svixId || !svixTimestamp || !svixSignature) {
    return { valid: false, reason: 'missing one or more required svix-* headers' };
  }
  if (!secret) {
    return { valid: false, reason: 'no webhook signing secret configured' };
  }

  const timestamp = parseInt(svixTimestamp, 10);
  if (!Number.isFinite(timestamp)) {
    return { valid: false, reason: 'svix-timestamp header is not a valid number' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { valid: false, reason: 'timestamp outside tolerance window, possible replay' };
  }

  // Secret is issued as "whsec_<base64>"; strip the prefix before decoding.
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');

  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  // svix-signature header can contain multiple space-separated
  // "version,signature" pairs (for secret rotation); check all of them.
  const candidates = svixSignature
    .split(' ')
    .map((entry) => entry.split(',')[1])
    .filter(Boolean);

  const matches = candidates.some((candidate) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(candidate, 'base64'), Buffer.from(expectedSignature, 'base64'));
    } catch {
      return false; // length mismatch etc.
    }
  });

  if (!matches) {
    return { valid: false, reason: 'signature mismatch' };
  }

  return { valid: true };
}

module.exports = { verifyResendWebhookSignature };
