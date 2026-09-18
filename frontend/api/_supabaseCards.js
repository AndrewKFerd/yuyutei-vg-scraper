// Shared by api/cards.js (Vercel Function, production) and vite.config.js's
// dev middleware (local `npm run dev`) -- one code path either way, so
// local testing actually exercises the same S3 call production makes.
//
// The bucket is deliberately private (not "public" storage) -- this is the
// only server-side path allowed to read it. Credentials live in
// SUPABASE_S3_* env vars (Vercel project settings in prod, .env.local
// locally) and are never sent to the browser.
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

let client = null

function getClient() {
  if (client) return client
  client = new S3Client({
    endpoint: process.env.SUPABASE_S3_ENDPOINT,
    region: process.env.SUPABASE_S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.SUPABASE_S3_SECRET_ACCESS_KEY,
    },
  })
  return client
}

/** Resolves to the cards.json object's readable body stream. */
export async function fetchCardsStream() {
  const result = await getClient().send(new GetObjectCommand({
    Bucket: process.env.SUPABASE_S3_BUCKET,
    Key: 'cards.json',
  }))
  return result.Body
}
