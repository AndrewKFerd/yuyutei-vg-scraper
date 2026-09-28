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
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

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

let client = null;

function getClient() {
  if (!client) {
    client = new S3Client({
      endpoint: requireEnv('SUPABASE_S3_ENDPOINT'),
      region: requireEnv('SUPABASE_S3_REGION'),
      // Supabase's S3-compatible endpoint needs path-style addressing
      // (endpoint/bucket/key), not virtual-hosted-style (bucket.endpoint/key).
      forcePathStyle: true,
      credentials: {
        accessKeyId: requireEnv('SUPABASE_S3_ACCESS_KEY_ID'),
        secretAccessKey: requireEnv('SUPABASE_S3_SECRET_ACCESS_KEY'),
      },
    });
  }
  return client;
}

/** Uploads a local file; resolves to { bucket, key, bytes }. Throws on any error. */
async function putFile(key, filePath, { contentType = 'application/json', cacheControl } = {}) {
  const bucket = getBucket();
  const body = fs.readFileSync(filePath);
  await getClient().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ...(cacheControl ? { CacheControl: cacheControl } : {}),
  }));
  return { bucket, key, bytes: body.length };
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
    const res = await getClient().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
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
  ENV_VARS,
  hasS3Env,
  getBucket,
  getClient,
  putFile,
  getObjectBuffer,
  headObjectSize,
  isMissingObject,
  isMissingHead,
};
