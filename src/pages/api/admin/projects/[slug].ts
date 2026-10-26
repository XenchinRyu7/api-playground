import type { APIRoute } from 'astro';
import { getProject, saveProject, deleteProject } from '../../../../lib/store';
import type { Project } from '../../../../lib/types';

export const GET: APIRoute = async ({ params }) => {
  const { slug } = params;
  if (!slug) return new Response(JSON.stringify({ error: 'Slug tidak ada' }), { status: 400 });

  const project = await getProject(slug);
  if (!project) return new Response(JSON.stringify({ error: 'Project tidak ditemukan' }), { status: 404 });

  return new Response(JSON.stringify(project), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const PUT: APIRoute = async ({ params, request }) => {
  const { slug } = params;
  if (!slug) return new Response(JSON.stringify({ error: 'Slug tidak ada' }), { status: 400 });

  try {
    const existing = await getProject(slug);
    if (!existing) return new Response(JSON.stringify({ error: 'Project tidak ditemukan' }), { status: 404 });

    const updates = await request.json();
    const updated: Project = {
      ...existing,
      ...updates,
      slug: existing.slug, // slug cannot be altered here
      updatedAt: new Date().toISOString(),
    };

    await saveProject(updated);

    return new Response(JSON.stringify({ success: true, project: updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Gagal memperbarui project.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  const { slug } = params;
  if (!slug) return new Response(JSON.stringify({ error: 'Slug tidak ada' }), { status: 400 });

  try {
    await deleteProject(slug);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Gagal menghapus project.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
