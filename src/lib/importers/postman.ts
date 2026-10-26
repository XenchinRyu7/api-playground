import type { Auth, Body, Example, FolderItem, ImportResult, Item, KV, Method, RequestItem } from '../types';
import { uid } from '../util';

// Postman Collection v2.0 & v2.1 → model internal.
// Referensi schema: https://schema.postman.com/collection/json/v2.1.0/draft-07/docs/index.html

const METHODS: Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const text = (d: any): string => (typeof d === 'string' ? d : d?.content ?? '');
const str = (v: any): string => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function kvList(arr: any): KV[] {
  if (typeof arr === 'string') {
    // v2.0 kadang menyimpan header sebagai string "Key: value\nKey2: value2"
    return arr.split(/\r?\n/).filter(Boolean).map((line) => {
      const i = line.indexOf(':');
      return { key: line.slice(0, i).trim(), value: line.slice(i + 1).trim(), enabled: true };
    });
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x && (x.key != null || x.name != null))
    .map((x) => ({
      key: str(x.key ?? x.name),
      value: str(x.value ?? x.src ?? ''),
      enabled: !x.disabled,
      ...(text(x.description) ? { description: text(x.description) } : {}),
      ...(x.type === 'file' ? { type: 'file' as const } : {}),
    }));
}

function pick(src: any, key: string): string {
  if (Array.isArray(src)) return str(src.find((x) => x?.key === key)?.value);
  return str(src?.[key]);
}

export function postmanAuth(a: any, warnings: string[] = []): Auth {
  if (!a) return { type: 'inherit' };
  switch (a.type) {
    case 'noauth': return { type: 'none' };
    case 'bearer': return { type: 'bearer', token: pick(a.bearer, 'token') };
    case 'basic': return { type: 'basic', username: pick(a.basic, 'username'), password: pick(a.basic, 'password') };
    case 'apikey': return {
      type: 'apikey', key: pick(a.apikey, 'key') || 'X-API-Key', value: pick(a.apikey, 'value'),
      in: pick(a.apikey, 'in') === 'query' ? 'query' : 'header',
    };
    case 'oauth2': {
      const t = pick(a.oauth2, 'accessToken');
      return { type: 'bearer', token: t || '{{token}}' };
    }
    default:
      warnings.push(`Auth "${a.type}" belum didukung, diganti "none".`);
      return { type: 'none' };
  }
}

function parseUrl(u: any) {
  let raw = '';
  if (typeof u === 'string') raw = u;
  else if (u) {
    raw = u.raw ?? '';
    if (!raw) {
      const host = Array.isArray(u.host) ? u.host.join('.') : u.host ?? '';
      const path = Array.isArray(u.path) ? u.path.join('/') : u.path ?? '';
      raw = `${u.protocol ? u.protocol + '://' : ''}${host}${u.port ? ':' + u.port : ''}/${path}`;
    }
  }
  const qi = raw.indexOf('?');
  const base = (qi >= 0 ? raw.slice(0, qi) : raw).split('#')[0];
  let query: KV[] = [];
  if (u && typeof u === 'object' && Array.isArray(u.query)) query = kvList(u.query);
  else if (qi >= 0) {
    query = raw.slice(qi + 1).split('#')[0].split('&').filter(Boolean).map((p) => {
      const [k, ...v] = p.split('=');
      return { key: decodeURIComponent(k), value: decodeURIComponent(v.join('=')), enabled: true };
    });
  }
  const pathVars: KV[] = u && typeof u === 'object' ? kvList(u.variable) : [];
  for (const m of base.matchAll(/\/:([A-Za-z_][\w-]*)/g))
    if (!pathVars.some((p) => p.key === m[1])) pathVars.push({ key: m[1], value: '', enabled: true });
  return { url: base, query, pathVars };
}

function parseBody(b: any, warnings: string[]): Body {
  if (!b || b.disabled) return { mode: 'none' };
  switch (b.mode) {
    case 'raw': {
      const raw = str(b.raw);
      const lang = b.options?.raw?.language;
      const t = raw.trim();
      if (lang === 'json' || (!lang && (t.startsWith('{') || t.startsWith('[')))) return { mode: 'json', raw };
      const ct = { xml: 'application/xml', html: 'text/html', javascript: 'application/javascript', text: 'text/plain' }[lang as string];
      return { mode: 'raw', raw, contentType: ct ?? 'text/plain' };
    }
    case 'urlencoded': return { mode: 'urlencoded', fields: kvList(b.urlencoded) };
    case 'formdata': return { mode: 'formdata', fields: kvList(b.formdata) };
    case 'graphql': return { mode: 'json', raw: JSON.stringify({ query: b.graphql?.query ?? '', variables: tryJson(b.graphql?.variables) ?? {} }, null, 2) };
    case 'file': warnings.push('Body bertipe "file" diabaikan.'); return { mode: 'none' };
    default: return { mode: 'none' };
  }
}

const tryJson = (s: any) => { if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch { return undefined; } };

function parseExamples(arr: any): Example[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((r) => ({
    name: r.name || `${r.code ?? ''} ${r.status ?? ''}`.trim() || 'Contoh',
    status: Number(r.code) || 0,
    statusText: r.status || '',
    headers: kvList(r.header),
    body: str(r.body),
  }));
}

function parseItems(items: any[], warnings: string[], counter: { n: number }): Item[] {
  return (items || []).map((it): Item => {
    if (Array.isArray(it.item)) {
      const f: FolderItem = {
        kind: 'folder', id: uid(), name: it.name || 'Folder', description: text(it.description),
        auth: postmanAuth(it.auth, warnings), items: parseItems(it.item, warnings, counter),
      };
      return f;
    }
    const req = typeof it.request === 'string' ? { url: it.request, method: 'GET' } : it.request || {};
    const method = String(req.method || 'GET').toUpperCase() as Method;
    if (!METHODS.includes(method)) warnings.push(`Method ${method} pada "${it.name}" tidak umum.`);
    const { url, query, pathVars } = parseUrl(req.url);
    counter.n++;
    const r: RequestItem = {
      kind: 'request', id: uid(), name: it.name || `${method} ${url}`, method, url,
      description: text(req.description ?? it.description),
      query, pathVars, headers: kvList(req.header), body: parseBody(req.body, warnings),
      auth: postmanAuth(req.auth, warnings), examples: parseExamples(it.response),
    };
    return r;
  });
}

export const isPostmanCollection = (j: any) =>
  !!j && typeof j === 'object' && (!!j.info?.schema?.includes?.('getpostman.com') || (!!j.info && Array.isArray(j.item)));

export const isPostmanEnvironment = (j: any) =>
  !!j && typeof j === 'object' && Array.isArray(j.values) && (j._postman_variable_scope === 'environment' || 'name' in j) && !j.item;

export function importPostman(col: any): ImportResult {
  const warnings: string[] = [];
  const counter = { n: 0 };
  const items = parseItems(col.item, warnings, counter);
  const auth = postmanAuth(col.auth, warnings);
  return {
    source: 'postman',
    name: col.info?.name || 'Untitled collection',
    description: text(col.info?.description),
    version: col.info?.version?.toString?.(),
    variables: kvList(col.variable),
    auth: auth.type === 'inherit' ? { type: 'none' } : auth,
    items,
    endpointCount: counter.n,
    warnings: [...new Set(warnings)],
  };
}

export function importPostmanEnvironment(env: any): KV[] {
  return (env.values || []).map((v: any) => ({ key: str(v.key), value: str(v.value), enabled: v.enabled !== false }));
}
