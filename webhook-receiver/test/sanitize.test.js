const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSubmission, escapeHtml, cleanText } = require('../lib/sanitize');

test('normalizeSubmission accepts a well-formed payload', () => {
  const { valid, errors, data } = normalizeSubmission({
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '555-0100',
    message: 'Do you have availability next week?',
  });
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
  assert.equal(data.name, 'Jane Doe');
  assert.equal(data.email, 'jane@example.com');
  assert.equal(data.phone, '555-0100');
  assert.equal(data.message, 'Do you have availability next week?');
});

test('normalizeSubmission resolves field-name aliases across platforms', () => {
  const { valid, data } = normalizeSubmission({
    full_name: 'Alex Kim',
    contact_email: 'alex@example.com',
    inquiry: 'Interested in a quote.',
  });
  assert.equal(valid, true);
  assert.equal(data.name, 'Alex Kim');
  assert.equal(data.email, 'alex@example.com');
  assert.equal(data.message, 'Interested in a quote.');
});

test('normalizeSubmission rejects a payload missing email', () => {
  const { valid, errors } = normalizeSubmission({
    name: 'No Email Guy',
    message: 'hello',
  });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('email')));
});

test('normalizeSubmission rejects a malformed email address', () => {
  const { valid, errors } = normalizeSubmission({
    name: 'Bad Email',
    email: 'not-an-email',
    message: 'hello',
  });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('valid address')));
});

test('normalizeSubmission rejects non-object payloads', () => {
  const { valid, errors } = normalizeSubmission('not an object');
  assert.equal(valid, false);
  assert.ok(errors.length > 0);
});

test('normalizeSubmission rejects null payloads', () => {
  const { valid, errors } = normalizeSubmission(null);
  assert.equal(valid, false);
  assert.ok(errors.length > 0);
});

test('normalizeSubmission rejects payload with neither name nor message', () => {
  const { valid, errors } = normalizeSubmission({ email: 'jane@example.com' });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('name') || e.includes('message')));
});

test('normalizeSubmission preserves unknown fields as extras, capped in length', () => {
  const { data } = normalizeSubmission({
    name: 'Jane',
    email: 'jane@example.com',
    message: 'hi',
    preferred_appointment_date: '2026-07-01',
    nested: { should: 'be dropped' },
  });
  assert.equal(data.extra.preferred_appointment_date, '2026-07-01');
  assert.equal('nested' in data.extra, false);
});

test('normalizeSubmission strips control characters from free text', () => {
  const { data } = normalizeSubmission({
    name: 'Jane\x00\x01',
    email: 'jane@example.com',
    message: 'Line one\nLine two',
  });
  assert.equal(data.name, 'Jane');
  // Newlines are not control chars in the stripped set; they should survive.
  assert.equal(data.message, 'Line one\nLine two');
});

test('normalizeSubmission truncates oversized fields', () => {
  const longMessage = 'a'.repeat(10000);
  const { data } = normalizeSubmission({
    name: 'Jane',
    email: 'jane@example.com',
    message: longMessage,
  });
  assert.equal(data.message.length, 5000);
});

test('escapeHtml neutralizes script tags and quotes', () => {
  const escaped = escapeHtml('<script>alert("x")</script>');
  assert.equal(escaped.includes('<script>'), false);
  assert.ok(escaped.includes('&lt;script&gt;'));
});

test('escapeHtml handles null/undefined gracefully', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('cleanText trims and removes control characters', () => {
  assert.equal(cleanText('  hello  '), 'hello');
  assert.equal(cleanText('a\x07b'), 'ab');
  assert.equal(cleanText(null), '');
});
