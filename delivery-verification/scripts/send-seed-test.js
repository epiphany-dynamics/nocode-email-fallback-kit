#!/usr/bin/env node
/**
 * send-seed-test.js
 *
 * "Seed testing" is the standard deliverability-industry technique of
 * sending a real message to a set of mailboxes you control across
 * multiple providers (Gmail, Microsoft 365/Outlook, Yahoo, a private
 * domain inbox) and checking where it actually lands (inbox / spam /
 * never arrives) rather than trusting a single test address.
 *
 * This script is a thin wrapper that fires the SAME payload this kit's
 * webhook receiver would send, at a list of seed addresses, via the
 * Resend API directly. It exists because "I tested it and the email
 * arrived" is only meaningful if you tested against the SAME kind of
 * inbox the client's actual customers/staff use, not just your own
 * warmed-up Gmail account.
 *
 * Usage:
 *   RESEND_API_KEY=re_xxx FROM_EMAIL="Notices <notices@yourdomain.com>" \
 *     node send-seed-test.js seed-list.txt
 *
 * seed-list.txt: one email address per line, ideally spanning at least:
 *   - a Gmail/Google Workspace address
 *   - a Microsoft 365/Outlook.com address
 *   - the actual business inbox provider if known (e.g. GoDaddy-hosted
 *     email, a regional ISP, etc.)
 *
 * After sending, manually check each inbox AND its spam/junk folder, then
 * cross-reference against delivery events logged by
 * `delivery-verification/webhook-listener/` to confirm the provider's
 * own view (delivered/bounced/complained) matches what actually happened
 * in the mailbox.
 */

const fs = require('node:fs');
const path = require('node:path');

const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendOne(apiKey, from, to) {
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Deliverability seed test: nocode-email-fallback-kit',
      text: [
        'This is a seed test message sent by delivery-verification/scripts/send-seed-test.js.',
        '',
        `Sent at: ${new Date().toISOString()}`,
        `Target inbox: ${to}`,
        '',
        'If you are reviewing this message: check whether it landed in the',
        'primary inbox or was filtered to spam/junk, and note that alongside',
        'the delivery event logged by the webhook listener for the same',
        'send, to confirm both views agree.',
      ].join('\n'),
      tags: [{ name: 'category', value: 'seed_test' }],
    }),
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    // ignore
  }

  return { to, ok: response.ok, status: response.status, id: body && body.id, error: body && body.message };
}

async function main() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.FROM_EMAIL;
  const seedListPath = process.argv[2];

  if (!apiKey || !from) {
    console.error('Set RESEND_API_KEY and FROM_EMAIL environment variables first.');
    process.exit(2);
  }
  if (!seedListPath) {
    console.error('Usage: node send-seed-test.js <path-to-seed-list.txt>');
    process.exit(2);
  }

  const listContents = fs.readFileSync(path.resolve(seedListPath), 'utf8');
  const addresses = listContents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (addresses.length === 0) {
    console.error('Seed list is empty (or every line was a comment).');
    process.exit(2);
  }

  console.log(`Sending seed test to ${addresses.length} address(es)...\n`);

  const results = await Promise.all(addresses.map((to) => sendOne(apiKey, from, to)));

  for (const result of results) {
    const status = result.ok ? `sent (id: ${result.id})` : `FAILED (${result.status}: ${result.error})`;
    console.log(`${result.to}: ${status}`);
  }

  console.log(
    '\nNext: manually check inbox + spam/junk folder for each address above, then compare against events captured by delivery-verification/webhook-listener/ for the same message IDs.'
  );
}

main().catch((err) => {
  console.error('send-seed-test failed:', err);
  process.exit(2);
});
