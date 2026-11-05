/**
 * POST /api/upload
 * Body: { image: "data:image/jpeg;base64,..." }
 * Uploads photo to Cloudflare R2 and returns a presigned download URL for QR scanning.
 */
import crypto from 'crypto';

const MAX_BYTES = 10 * 1024 * 1024; // 10MB limit

function hmac(key, string) {
  return crypto.createHmac('sha256', key).update(string).digest();
}

function sha256(string) {
  return crypto.createHash('sha256').update(string).digest('hex');
}

function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function uriEncodePath(path) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Uploads buffer to S3 / Cloudflare R2 with AWS SigV4
 */
async function uploadToR2({ host, bucket, region, accessKeyId, secretAccessKey, key, buffer, contentType }) {
  const payloadHash = sha256(buffer);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const method = 'PUT';
  const canonicalUri = `/${bucket}/${uriEncodePath(key)}`;
  const canonicalQuery = '';

  const headers = {
    'content-type': contentType,
    'host': host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join('');

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');

  const signingKey = getSigningKey(secretAccessKey, dateStamp, region, 's3');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method,
    headers: {
      ...headers,
      Authorization: authorization,
    },
    body: buffer,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`R2 upload failed: ${res.status} ${res.statusText} - ${errText}`);
  }

  return true;
}

/**
 * Generates an S3 presigned GET URL valid for 7 days (604,800 seconds)
 */
function getPresignedDownloadUrl({ host, bucket, region, accessKeyId, secretAccessKey, key, expiresInSeconds = 604800, downloadFilename = 'caricature.jpg' }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const method = 'GET';
  const canonicalUri = `/${bucket}/${uriEncodePath(key)}`;
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const credentialParam = `${accessKeyId}/${credentialScope}`;

  const queryParams = {
    'X-Amz-Algorithm': algorithm,
    'X-Amz-Credential': credentialParam,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expiresInSeconds.toString(),
    'X-Amz-SignedHeaders': 'host',
    'response-content-disposition': `inline; filename="${downloadFilename}"`,
  };

  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');

  const signingKey = getSigningKey(secretAccessKey, dateStamp, region, 's3');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const accountId = process.env.R2_ACCOUNT_ID || '6689d1626b5ab6e9f9e69e886af37e97';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || '7a2e4035dc55c467a657b319f855c288';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || 'b663ebac0872887e67b6b8edebf7c7a91906eeb52fef35fe6d03f50488ca86e3';
  const bucket = process.env.R2_BUCKET || 'ai-booth';
  const region = 'auto';
  const host = `${accountId}.r2.cloudflarestorage.com`;

  const image = req.body && req.body.image;
  const m = typeof image === 'string' && image.match(/^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: 'invalid_image' });

  const [, mime, b64] = m;
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length > MAX_BYTES) return res.status(413).json({ error: 'too_large' });

  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const filename = `caricature-${Date.now()}-${randomSuffix}.${ext}`;
  const key = `photos/${filename}`;

  try {
    await uploadToR2({
      host,
      bucket,
      region,
      accessKeyId,
      secretAccessKey,
      key,
      buffer,
      contentType: mime === 'image/png' ? 'image/png' : 'image/jpeg',
    });

    const downloadUrl = getPresignedDownloadUrl({
      host,
      bucket,
      region,
      accessKeyId,
      secretAccessKey,
      key,
      expiresInSeconds: 604800, // 7 days
      downloadFilename: `ejada-caricature.${ext}`,
    });

    return res.status(200).json({
      success: true,
      url: downloadUrl,
      key,
    });
  } catch (err) {
    console.error('R2 upload error:', err);
    return res.status(500).json({ error: 'upload_failed', message: err.message });
  }
}
