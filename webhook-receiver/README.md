# webhook-receiver

The centerpiece of this kit: a small, framework-free serverless function
that receives a form-submission webhook from a no-code/low-code platform,
validates and sanitizes the payload, and sends a formatted notification
email via [Resend](https://resend.com) instead of relying on the platform's
own (often unreliable) native email action.

## Layout

```
webhook-receiver/
  api/
    webhook.js           Vercel-style HTTP entry point (thin adapter)
  lib/
    sanitize.js           Payload normalization + validation + HTML escaping
    render-email.js        HTML/text email template
    resend-client.js       Minimal dependency-free Resend API client
    handle-submission.js  Core runtime-agnostic orchestration logic
  test/
    sanitize.test.js
    handle-submission.test.js
  dev-server.js            Local dev server (Node http, no framework)
  .env.example
```

The split between `api/webhook.js` (runtime adapter) and
`lib/handle-submission.js` (pure logic) is intentional: the logic has zero
dependency on any specific serverless platform's request/response shape, so
porting this from Vercel to Cloudflare Workers, AWS Lambda, or a plain
Express app means rewriting only the ~30-line adapter, not the pipeline.

## Running locally

```bash
npm install
cp .env.example .env
# edit .env with a real RESEND_API_KEY, FROM_EMAIL, NOTIFY_EMAIL
npm run dev
```

Then, in another terminal:

```bash
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane Doe","email":"jane@example.com","message":"Do you have availability next week?"}'
```

You should see a JSON response describing the outcome (`sent`,
`send_failed`, `rejected_invalid`, or `unauthorized`) and, if `RESEND_API_KEY`
is a real key pointed at a verified sending domain, a real email should land
in `NOTIFY_EMAIL`'s inbox within seconds.

## Deploying

**Vercel:** copy `api/webhook.js` and `lib/` into a Vercel project, set the
three required env vars (`RESEND_API_KEY`, `FROM_EMAIL`, `NOTIFY_EMAIL`) in
the Vercel dashboard, and deploy. The function is automatically available at
`https://<project>.vercel.app/api/webhook`.

**Cloudflare Workers:** wrap the same `handleSubmission` call from
`lib/handle-submission.js` in a Workers `fetch` export instead of the
Vercel `(req, res)` adapter in `api/webhook.js`. Env vars come from the
`env` binding rather than `process.env`.

**Any other Node-based serverless platform** (Netlify Functions, AWS Lambda
behind API Gateway, etc.): same pattern, thin adapter around
`handleSubmission`.

## Wiring it into a no-code platform

Most no-code app builders support an "on submit -> call webhook" workflow
step even when their native email action is unreliable. Configure that step
to:

1. **Method:** `POST`
2. **URL:** your deployed function's URL (e.g.
   `https://your-project.vercel.app/api/webhook`)
3. **Body:** JSON, with all form fields included (field names don't need to
   match exactly; `lib/sanitize.js` recognizes common aliases like `name`
   / `full_name`, `email` / `contact_email`, etc. Extend the alias lists
   there if your platform uses different names)
4. **Header (optional but recommended):** `X-Webhook-Secret: <value>`
   matching the `WEBHOOK_SECRET` env var, if your platform supports custom
   headers on webhook actions. If it only supports query params, append
   `?secret=<value>` to the URL instead.

Once confirmed working, the platform's own native "send email" action can
be disabled, or left in place as a redundant secondary path. It should
never be the only path.

## Why no HTML-templating library or ORM

This kit intentionally avoids pulling in an email templating engine,
validation library (Zod/Joi), or HTTP framework. The point is to demonstrate
the pattern clearly with code that's easy to read start to finish; in a real
production build for a client, swapping in Zod for validation or React Email
for templating is a reasonable upgrade, not a requirement.
