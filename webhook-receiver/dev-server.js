/**
 * Minimal local dev server for the webhook receiver, using only Node's
 * built-in `http` module (no Express dependency) so the runtime-agnostic
 * handler in `api/webhook.js` can be exercised locally with
 * `npm run dev`, then pointed at from a no-code platform's webhook tester
 * (or `curl`) during development, before deploying to Vercel/Cloudflare.
 */
const http = require('http');
const webhookHandler = require('./api/webhook');

const PORT = process.env.PORT || 3000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname !== '/api/webhook') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found, POST to /api/webhook' }));
    return;
  }

  const rawBody = await readBody(req);

  const reqShim = {
    method: req.method,
    headers: req.headers,
    query: Object.fromEntries(url.searchParams.entries()),
    body: rawBody,
  };

  const resShim = {
    _status: 200,
    status(code) {
      this._status = code;
      return this;
    },
    json(payload) {
      res.writeHead(this._status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload, null, 2));
    },
  };

  try {
    await webhookHandler(reqShim, resShim);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('unhandled error in webhook handler:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal error' }));
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`webhook-receiver dev server listening on http://localhost:${PORT}/api/webhook`);
  // eslint-disable-next-line no-console
  console.log('Try:');
  // eslint-disable-next-line no-console
  console.log(
    `  curl -X POST http://localhost:${PORT}/api/webhook -H "Content-Type: application/json" -d '{"name":"Jane Doe","email":"jane@example.com","message":"Do you have availability next week?"}'`
  );
});
