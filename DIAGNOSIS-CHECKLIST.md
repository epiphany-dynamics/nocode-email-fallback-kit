# Diagnosis checklist: "we're not getting form emails"

A generalizable troubleshooting flow for the single most common support
ticket in small-business web work: a client (or their staff) reports that
form submissions, booking confirmations, or "contact us" notifications
have stopped arriving, or never arrived in the first place. Work through
these steps in order; most of the time the answer is found in the first
three.

## Step 1: Check the obvious, fast things first

- [ ] **Spam / junk folder.** Genuinely check it, don't just ask the client
      to. Search the mailbox for the expected sender name/domain and
      subject line keywords, not just glance at the inbox.
- [ ] **Email filtering rules.** Check for a client-side rule (in Outlook,
      Gmail, or their mail client) that could be silently archiving,
      deleting, or forwarding messages from the sending address elsewhere.
- [ ] **Correct recipient address configured.** Confirm the address
      configured in the no-code platform's notification settings is
      actually the one the client is checking. Typos and stale addresses
      from a previous employee are common.
- [ ] **Is this new, or has it never worked?** If it "used to work," ask
      what changed: domain migration, platform plan downgrade, a changed
      recipient address, a new spam filter/security product (e.g. the
      client's IT switched to a new email security gateway) are all common
      triggers.

## Step 2: Check the platform's own send log, if it has one

- [ ] Does the no-code platform expose any kind of "email sent" log,
      activity history, or workflow run history? Many do, buried in an
      admin/settings area.
- [ ] If yes: does the log show the send as successful? If the platform
      itself reports failure, that's the answer, go fix whatever the
      platform's error says (usually a config issue, invalid template
      variable, or a rate/plan limit).
- [ ] If the log shows "sent" but the client never received it: this is
      the core symptom this kit addresses. The platform believes it sent
      the email; the client's inbox never got it. This is a deliverability
      problem, not a "did the button work" problem.
- [ ] If there is no log at all: treat this as a red flag on its own. A
      notification feature with zero observability into whether sends
      succeeded or failed is exactly the failure mode this kit exists to
      route around.

## Step 3: Check DNS authentication records for the sending domain

Run (or manually look up):

```bash
node delivery-verification/scripts/check-dns-auth.js clientdomain.com
```

- [ ] **SPF record present**, exactly one, and does it actually authorize
      the no-code platform's sending infrastructure? (Check the platform's
      own docs for what to add to SPF; a platform can be a legitimate
      sender and still fail SPF if the client's DNS wasn't updated when
      the platform was set up.)
- [ ] **DKIM record present** for whatever selector the platform uses
      (check the platform's domain/email settings for the exact record it
      expects you to publish).
- [ ] **DMARC record present**, and note its policy (`p=none` /
      `quarantine` / `reject`). A strict DMARC policy (`reject`) combined
      with a sender that fails SPF/DKIM alignment means messages are
      **being actively rejected by the receiving server**, sometimes with
      no bounce ever surfacing anywhere the client can see.
- [ ] If any of these are missing or wrong: this alone can fully explain
      silent failure, independent of anything the platform or webhook code
      is doing.

## Step 4: Determine whether the platform is even attempting external sends

This is the step people skip, and it's the one that most often explains
"works for our test account, fails for the real client inbox":

- [ ] Does the platform's native email feature use a **shared sending
      domain** (something like `noreply@platformname.com` or a
      platform-branded subdomain), or does it send **from the client's own
      verified domain**?
- [ ] If shared: is that shared domain's reputation actually good right
      now? A platform-wide reputation problem (another tenant on the same
      platform sending spam) can degrade deliverability for every customer
      on that platform, with zero visibility or recourse for any single
      client.
- [ ] Test by sending to **multiple provider types**, not just one: a
      Gmail address, a Microsoft 365/Outlook address, and (if possible)
      the client's actual production inbox provider. A message landing
      fine in Gmail but disappearing at Microsoft 365 is the textbook
      version of this exact bug, since Microsoft's filtering is
      historically the strictest against unfamiliar or shared sending
      infrastructure.
- [ ] If reasonably possible, get a **bounce message** by sending to an
      address that will definitely reject (or check whether the platform
      surfaces bounces anywhere). Silent disappearance with zero bounce
      anywhere in the chain is strong evidence the platform is either not
      really attempting the send, or the receiving server is silently
      discarding it (sometimes indistinguishable from the outside without
      access to mail server logs on either end).

## Step 5: Decide: fix the platform's native sending, or bypass it

Two legitimate paths from here. Choose based on what Step 3 and Step 4
found.

### Fix DNS/auth and keep native sending, when:

- The platform sends from the **client's own domain** (not a shared
  platform domain), so fixing SPF/DKIM/DMARC on that domain directly fixes
  the platform's native sends too.
- The platform **does** expose a send log/activity history, giving you
  ongoing visibility without building anything extra.
- The platform's native email feature supports what the client actually
  needs (attachments, specific formatting, multiple recipients, etc.)
  without workarounds.
- This is the lower-effort fix when it applies: get the DNS records
  correct, re-run the seed test
  (`delivery-verification/scripts/send-seed-test.js`), confirm delivery
  across provider types, done.

### Bypass the platform's native email entirely (this kit's approach), when:

- The platform sends from a **shared domain you don't control** and can't
  add proper SPF/DKIM alignment to.
- The platform has **no delivery visibility at all** (no send log, no
  bounce handling, no way to distinguish "sent successfully" from "tried
  and failed").
- DNS/auth is already correct and the client is still experiencing
  inconsistent delivery, meaning the problem is upstream in the platform's
  sending infrastructure itself, not something fixable from the client's
  side.
- The client needs a durable audit trail of every submission and its
  delivery status, which a "just fix DNS" approach doesn't provide on its
  own.
- In this case: intercept the submission via webhook
  (`webhook-receiver/`), send through a dedicated transactional provider
  with its own properly authenticated domain, and log delivery events
  (`delivery-verification/webhook-listener/`) so future "we're not getting
  emails" reports come with actual evidence instead of guesswork.

## Anti-patterns to avoid

- **"I tested it and it worked"** using only your own Gmail test account.
  Always test against the same class of inbox the real business uses.
- **Assuming a 200 response from any send API means delivery happened.**
  It means the provider accepted the request. Delivery is a separate,
  asynchronous outcome that must be confirmed via delivery events or
  actual inbox checks.
- **Re-adding the client's recipient address as a "fix"** without
  investigating further. This sometimes appears to help by coincidence
  (timing, an unrelated spam filter update) and creates false confidence
  that the underlying problem was found.
- **Leaving a client on a platform's native sending indefinitely after
  finding it has no delivery visibility**, even if it "seems to be working
  again." Without logging, you have no way to know if or when it silently
  breaks again.
