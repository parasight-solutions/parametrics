// apps/api/src/lib/crypto.js
import crypto from 'crypto';

const ALG = 'aes-256-gcm';
const SALT = Buffer.from('parametrics-v1'); // static salt for scrypt derivation

const RAW = process.env.APP_ENC_KEY || process.env.ENCRYPTION_KEY || '';
if (!RAW) {
  throw new Error('APP_ENC_KEY (or ENCRYPTION_KEY) is required in apps/api/.env');
}

function materializeKey() {
  // Try Base64
  try {
    const b64 = Buffer.from(RAW, 'base64');
    if (b64.length === 32) return b64;
  } catch {}

  // Try hex (64 hex chars = 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(RAW)) {
    return Buffer.from(RAW, 'hex');
  }

  // Fallback: derive 32-byte key from passphrase using scrypt
  return crypto.scryptSync(RAW, SALT, 32);
}

const KEY = materializeKey();

export function encJson(obj) {
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALG, KEY, iv);
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  // [iv(12) | tag(16) | ciphertext]
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decJson(payload) {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALG, KEY, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}
