import type { AstroCookies } from 'astro';
import { env } from './store';

// Sesi admin: cookie HttpOnly berisi "<expiry>.<hmac>". Tanpa database.

export const COOKIE = 'apg_session';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 hari
const enc = new TextEncoder();

function secret() {
  const s = env('SESSION_SECRET') || (env('VERCEL') ? '' : 'dev-secret-change-me-dev-secret-change-me');
  if (!s) throw new Error('SESSION_SECRET belum di-set.');
  return s;
}

async function hmac(data: string, key = secret()) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const adminConfigured = () => !!env('ADMIN_PASSWORD');

export async function checkPassword(input: string) {
  const pw = env('ADMIN_PASSWORD');
  if (!pw) return false;
  // bandingkan HMAC agar waktu perbandingan tidak bergantung panjang password
  return safeEqual(await hmac(input, 'pw'), await hmac(pw, 'pw'));
}

export async function createSession(cookies: AstroCookies, secure: boolean) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  cookies.set(COOKIE, `${exp}.${await hmac(String(exp))}`, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: MAX_AGE });
}

export async function isAuthed(cookies: AstroCookies) {
  const v = cookies.get(COOKIE)?.value;
  if (!v) return false;
  const [exp, sig] = v.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  try { return safeEqual(sig, await hmac(exp)); } catch { return false; }
}

export const destroySession = (cookies: AstroCookies) => cookies.delete(COOKIE, { path: '/' });
