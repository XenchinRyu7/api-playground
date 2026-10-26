import type { ImportResult, Item, Project } from './types';
import { importOpenAPI } from './importers/openapi';
import { importPostman } from './importers/postman';
import { PALETTE, slugify } from './util';
import openapi from '../data/demo-openapi.json';
import postman from '../data/demo-postman.json';

/** Id yang stabil & mudah dibaca untuk deep link (#list-posts). */
export function assignIds(items: Item[], used = new Set<string>()): Item[] {
  const take = (base: string) => { let id = base, n = 2; while (used.has(id)) id = `${base}-${n++}`; used.add(id); return id; };
  for (const it of items) {
    if (it.kind === 'folder') { it.id = take('f-' + slugify(it.name)); assignIds(it.items, used); }
    else it.id = take(slugify(it.name || `${it.method} ${it.url}`));
  }
  return items;
}

/** Gabungkan hasil import + metadata jadi Project utuh. */
export function buildProject(r: ImportResult, meta: Partial<Project> & { slug: string }): Project {
  const now = new Date().toISOString();
  return {
    name: r.name,
    tagline: r.description.split('\n')[0].replace(/[*_`#]/g, '').slice(0, 120),
    description: r.description,
    tags: [],
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    icon: 'code',
    published: true,
    featured: false,
    order: 0,
    createdAt: now,
    ...meta,
    source: r.source,
    endpointCount: r.endpointCount,
    variables: meta.variables ?? r.variables,
    auth: r.auth,
    items: assignIds(r.items),
    updatedAt: now,
  };
}

/** Project contoh — tampil di publik selama belum ada project yang dipublish. */
export function demoProjects(): Project[] {
  return [
    { ...buildProject(importOpenAPI(openapi), { slug: 'dummyjson', icon: 'cart', color: '#FF9F0A', tags: ['rest', 'auth', 'e-commerce'], tagline: 'Mock REST API: auth JWT, user, produk.', featured: true }), demo: true },
    { ...buildProject(importPostman(postman), { slug: 'jsonplaceholder', icon: 'api', color: '#0A84FF', tags: ['rest', 'crud', 'postman'], tagline: 'Fake REST API untuk CRUD posts, users, comments.' }), demo: true },
  ];
}
