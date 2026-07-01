# nocode-email-fallback-kit

A reference pattern for a problem that shows up constantly on no-code / low-code
app builders (Bubble, Softr, Glide, Webflow forms, Airtable-backed apps,
low-code internal tools, etc.):

> **The platform's built-in "email me when someone submits this form" feature
> works fine when you test it with your own account, then silently fails, or
> gets swallowed by spam filters, the moment it points at a real external
> business inbox.**

This repo is not a plugin for any specific platform. It's a small, working
demonstration of the fix, written so it can be dropped into (or adapted for)
almost any stack that can call a webhook.

## The problem, precisely

Most no-code builders offer a "native" outbound email action baked into their
form/workflow editor. Under the hood, that native sender is usually:

- A shared sending domain used by thousands of other tenants on the platform,
  with **no per-customer SPF/DKIM alignment** to the recipient's actual brand
  domain.
- Rate-limited or reputation-pooled: one bad actor on the platform can tank
  deliverability for everyone sending through that shared domain.
- Missing bounce/complaint handling entirely. If the send fails, it fails
  **silently**: there's often no dashboard, no log, no webhook, nothing to
  tell you the email never left the building, let alone that it landed in
  spam or got rejected outright.
- Fine against `@gmail.com` test addresses (the platform vendor's own domain
  reputation is usually decent), but inconsistent against a business's actual
  inbox provider (Microsoft 365 in particular is aggressive about filtering
  unfamiliar sending infrastructure).

The result: a client says "we're not getting form submissions," everyone
re-tests the form, the test email arrives fine (because it went to a Gmail
account with a warmed-up reputation), and the team concludes "it's working,"
while real customer inquiries quietly vanish for weeks.

## The fix

Don't trust the platform's native email action for anything business-critical.
Instead:

1. **Intercept the form submission via a webhook.** Nearly every no-code
   platform supports "on submit, call this URL" as a workflow step, even
   when its native email action is unreliable.
2. **Validate and sanitize the payload** in code you control. No-code
   platforms often pass inconsistent field names, empty strings instead of
   nulls, or unescaped HTML from free-text fields.
3. **Send the notification yourself through a dedicated transactional email
   provider** (this kit uses [Resend](https://resend.com) as the illustrative
   example, since it's what we use, but the pattern applies identically to
   Postmark, SendGrid, or SES). Transactional providers give you a
   purpose-built sending domain, proper SPF/DKIM/DMARC alignment tooling,
   and delivery event webhooks.
4. **Log and verify delivery**, rather than assuming "the API call didn't
   error" means "the email arrived." Delivered, bounced, and complained
   events are all first-class signals the provider sends back: use them.

This turns an invisible failure mode into an observable, debuggable pipeline:
`form submit -> webhook -> validate -> send -> log delivery status`, with a
real audit trail at every step.

## What's in this repo

| Path | What it demonstrates |
|---|---|
| [`webhook-receiver/`](./webhook-receiver) | The centerpiece: a serverless function that receives a generic form-submission webhook, validates/sanitizes it, and sends a formatted notification email via Resend. Written in a Vercel/Cloudflare-Worker-compatible style with no framework lock-in. |
| [`delivery-verification/`](./delivery-verification) | Scripts and a checklist for actually proving email deliverability end-to-end: DNS auth record checks (SPF/DKIM/DMARC), a seed-test pattern, and a delivery-event webhook listener that logs `delivered` / `bounced` / `complained` instead of assuming success. |
| [`DIAGNOSIS-CHECKLIST.md`](./DIAGNOSIS-CHECKLIST.md) | The generalizable troubleshooting flow for "the client says they're not getting form emails," including when to fix the platform's native DNS/auth setup instead of bypassing it entirely. |

## Quick start

```bash
npm install
cp webhook-receiver/.env.example webhook-receiver/.env
# fill in RESEND_API_KEY, FROM_EMAIL, NOTIFY_EMAIL
npm run dev        # local dev server for the webhook receiver
npm test           # unit tests for validation + payload normalization
```

Point your no-code platform's "on submit" webhook action at the deployed
function's URL (e.g. `https://your-project.vercel.app/api/webhook`), and the
platform's native email action can be turned off entirely, or kept as a
non-critical secondary notification while this pipeline becomes the source
of truth.

## Why this matters for a services engagement

This isn't a theoretical exercise. "Client says they're not getting leads"
is one of the highest-frequency, highest-anxiety support tickets in small
business web work, because it's directly tied to revenue (missed quote
requests, missed bookings, missed contact-form leads) and because the
default troubleshooting move, "did you check your spam folder?", often
doesn't find the real problem, since the failure frequently happens
*before* the email is ever generated, not after.

The pattern here, webhook interception plus dedicated transactional sender
plus logged delivery events, is the durable fix, not a workaround. It also
generalizes well beyond email: the same "don't trust the platform's black
box, intercept and verify" approach applies to SMS notifications, CRM syncs,
and any other "the no-code tool says it did the thing" integration.

## License

MIT. See [`LICENSE`](./LICENSE).
