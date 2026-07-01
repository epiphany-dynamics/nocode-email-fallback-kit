const test = require('node:test');
const assert = require('node:assert/strict');
const { handleSubmission } = require('../lib/handle-submission');

// These tests stub the global fetch used by lib/resend-client.js so no real
// network calls or API keys are needed to exercise the handler logic.

function stubFetch(implementation) {
  const original = global.fetch;
  global.fetch = implementation;
  return () => {
    global.fetch = original;
  };
}

const baseConfig = {
  resendApiKey: 'test_key',
  fromEmail: 'notifications@example.com',
  notifyEmail: 'owner@example.com',
  sourceLabel: 'Test form',
};

test('handleSubmission sends email and returns "sent" on success', async () => {
  const restore = stubFetch(async (url, opts) => {
    assert.equal(url, 'https://api.resend.com/emails');
    const body = JSON.parse(opts.body);
    assert.equal(body.from, baseConfig.fromEmail);
    assert.deepEqual(body.to, [baseConfig.notifyEmail]);
    assert.ok(body.subject.includes('Test form'));
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_123' }),
    };
  });

  try {
    const result = await handleSubmission(
      { name: 'Jane Doe', email: 'jane@example.com', message: 'hello' },
      baseConfig
    );
    assert.equal(result.outcome, 'sent');
    assert.equal(result.httpStatus, 200);
    assert.equal(result.emailId, 'email_123');
    assert.deepEqual(result.errors, []);
  } finally {
    restore();
  }
});

test('handleSubmission returns rejected_invalid (still HTTP 200) for a bad payload', async () => {
  const restore = stubFetch(async () => {
    throw new Error('fetch should not be called for invalid payloads');
  });

  try {
    const result = await handleSubmission({ foo: 'bar' }, baseConfig);
    assert.equal(result.outcome, 'rejected_invalid');
    assert.equal(result.httpStatus, 200);
    assert.ok(result.errors.length > 0);
  } finally {
    restore();
  }
});

test('handleSubmission returns send_failed with HTTP 502 when Resend errors', async () => {
  const restore = stubFetch(async () => ({
    ok: false,
    status: 422,
    statusText: 'Unprocessable Entity',
    json: async () => ({ message: 'Invalid `from` field' }),
  }));

  try {
    const result = await handleSubmission(
      { name: 'Jane Doe', email: 'jane@example.com', message: 'hello' },
      baseConfig
    );
    assert.equal(result.outcome, 'send_failed');
    assert.equal(result.httpStatus, 502);
    assert.ok(result.errors[0].includes('Invalid `from` field'));
  } finally {
    restore();
  }
});

test('handleSubmission surfaces network failures instead of throwing', async () => {
  const restore = stubFetch(async () => {
    throw new Error('getaddrinfo ENOTFOUND api.resend.com');
  });

  try {
    const result = await handleSubmission(
      { name: 'Jane Doe', email: 'jane@example.com', message: 'hello' },
      baseConfig
    );
    assert.equal(result.outcome, 'send_failed');
    assert.equal(result.httpStatus, 502);
    assert.ok(result.errors[0].includes('network error'));
  } finally {
    restore();
  }
});

test('handleSubmission enforces webhook secret when configured', async () => {
  const restore = stubFetch(async () => {
    throw new Error('fetch should not be called when unauthorized');
  });

  try {
    const result = await handleSubmission(
      { name: 'Jane Doe', email: 'jane@example.com', message: 'hello' },
      { ...baseConfig, webhookSecret: 'correct-secret', providedSecret: 'wrong-secret' }
    );
    assert.equal(result.outcome, 'unauthorized');
    assert.equal(result.httpStatus, 401);
  } finally {
    restore();
  }
});

test('handleSubmission allows request through with correct webhook secret', async () => {
  const restore = stubFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'email_456' }),
  }));

  try {
    const result = await handleSubmission(
      { name: 'Jane Doe', email: 'jane@example.com', message: 'hello' },
      { ...baseConfig, webhookSecret: 'correct-secret', providedSecret: 'correct-secret' }
    );
    assert.equal(result.outcome, 'sent');
  } finally {
    restore();
  }
});

test('handleSubmission sets reply-to to the submitter email', async () => {
  const restore = stubFetch(async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.reply_to, 'jane@example.com');
    return { ok: true, status: 200, json: async () => ({ id: 'email_789' }) };
  });

  try {
    await handleSubmission(
      { name: 'Jane Doe', email: 'jane@example.com', message: 'hello' },
      baseConfig
    );
  } finally {
    restore();
  }
});
