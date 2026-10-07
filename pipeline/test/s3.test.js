'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_S3_ENDPOINT = 'http://127.0.0.1:9';
process.env.SUPABASE_S3_REGION = 'test';
process.env.SUPABASE_S3_BUCKET = 'bucket';
process.env.SUPABASE_S3_ACCESS_KEY_ID = 'a';
process.env.SUPABASE_S3_SECRET_ACCESS_KEY = 'b';

const s3 = require('../s3');

describe('S3 client timeouts', () => {
  it('builds the client with a request handler carrying the timeouts', async () => {
    const handler = s3.getClient().config.requestHandler;
    const cfg = await handler.configProvider;
    assert.equal(cfg.connectionTimeout, s3.S3_CONNECTION_TIMEOUT_MS);
    assert.equal(cfg.socketTimeout, s3.S3_SOCKET_TIMEOUT_MS);
    assert.equal(cfg.requestTimeout, s3.S3_REQUEST_TIMEOUT_MS);
    // Without this the wall-clock cap only logs a warning.
    assert.equal(cfg.throwOnRequestTimeout, true);
  });

  it('does not send Expect: 100-continue for large bodies', async () => {
    const cfg = s3.getClient().config;
    const value = typeof cfg.expectContinueHeader === 'function' ? await cfg.expectContinueHeader() : cfg.expectContinueHeader;
    assert.equal(value, false);
  });

  it('listObjects follows pagination and strips the ETag quotes', async () => {
    const client = s3.getClient();
    const realSend = client.send;
    const seen = [];
    client.send = async (command) => {
      seen.push(command.input.ContinuationToken);
      return command.input.ContinuationToken
        ? { Contents: [{ Key: 'details/b.json', ETag: '"bb"', Size: 2 }], IsTruncated: false }
        : { Contents: [{ Key: 'details/a.json', ETag: '"aa"', Size: 1 }], IsTruncated: true, NextContinuationToken: 'tok' };
    };
    try {
      const found = await s3.listObjects('details/');
      assert.deepEqual([...found.keys()], ['details/a.json', 'details/b.json']);
      assert.equal(found.get('details/b.json').etag, 'bb');
      assert.deepEqual(seen, [undefined, 'tok']);
    } finally {
      client.send = realSend;
    }
  });

  it('leaves room for a 30 MB upload on a slow link', () => {
    // 30 MB within the wall-clock cap needs >= ~35 KB/s; the idle timeout never cuts a moving transfer.
    assert.ok(30 * 1024 * 1024 / (s3.S3_REQUEST_TIMEOUT_MS / 1000) < 40 * 1024);
    assert.ok(s3.S3_SOCKET_TIMEOUT_MS >= 60 * 1000);
  });
});
