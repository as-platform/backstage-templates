import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer, request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createHandler } from './server.mjs';

describe('static server', () => {
  let base;
  let server;
  let port;

  const call = (method, target) =>
    new Promise((resolve, reject) => {
      const req = request({ port, method, path: target }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
      req.end();
    });

  before(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'static-'));
    const dist = path.join(base, 'dist');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
    fs.writeFileSync(path.join(dist, 'assets', 'app.abc123.js'), 'console.log(1);');
    fs.writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *');
    fs.writeFileSync(path.join(base, 'secret.txt'), 'top secret');
    server = createServer(createHandler(dist));
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('serves index.html at the root without caching it', async () => {
    const response = await call('GET', '/');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /^text\/html/);
    assert.equal(response.headers['cache-control'], 'no-cache');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.match(response.body, /<title>app<\/title>/);
  });

  it('falls back to index.html for client routes', async () => {
    const response = await call('GET', '/orders/42?tab=1');
    assert.equal(response.status, 200);
    assert.match(response.body, /<title>app<\/title>/);
  });

  it('serves hashed assets as immutable', async () => {
    const response = await call('GET', '/assets/app.abc123.js');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /^text\/javascript/);
    assert.match(response.headers['cache-control'], /immutable/);
  });

  it('serves other files with their own content type', async () => {
    const response = await call('GET', '/robots.txt');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /^text\/plain/);
    assert.equal(response.body, 'User-agent: *');
  });

  it('returns 404 for a missing file with an extension', async () => {
    assert.equal((await call('GET', '/missing.js')).status, 404);
  });

  it('answers the probes outside the client routes', async () => {
    for (const probe of ['/healthz', '/readyz']) {
      const response = await call('GET', probe);
      assert.equal(response.status, 200);
      assert.equal(response.body, 'ok\n');
    }
  });

  it('answers HEAD without a body', async () => {
    const response = await call('HEAD', '/');
    assert.equal(response.status, 200);
    assert.equal(response.body, '');
    assert.ok(Number(response.headers['content-length']) > 0);
  });

  it('rejects other methods with 405', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const response = await call(method, '/');
      assert.equal(response.status, 405);
      assert.equal(response.headers.allow, 'GET, HEAD');
    }
  });

  it('does not serve files outside the build directory', async () => {
    for (const target of ['/..%2fsecret.txt', '/%2e%2e/secret.txt', '/..%2f..%2fetc%2fpasswd', '/assets/..%2f..%2fsecret.txt']) {
      const response = await call('GET', target);
      assert.notEqual(response.status, 200, target);
      assert.doesNotMatch(response.body, /top secret|root:/, target);
    }
  });

  it('rejects a malformed path with 400', async () => {
    assert.equal((await call('GET', '/%E0%A4%A')).status, 400);
  });
});
