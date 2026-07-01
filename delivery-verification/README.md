# delivery-verification

Sending an email and receiving a `200 OK` from the provider's API is not
proof the email was delivered. This directory demonstrates the three
concrete steps that turn "we assume it works" into "we can prove it works":

1. **Check DNS authentication records** for the sending domain (SPF, DKIM,
   DMARC). Missing or misconfigured records are the single most common
   reason a correctly coded sender still lands in spam or gets rejected.
2. **Send real seed tests** to mailboxes on multiple providers (not just
   one warmed-up Gmail test account) and manually confirm inbox placement.
3. **Log the provider's own delivery events** (`delivered`, `bounced`,
   `complained`, `delivery_delayed`) via its outbound event webhook, so
   failures after the send call are visible instead of silent.

## 1. DNS authentication check

```bash
node scripts/check-dns-auth.js yourdomain.com
node scripts/check-dns-auth.js yourdomain.com --dkim-selector resend
```

Checks:

- **SPF**: exactly one `v=spf1` TXT record on the root domain. Multiple SPF
  records is a common self-inflicted failure (RFC 7208 only permits one).
- **DMARC**: a `v=DMARC1` TXT record at `_dmarc.yourdomain.com`, and reports
  whether its policy is `none` (monitor-only), `quarantine`, or `reject`.
- **DKIM**: a TXT record at `<selector>._domainkey.yourdomain.com`. The
  selector is provider-specific (Resend's dashboard shows you the exact
  selector and record to publish once you add and verify a domain), so this
  check is skipped unless `--dkim-selector` is passed.

Exits non-zero if SPF or DMARC (or DKIM, when a selector is given) is
missing, so this is safe to wire into a CI/setup-verification step.

## 2. Seed testing

```bash
cp scripts/seed-list.example.txt scripts/seed-list.txt
# edit seed-list.txt with real addresses you control, across providers
RESEND_API_KEY=re_xxx FROM_EMAIL="Notices <notices@yourdomain.com>" \
  node scripts/send-seed-test.js scripts/seed-list.txt
```

Sends a real test message to every address in the list, using the same
Resend API path the webhook receiver uses. After sending, manually check
each mailbox's inbox and spam/junk folder. This is the step that catches
the specific failure mode this kit exists to fix: a message that arrives
fine at a Gmail test account but silently gets filtered at a Microsoft 365
business inbox.

## 3. Delivery event webhook listener

```
webhook-listener/
  verify-signature.js       Svix HMAC signature verification for Resend webhooks
  log-delivery-event.js     Handler that logs delivered/bounced/complained events
  verify-signature.test.js
```

Configure a webhook in the Resend dashboard (Webhooks -> Add Endpoint)
pointed at wherever you deploy `log-delivery-event.js`, subscribed to at
minimum `email.delivered`, `email.bounced`, and `email.complained`. Copy
the signing secret it gives you into `RESEND_WEBHOOK_SECRET`.

Every event is logged as structured JSON; bounce and complaint events are
additionally flagged with a `WARN` level and a placeholder alert line,
which is the integration point for real alerting (Slack, PagerDuty, email)
in a production deployment.

**Signature verification is not optional.** This endpoint is public by
necessity (Resend's servers need to reach it), so without verifying the
`svix-*` headers against the signing secret, anyone who discovers the URL
could inject fake `delivered` events, or trigger noise, making the log
untrustworthy. `verify-signature.js` reimplements the Svix HMAC-SHA256
check in isolation, in about 30 lines, so it is easy to audit rather than
being an opaque dependency.

## Running the tests

```bash
npm test
```

runs both `webhook-receiver/test/` and
`delivery-verification/webhook-listener/verify-signature.test.js` via
Node's built-in test runner.
