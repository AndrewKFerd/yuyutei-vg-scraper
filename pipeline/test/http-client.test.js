'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { fetchWithTimeout } = require('../http-client');

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('fetchWithTimeout rejects with a clear, retryable Error when the server never answers', async () => {
  // Accepts the request and never replies: what a connection that died
  // silently looks like from the client's side.
  const server = await listen(() => {});
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    await assert.rejects(fetchWithTimeout(url, {}, 100), (err) => {
      assert.equal(err.name, 'Error'); // plain Error: the scrapers' retry loops treat it like any network failure
      assert.match(err.message, /timed out after/);
      return true;
    });
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('fetchWithTimeout passes a prompt response through untouched', async () => {
  const server = await listen((req, res) => res.end('ok'));
  try {
    const res = await fetchWithTimeout(`http://127.0.0.1:${server.address().port}/`, {}, 2000);
    assert.equal(await res.text(), 'ok');
  } finally {
    server.close();
  }
});
