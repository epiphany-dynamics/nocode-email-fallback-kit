const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyResendWebhookSignature } = require('./verify-signature');

function sign(secretBase64, svixId, svixTimestamp, payload) {
  const secretBytes = Buffer.from(secretBase64, 'base64');
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return `v1,${sig}`;
}

test('verifyResendWebhookSignature accepts a correctly signed payload', () => {
  const secretBase64 = 'dGVzdHNlY3JldGtleWJ5dGVz'; // arbitrary base64 bytes
  const secret = `whsec_${secretBase64}`;
  const payload = JSON.stringify({ type: 'email.delivered' });
  const svixId = 'msg_123';
  const svixTimestamp = String(Math.floor(Date.now() / 1000));
  const svixSignature = sign(secretBase64, svixId, svixTimestamp, payload);

  const result = verifyResendWebhookSignature({
    payload,
    svixId,
    svixTimestamp,
    svixSignature,
    secret,
  });

  assert.equal(result.valid, true);
});

test('verifyResendWebhookSignature rejects a tampered payload', () => {
  const secretBase64 = 'dGVzdHNlY3JldGtleWJ5dGVz';
  const secret = `whsec_${secretBase64}`;
  const originalPayload = JSON.stringify({ type: 'email.delivered' });
  const svixId = 'msg_123';
  const svixTimestamp = String(Math.floor(Date.now() / 1000));
  const svixSignature = sign(secretBase64, svixId, svixTimestamp, originalPayload);

  const tamperedPayload = JSON.stringify({ type: 'email.bounced' });

  const result = verifyResendWebhookSignature({
    payload: tamperedPayload,
    svixId,
    svixTimestamp,
    svixSignature,
    secret,
  });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'signature mismatch');
});

test('verifyResendWebhookSignature rejects an old timestamp (replay protection)', () => {
  const secretBase64 = 'dGVzdHNlY3JldGtleWJ5dGVz';
  const secret = `whsec_${secretBase64}`;
  const payload = JSON.stringify({ type: 'email.delivered' });
  const svixId = 'msg_123';
  const oldTimestamp = String(Math.floor(Date.now() / 1000) - 3600); // 1 hour old
  const svixSignature = sign(secretBase64, svixId, oldTimestamp, payload);

  const result = verifyResendWebhookSignature({
    payload,
    svixId,
    svixTimestamp: oldTimestamp,
    svixSignature,
    secret,
  });

  assert.equal(result.valid, false);
  assert.ok(result.reason.includes('tolerance'));
});

test('verifyResendWebhookSignature rejects missing headers', () => {
  const result = verifyResendWebhookSignature({
    payload: '{}',
    svixId: '',
    svixTimestamp: '',
    svixSignature: '',
    secret: 'whsec_abc',
  });
  assert.equal(result.valid, false);
  assert.ok(result.reason.includes('missing'));
});

test('verifyResendWebhookSignature rejects when no secret configured', () => {
  const result = verifyResendWebhookSignature({
    payload: '{}',
    svixId: 'msg_1',
    svixTimestamp: String(Math.floor(Date.now() / 1000)),
    svixSignature: 'v1,abc',
    secret: '',
  });
  assert.equal(result.valid, false);
  assert.ok(result.reason.includes('secret'));
});
