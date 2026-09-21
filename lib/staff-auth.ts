import { env } from 'cloudflare:workers';

const cookieName = 'rabotec_staff';
const encoder = new TextEncoder();
const ttlSeconds = 60 * 60 * 24 * 7;

function config() {
  const settings = env as unknown as Record<string, string | undefined>;
  const passwordHash = settings.FLEET_ACCESS_PASSWORD_HASH;
  const sessionSecret = settings.FLEET_SESSION_SECRET;
  if (!passwordHash || !sessionSecret) return null;
  const [salt, hash] = passwordHash.split(':');
  if (!salt || !hash || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{64}$/.test(hash)) return null;
  return { salt, hash, sessionSecret };
}

export function staffAuthConfigured() { return config() !== null; }

function hex(bytes: Uint8Array) { return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(''); }

async function derive(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100_000, hash: 'SHA-256' }, key, 256);
  return hex(new Uint8Array(bits));
}

function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function verifyPassword(password: string) {
  const settings = config();
  if (!settings || password.length > 256) return false;
  return equal(await derive(password, settings.salt), settings.hash);
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

export async function sessionCookie() {
  const settings = config();
  if (!settings) throw new Error('Staff access is not configured');
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const value = `v1.${expiry}.${await sign(`v1.${expiry}`, settings.sessionSecret)}`;
  return `${cookieName}=${value}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export async function hasStaffSession(request: Request) {
  const settings = config();
  if (!settings) return false;
  const match = request.headers.get('cookie')?.match(/(?:^|;\s*)rabotec_staff=([^;]+)/);
  const parts = match?.[1]?.split('.');
  if (!parts || parts.length !== 3 || parts[0] !== 'v1') return false;
  const expiry = Number(parts[1]);
  if (!Number.isSafeInteger(expiry) || expiry < Date.now() / 1000) return false;
  return equal(parts[2], await sign(`v1.${expiry}`, settings.sessionSecret));
}

export const clearSessionCookie = `${cookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
