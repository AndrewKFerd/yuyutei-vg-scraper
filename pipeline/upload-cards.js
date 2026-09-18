'use strict';

/**
 * Uploads the built pipeline/data/cards.json to a private Supabase Storage
 * bucket (via its S3-compatible endpoint). The frontend never talks to
 * Supabase directly -- it fetches through api/cards.js, a Vercel Function
 * that proxies this same bucket with its own credentials. Run this after
 * build-data.js.
 *
 * Requires SUPABASE_S3_* vars (see .env.example) — load with
 * `node --env-file=.env upload-cards.js`.
 */

const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const CARDS_PATH = path.join(__dirname, 'data', 'cards.json');
const OBJECT_KEY = 'cards.json';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see pipeline/.env.example)`);
  return value;
}

async function main() {
  const endpoint = requireEnv('SUPABASE_S3_ENDPOINT');
  const region = requireEnv('SUPABASE_S3_REGION');
  const bucket = requireEnv('SUPABASE_S3_BUCKET');
  const accessKeyId = requireEnv('SUPABASE_S3_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('SUPABASE_S3_SECRET_ACCESS_KEY');

  const body = fs.readFileSync(CARDS_PATH);

  const client = new S3Client({
    endpoint,
    region,
    // Supabase's S3-compatible endpoint needs path-style addressing
    // (endpoint/bucket/key), not virtual-hosted-style (bucket.endpoint/key).
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: OBJECT_KEY,
    Body: body,
    ContentType: 'application/json',
    CacheControl: 'public, max-age=0, must-revalidate',
  }));

  console.log(`Uploaded ${(body.length / (1024 * 1024)).toFixed(2)} MB to s3://${bucket}/${OBJECT_KEY}`);
}

main().catch((err) => {
  console.error('[upload-cards] Failed:', err.message);
  process.exit(1);
});
