import { defineMiddleware } from 'astro:middleware';
import { isAuthed } from './lib/auth';

// Lindungi semua route admin kecuali halaman login & endpoint login.
const OPEN = ['/admin/login', '/api/admin/login'];

export const onRequest = defineMiddleware(async ({ url, cookies, redirect }, next) => {
  const p = url.pathname.replace(/\/$/, '') || '/';
  const isAdmin = p === '/admin' || p.startsWith('/admin/') || p.startsWith('/api/admin/');
  if (isAdmin && !OPEN.includes(p) && !(await isAuthed(cookies))) {
    if (p.startsWith('/api/')) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
    return redirect(`/admin/login?next=${encodeURIComponent(url.pathname)}`);
  }
  const res = await next();
  if (isAdmin) res.headers.set('cache-control', 'no-store');
  return res;
});
