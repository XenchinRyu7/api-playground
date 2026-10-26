import type { Project, ProjectMeta } from './types';

// Storage layer.
//  - Production (Vercel): Vercel Blob. Tiap simpan memakai random suffix lalu hapus versi lama,
//    sehingga tidak pernah kena cache CDN basi. Lokasi terbaru dicari via list() (tidak di-cache).
//  - Lokal tanpa BLOB_READ_WRITE_TOKEN: file JSON di ./.data/

export const env = (k: string): string | undefined => (globalThis as any).process?.env?.[k] ?? (import.meta.env as any)[k];

/** Cari token Vercel Blob secara fleksibel (BLOB_READ_WRITE_TOKEN atau prefix kustom dari Vercel) */
export function getBlobToken(): string | undefined {
  const direct = env('BLOB_READ_WRITE_TOKEN');
  if (direct) return direct;

  const envs: Record<string, string> = { ...((globalThis as any).process?.env || {}), ...(import.meta.env || {}) };
  for (const [k, v] of Object.entries(envs)) {
    if (typeof v === 'string') {
      if (v.startsWith('vercel_blob_rw_')) return v;
      if (k.endsWith('_READ_WRITE_TOKEN') || k.includes('BLOB_READ_WRITE')) return v;
    }
  }
  return undefined;
}

const useBlob = () => !!getBlobToken();
export const storageKind = () => (useBlob() ? 'Vercel Blob' : 'File lokal (.data/)');

const META_KEYS: (keyof ProjectMeta)[] = ['slug', 'name', 'tagline', 'description', 'tags', 'color', 'icon', 'published', 'featured', 'order', 'source', 'endpointCount', 'createdAt', 'updatedAt'];
export const toMeta = (p: Project): ProjectMeta => Object.fromEntries(META_KEYS.map((k) => [k, p[k]])) as ProjectMeta;

const sortMeta = (a: ProjectMeta, b: ProjectMeta) =>
  Number(b.featured) - Number(a.featured) || (a.order ?? 0) - (b.order ?? 0) || b.updatedAt.localeCompare(a.updatedAt);

/* ---------------- Vercel Blob ---------------- */
async function blob() { return import('@vercel/blob'); }

async function listAll(prefix: string) {
  const token = getBlobToken();
  const { list } = await blob();
  const out: { url: string; pathname: string; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  do {
    const r = await list({ prefix, cursor, limit: 1000, ...(token ? { token } : {}) });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}

const latest = <T extends { uploadedAt: Date }>(xs: T[]) => xs.sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt))[0];
const fetchJson = async (url: string) => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`Blob ${r.status}`); return r.json(); };

const blobStore = {
  async list(): Promise<ProjectMeta[]> {
    const blobs = await listAll('meta/');
    const bySlug = new Map<string, typeof blobs>();
    for (const b of blobs) { const s = b.pathname.split('/')[1]; (bySlug.get(s) ?? bySlug.set(s, []).get(s)!).push(b); }
    const metas = await Promise.all([...bySlug.values()].map((xs) => fetchJson(latest(xs).url).catch(() => null)));
    return metas.filter(Boolean);
  },
  async get(slug: string): Promise<Project | null> {
    const xs = await listAll(`projects/${slug}/`);
    return xs.length ? fetchJson(latest(xs).url) : null;
  },
  async save(p: Project) {
    const token = getBlobToken();
    const { put, del } = await blob();
    const opts = {
      access: 'public' as const,
      addRandomSuffix: true,
      contentType: 'application/json',
      cacheControlMaxAge: 60,
      ...(token ? { token } : {}),
    };
    const [old1, old2] = await Promise.all([listAll(`projects/${p.slug}/`), listAll(`meta/${p.slug}/`)]);
    await put(`projects/${p.slug}/data.json`, JSON.stringify(p), opts);
    await put(`meta/${p.slug}/meta.json`, JSON.stringify(toMeta(p)), opts);
    const stale = [...old1, ...old2].map((b) => b.url);
    if (stale.length) await del(stale, ...(token ? [{ token }] : []));
  },
  async remove(slug: string) {
    const token = getBlobToken();
    const { del } = await blob();
    const xs = [...(await listAll(`projects/${slug}/`)), ...(await listAll(`meta/${slug}/`))].map((b) => b.url);
    if (xs.length) await del(xs, ...(token ? [{ token }] : []));
  },
};

/* ---------------- File lokal ---------------- */
const DIR = '.data/projects';
const fsStore = {
  async fs() {
    if (env('VERCEL')) throw new Error('BLOB_READ_WRITE_TOKEN belum di-set. Hubungkan Vercel Blob store ke project ini (Storage → Blob → Connect).');
    const fs = await import('node:fs/promises');
    await fs.mkdir(DIR, { recursive: true });
    return fs;
  },
  async list(): Promise<ProjectMeta[]> {
    if (env('VERCEL')) return [];
    const fs = await this.fs();
    const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.json'));
    return Promise.all(files.map(async (f) => toMeta(JSON.parse(await fs.readFile(`${DIR}/${f}`, 'utf-8')))));
  },
  async get(slug: string): Promise<Project | null> {
    if (env('VERCEL')) return null;
    const fs = await this.fs();
    try { return JSON.parse(await fs.readFile(`${DIR}/${slug}.json`, 'utf-8')); } catch { return null; }
  },
  async save(p: Project) { const fs = await this.fs(); await fs.writeFile(`${DIR}/${p.slug}.json`, JSON.stringify(p, null, 2)); },
  async remove(slug: string) { const fs = await this.fs(); await fs.rm(`${DIR}/${slug}.json`, { force: true }); },
};

const store = () => (useBlob() ? blobStore : fsStore);

export const isValidSlug = (s: string) => /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(s);

export async function listProjects(opts: { includeDrafts?: boolean } = {}): Promise<ProjectMeta[]> {
  const all = (await store().list()).sort(sortMeta);
  return opts.includeDrafts ? all : all.filter((p) => p.published);
}
export async function getProject(slug: string) { return isValidSlug(slug) ? store().get(slug) : null; }
export async function saveProject(p: Project) {
  if (!isValidSlug(p.slug)) throw new Error('Slug tidak valid (huruf kecil, angka, tanda minus).');
  await store().save(p);
}
export async function deleteProject(slug: string) { if (isValidSlug(slug)) await store().remove(slug); }
