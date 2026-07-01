const { handleSubmission } = require('../lib/handle-submission');

/**
 * Vercel-style serverless function entry point.
 *
 * Deploy target notes:
 *  - On Vercel: drop this file at `api/webhook.js` in a project root and it
 *    becomes `POST https://<project>.vercel.app/api/webhook` automatically.
 *  - On Cloudflare Workers: wrap `handleSubmission` in an `export default {
 *    async fetch(request, env) { ... } }` module instead of this
 *    `(req, res)` signature; env vars come from `env.*` rather than
 *    `process.env.*`. `lib/handle-submission.js` is runtime-agnostic and
 *    works unchanged either way, only this adapter file changes.
 *  - On AWS Lambda / Netlify Functions: same idea, thin adapter around the
 *    same `handleSubmission` call with that platform's request/response
 *    shape.
 *
 * Point your no-code platform's "on submit, call webhook" action at this
 * URL. Configure it to send the raw form field payload as JSON.
 */
module.exports = async function webhookHandler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed, use POST' });
    return;
  }

  const config = {
    resendApiKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.FROM_EMAIL,
    notifyEmail: process.env.NOTIFY_EMAIL,
    sourceLabel: process.env.SOURCE_LABEL || 'Website contact form',
    webhookSecret: process.env.WEBHOOK_SECRET || '',
    // Accept the shared secret via header or query param, whichever the
    // no-code platform's webhook action supports.
    providedSecret:
      req.headers['x-webhook-secret'] ||
      (req.query && req.query.secret) ||
      '',
  };

  let body = req.body;
  // Some runtimes (raw Node http, some Cloudflare adapters) hand you the
  // request body as a string or Buffer instead of pre-parsed JSON.
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: 'request body is not valid JSON' });
      return;
    }
  }

  const result = await handleSubmission(body, config);

  // Always log the outcome server-side, independent of what we return to
  // the caller. This is the audit trail that the no-code platform's native
  // email action never gave you.
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: 'webhook_submission_handled',
      outcome: result.outcome,
      errors: result.errors,
      emailId: result.emailId,
      email: result.normalized && result.normalized.email,
      timestamp: new Date().toISOString(),
    })
  );

  res.status(result.httpStatus).json({
    outcome: result.outcome,
    ...(result.emailId ? { emailId: result.emailId } : {}),
    ...(result.errors.length ? { errors: result.errors } : {}),
  });
};
