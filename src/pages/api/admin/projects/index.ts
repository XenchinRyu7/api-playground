import type { APIRoute } from 'astro';
import { listProjects, saveProject } from '../../../../lib/store';
import { buildProject } from '../../../../lib/project';
import { slugify } from '../../../../lib/util';
import type { ImportResult, Project } from '../../../../lib/types';

export const GET: APIRoute = async () => {
  try {
    const projects = await listProjects({ includeDrafts: true });
    return new Response(JSON.stringify(projects), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Gagal memuat project.';
    return new Response(JSON.stringify({ error }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { importResult, meta }: { importResult: ImportResult; meta: Partial<Project> & { slug?: string; name?: string } } = body;

    if (!importResult) {
      return new Response(JSON.stringify({ error: 'Data hasil import dibutuhkan.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rawSlug = meta?.slug || slugify(meta?.name || importResult.name);
    const slug = slugify(rawSlug);

    const project = buildProject(importResult, {
      ...meta,
      slug,
      name: meta?.name || importResult.name,
    });

    await saveProject(project);

    return new Response(JSON.stringify({ success: true, project }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Gagal menyimpan project.';
    return new Response(JSON.stringify({ error }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
