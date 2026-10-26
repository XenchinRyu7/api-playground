import type { APIRoute } from 'astro';
import { detectAndImport } from '../../../lib/importers';

export const POST: APIRoute = async ({ request }) => {
  try {
    const raw = await request.text();
    if (!raw.trim()) {
      return new Response(JSON.stringify({ error: 'File/konten JSON kosong.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const detected = detectAndImport(raw);
    return new Response(JSON.stringify(detected), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Gagal memproses file.';
    return new Response(JSON.stringify({ error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
