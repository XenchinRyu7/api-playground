import type { APIRoute } from 'astro';
import { checkPassword, createSession } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const { password } = await request.json();
    if (!password) {
      return new Response(JSON.stringify({ error: 'Password wajib diisi.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const valid = await checkPassword(password);
    if (!valid) {
      return new Response(JSON.stringify({ error: 'Password salah.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const isSecure = request.url.startsWith('https:');
    await createSession(cookies, isSecure);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Gagal login.';
    return new Response(JSON.stringify({ error }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
