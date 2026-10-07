'use strict';

/**
 * Shared client for the private Supabase Storage bucket (via its
 * S3-compatible endpoint), used by upload-cards.js to publish the built
 * files, by record-history.js to restore price-history.json when the local
 * copy is missing, and by upload-cards.js/backfill-history.js to check the
 * bucket's copy before anything could overwrite it.
 *
 * Requires SUPABASE_S3_* vars (see .env.example) -- load with
 * `node --env-file=.env <script>`.
 */

const fs = require('fs');
const { NodeHttpHandler } = require('@smithy/node-http-handler'); // the SDK's own transport (already installed with client-s3)
const {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const ENV_VARS = [
  'SUPABASE_S3_ENDPOINT',
  'SUPABASE_S3_REGION',
  'SUPABASE_S3_BUCKET',
  'SUPABASE_S3_ACCESS_KEY_ID',
  'SUPABASE_S3_SECRET_ACCESS_KEY',
];

function hasS3Env(env = process.env) {
  return ENV_VARS.every((name) => Boolean(env[name]));
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see pipeline/.env.example)`);
  return value;
}

function getBucket() {
  return requireEnv('SUPABASE_S3_BUCKET');
}

// Deadlines for the S3 calls. The SDK's defaults are "wait forever", so a
// connection that dies silently (sleep, dropped Wi-Fi) would hang the run
// like the cf-vanguard one did. With @smithy/node-http-handler:
//  - connectionTimeout: establishing the TCP/TLS connection.
//  - socketTimeout: the socket sitting idle (no bytes either way) -- this is
//    the one that catches a dead link, and it never cuts a transfer that is
//    making progress, so the ~30 MB cards.json upload is fine.
//  - requestTimeout: a wall-clock cap on the whole request. By default it
//    only logs a warning; throwOnRequestTimeout makes it an error. Sized at
//    15 min so a 30 MB upload would still finish at ~35 KB/s.
// The handler's timers stop once response headers arrive, so reads of a
// response body pass an AbortSignal instead (see getObjectBuffer).
const S3_CONNECTION_TIMEOUT_MS = 15 * 1000;
const S3_SOCKET_TIMEOUT_MS = 120 * 1000;
const S3_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const S3_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;

let client = null;

function getClient() {
  if (!client) {
    client = new S3Client({
      endpoint: requireEnv('SUPABASE_S3_ENDPOINT'),
      region: requireEnv('SUPABASE_S3_REGION'),
      // Supabase's S3-compatible endpoint needs path-style addressing
      // (endpoint/bucket/key), not virtual-hosted-style (bucket.endpoint/key).
      forcePathStyle: true,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
        socketTimeout: S3_SOCKET_TIMEOUT_MS,
        requestTimeout: S3_REQUEST_TIMEOUT_MS,
        throwOnRequestTimeout: true,
      }),
      credentials: {
        accessKeyId: requireEnv('SUPABASE_S3_ACCESS_KEY_ID'),
        secretAccessKey: requireEnv('SUPABASE_S3_SECRET_ACCESS_KEY'),
      },
    });
  }
  return client;
}

/**
 * Uploads a local file; resolves to { bucket, key, bytes, etag }. Throws on
 * any error. The body goes up in one PutObject (never multipart), so for a
 * store that follows S3 the returned ETag is the MD5 of the content.
 */
async function putFile(key, filePath, { contentType = 'application/json', cacheControl } = {}) {
  const bucket = getBucket();
  const body = fs.readFileSync(filePath);
  const res = await getClient().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ...(cacheControl ? { CacheControl: cacheControl } : {}),
  }));
  return { bucket, key, bytes: body.length, etag: res?.ETag ?? null };
}

/** An ETag without its quotes (S3 returns them quoted), or null. */
function normalizeEtag(etag) {
  return typeof etag === 'string' ? etag.replace(/^"|"$/g, '') : null;
}

/** Every object under `prefix` as Map key -> { etag, size }; follows pagination. */
async function listObjects(prefix) {
  const bucket = getBucket();
  const found = new Map();
  let token;
  do {
    const res = await getClient().send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
      { abortSignal: AbortSignal.timeout(S3_DOWNLOAD_TIMEOUT_MS) }
    );
    for (const obj of res.Contents || []) found.set(obj.Key, { etag: normalizeEtag(obj.ETag), size: obj.Size });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return found;
}

/** Deletes one object (a missing one is not an error, as in S3). */
async function deleteObject(key) {
  await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }), {
    abortSignal: AbortSignal.timeout(S3_DOWNLOAD_TIMEOUT_MS),
  });
}

// GET: only NoSuchKey means "no such object". Any other 404 (a missing
// bucket, a wrong endpoint path) is a misconfiguration, and treating it as
// "no remote history" would invite starting a fresh one over the real copy.
function isMissingObject(err) {
  return Boolean(err) && (err.name === 'NoSuchKey' || err.Code === 'NoSuchKey');
}

// HEAD responses have no body, so the SDK can't read an error code from
// them: a missing object surfaces as a bare 'NotFound' / HTTP 404.
function isMissingHead(err) {
  return Boolean(err) && (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404);
}

/** Downloads an object; resolves to a Buffer, or null if the object doesn't exist. Other errors throw. */
async function getObjectBuffer(key) {
  const bucket = getBucket();
  try {
    const res = await getClient().send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(S3_DOWNLOAD_TIMEOUT_MS),
    });
    return Buffer.from(await res.Body.transformToByteArray());
  } catch (err) {
    if (isMissingObject(err)) return null;
    throw err;
  }
}

/** Resolves to an object's size in bytes (HEAD), or null if it doesn't exist. Other errors throw. */
async function headObjectSize(key) {
  const bucket = getBucket();
  try {
    const res = await getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return res.ContentLength;
  } catch (err) {
    if (isMissingHead(err)) return null;
    throw err;
  }
}

module.exports = {
  S3_CONNECTION_TIMEOUT_MS,
  S3_SOCKET_TIMEOUT_MS,
  S3_REQUEST_TIMEOUT_MS,
  ENV_VARS,
  hasS3Env,
  getBucket,
  getClient,
  putFile,
  normalizeEtag,
  listObjects,
  deleteObject,
  getObjectBuffer,
  headObjectSize,
  isMissingObject,
  isMissingHead,
};
