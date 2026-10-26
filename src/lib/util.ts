import type { Item, RequestItem, Auth, FolderItem } from './types';

export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'project';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function countRequests(items: Item[]): number {
  return items.reduce((n, it) => n + (it.kind === 'folder' ? countRequests(it.items) : 1), 0);
}

export type FlatRequest = RequestItem & { path: string[]; inheritedAuth: Auth };

/** Ratakan tree jadi list request + resolve auth "inherit" dari folder/collection. */
export function flatten(items: Item[], rootAuth: Auth, path: string[] = []): FlatRequest[] {
  const out: FlatRequest[] = [];
  for (const it of items) {
    if (it.kind === 'folder') {
      const a = it.auth?.type && it.auth.type !== 'inherit' ? it.auth : rootAuth;
      out.push(...flatten(it.items, a, [...path, it.name]));
    } else out.push({ ...it, path, inheritedAuth: rootAuth });
  }
  return out;
}

export function methodsSummary(items: Item[]): Record<string, number> {
  const m: Record<string, number> = {};
  const walk = (xs: Item[]) => xs.forEach((x) => (x.kind === 'folder' ? walk((x as FolderItem).items) : (m[x.method] = (m[x.method] ?? 0) + 1)));
  walk(items);
  return m;
}

export const PALETTE = ['#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2', '#64D2FF', '#FF375F', '#5E5CE6', '#FFD60A', '#AC8E68'];
