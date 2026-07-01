#!/usr/bin/env node
/**
 * check-dns-auth.js
 *
 * Checks whether a sending domain has the DNS authentication records that
 * transactional email providers (Resend, Postmark, SendGrid, SES) and
 * receiving mailbox providers (Microsoft 365, Google Workspace) require
 * for reliable inbox delivery:
 *
 *   - SPF   (TXT on the root domain, "v=spf1 ...")
 *   - DKIM  (TXT on the provider-specific selector subdomain)
 *   - DMARC (TXT on _dmarc.<domain>)
 *
 * This is a diagnostic tool, not a magic fix: missing/misconfigured DNS
 * records are one of the most common reasons a *correctly coded* sender
 * still lands in spam or gets rejected outright. Run this against any
 * domain before assuming code is the problem.
 *
 * Usage:
 *   node check-dns-auth.js yourdomain.com
 *   node check-dns-auth.js yourdomain.com --dkim-selector resend
 *
 * Exits non-zero if SPF or DMARC is missing (DKIM selector varies by
 * provider, so a missing DKIM record is reported but does not fail the
 * exit code unless --dkim-selector is explicitly provided and also
 * missing).
 */

const dns = require('node:dns').promises;

function parseArgs(argv) {
  const args = { domain: null, dkimSelector: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--dkim-selector') {
      args.dkimSelector = rest[i + 1];
      i++;
    } else if (!args.domain) {
      args.domain = rest[i];
    }
  }
  return args;
}

async function resolveTxt(hostname) {
  try {
    const records = await dns.resolveTxt(hostname);
    // dns.resolveTxt returns string[][] (each record can be split into
    // multiple chunks); join each record's chunks.
    return records.map((chunks) => chunks.join(''));
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') return [];
    throw err;
  }
}

async function checkSpf(domain) {
  const records = await resolveTxt(domain);
  const spfRecords = records.filter((r) => r.startsWith('v=spf1'));
  if (spfRecords.length === 0) {
    return { pass: false, detail: 'no SPF TXT record found on root domain' };
  }
  if (spfRecords.length > 1) {
    return {
      pass: false,
      detail: `multiple SPF records found (${spfRecords.length}); RFC 7208 permits only one, this WILL break SPF validation`,
      records: spfRecords,
    };
  }
  return { pass: true, detail: spfRecords[0] };
}

async function checkDmarc(domain) {
  const records = await resolveTxt(`_dmarc.${domain}`);
  const dmarcRecords = records.filter((r) => r.startsWith('v=DMARC1'));
  if (dmarcRecords.length === 0) {
    return { pass: false, detail: `no DMARC TXT record found at _dmarc.${domain}` };
  }
  const record = dmarcRecords[0];
  const policyMatch = record.match(/p=([a-z]+)/i);
  const policy = policyMatch ? policyMatch[1] : 'unknown';
  return {
    pass: true,
    detail: record,
    policy,
    note:
      policy === 'none'
        ? 'policy=none means DMARC is in monitor-only mode; failing messages are not blocked. Fine for initial rollout, but tighten to quarantine/reject once alignment is confirmed clean.'
        : undefined,
  };
}

async function checkDkim(domain, selector) {
  if (!selector) {
    return {
      pass: null,
      detail:
        'no --dkim-selector provided; DKIM selector is provider-specific (e.g. Resend uses "resend._domainkey", check your provider dashboard for the exact selector it issued)',
    };
  }
  const hostname = `${selector}._domainkey.${domain}`;
  const records = await resolveTxt(hostname);
  if (records.length === 0) {
    return { pass: false, detail: `no DKIM TXT record found at ${hostname}` };
  }
  return { pass: true, detail: records[0].slice(0, 80) + '...' };
}

async function main() {
  const { domain, dkimSelector } = parseArgs(process.argv);
  if (!domain) {
    console.error('Usage: node check-dns-auth.js <domain> [--dkim-selector <selector>]');
    process.exit(2);
  }

  console.log(`Checking email authentication DNS records for: ${domain}\n`);

  const [spf, dmarc, dkim] = await Promise.all([
    checkSpf(domain),
    checkDmarc(domain),
    checkDkim(domain, dkimSelector),
  ]);

  const printResult = (label, result) => {
    const icon = result.pass === true ? 'PASS' : result.pass === false ? 'FAIL' : 'SKIP';
    console.log(`[${icon}] ${label}`);
    console.log(`       ${result.detail}`);
    if (result.note) console.log(`       note: ${result.note}`);
    console.log('');
  };

  printResult('SPF', spf);
  printResult('DMARC', dmarc);
  printResult('DKIM', dkim);

  const hardFail = spf.pass === false || dmarc.pass === false || dkim.pass === false;

  if (hardFail) {
    console.log(
      'One or more required records are missing. Until these are fixed, expect inconsistent delivery to strict inbox providers (Microsoft 365 in particular), regardless of how correct the sending code is.'
    );
    process.exit(1);
  }

  console.log('All checked records look present. This does not guarantee inbox placement (content/reputation still matter), but rules out the most common structural cause of silent delivery failure.');
}

main().catch((err) => {
  console.error('check-dns-auth failed:', err);
  process.exit(2);
});
