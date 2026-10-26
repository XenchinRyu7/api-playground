import type { Auth, Body, Example, FolderItem, ImportResult, Item, KV, Method, RequestItem } from '../types';
import { uid } from '../util';

// OpenAPI 3.x & Swagger 2.0 (JSON) → model internal.

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;
const str = (v: any) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function makeDeref(root: any) {
  return function deref(o: any, seen = new Set<string>()): any {
    if (!o || typeof o !== 'object' || typeof o.$ref !== 'string') return o;
    if (seen.has(o.$ref) || !o.$ref.startsWith('#/')) return {};
    seen.add(o.$ref);
    const target = o.$ref.slice(2).split('/').map((k: string) => k.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce((a: any, k: string) => a?.[k], root);
    return deref(target, seen);
  };
}

function sampler(deref: (o: any) => any) {
  return function example(schema: any, depth = 0): any {
    schema = deref(schema);
    if (!schema || depth > 6) return null;
    if (schema.example !== undefined) return schema.example;
    if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
    if (schema.default !== undefined) return schema.default;
    if (schema.enum?.length) return schema.enum[0];
    if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s: any) => example(s, depth + 1)).filter((x: any) => x && typeof x === 'object'));
    if (schema.oneOf || schema.anyOf) return example((schema.oneOf || schema.anyOf)[0], depth + 1);
    const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== 'null') : schema.type ?? (schema.properties ? 'object' : undefined);
    switch (type) {
      case 'object': {
        const o: Record<string, any> = {};
        for (const [k, v] of Object.entries(schema.properties || {})) o[k] = example(v, depth + 1);
        return o;
      }
      case 'array': return [example(schema.items, depth + 1)];
      case 'integer': case 'number': return schema.minimum ?? 0;
      case 'boolean': return true;
      case 'string': return ({ 'date-time': new Date(0).toISOString(), date: '2024-01-01', email: 'user@example.com', uuid: '00000000-0000-0000-0000-000000000000', uri: 'https://example.com', password: '********', binary: '' } as any)[schema.format] ?? 'string';
      default: return null;
    }
  };
}

function schemeToAuth(s: any, name: string): Auth {
  if (!s) {
    // Skema tidak didefinisikan: tebak dari nama
    if (/bearer|jwt|token|oauth/i.test(name)) return { type: 'bearer', token: '{{token}}' };
    if (/basic/i.test(name)) return { type: 'basic', username: '{{username}}', password: '{{password}}' };
    if (/key/i.test(name)) return { type: 'apikey', key: 'X-API-Key', value: '{{apiKey}}', in: 'header' };
    return { type: 'bearer', token: '{{token}}' };
  }
  const t = String(s.type).toLowerCase();
  if (t === 'http' && /basic/i.test(s.scheme)) return { type: 'basic', username: '{{username}}', password: '{{password}}' };
  if (t === 'basic') return { type: 'basic', username: '{{username}}', password: '{{password}}' };
  if (t === 'apikey') return { type: 'apikey', key: s.name || 'X-API-Key', value: '{{apiKey}}', in: s.in === 'query' ? 'query' : 'header' };
  return { type: 'bearer', token: '{{token}}' }; // http bearer, oauth2, openIdConnect
}

export const isOpenAPI = (j: any) => !!j && typeof j === 'object' && (typeof j.openapi === 'string' || j.swagger === '2.0') && !!j.paths;

export function importOpenAPI(spec: any): ImportResult {
  const warnings: string[] = [];
  const v2 = spec.swagger === '2.0';
  const deref = makeDeref(spec);
  const example = sampler(deref);

  // Base URL
  let baseUrl = '';
  if (v2) baseUrl = spec.host ? `${spec.schemes?.[0] ?? 'https'}://${spec.host}${spec.basePath ?? ''}` : spec.basePath ?? '';
  else {
    const srv = spec.servers?.[0];
    if (srv) baseUrl = String(srv.url).replace(/\{(\w+)\}/g, (_: string, k: string) => srv.variables?.[k]?.default ?? k);
  }
  baseUrl = baseUrl.replace(/\/$/, '');
  if (!baseUrl) warnings.push('Spec tidak punya server/host — isi variabel baseUrl setelah import.');

  const schemes = v2 ? spec.securityDefinitions ?? {} : spec.components?.securitySchemes ?? {};
  const secToAuth = (sec: any[] | undefined): Auth | undefined => {
    if (sec === undefined) return undefined;
    if (!sec.length || !Object.keys(sec[0] || {}).length) return { type: 'none' };
    const name = Object.keys(sec[0])[0];
    if (!schemes[name]) warnings.push(`Security scheme "${name}" tidak didefinisikan, ditebak otomatis.`);
    return schemeToAuth(deref(schemes[name]), name);
  };
  const rootAuth = secToAuth(spec.security) ?? { type: 'none' };

  const folders = new Map<string, FolderItem>();
  const tagDesc = Object.fromEntries((spec.tags || []).map((t: any) => [t.name, t.description || '']));
  (spec.tags || []).forEach((t: any) => folders.set(t.name, { kind: 'folder', id: uid(), name: t.name, description: t.description || '', auth: { type: 'inherit' }, items: [] }));
  const root: Item[] = [];
  let count = 0;
  const usedVars = new Set<string>();

  for (const [path, rawItem] of Object.entries<any>(spec.paths || {})) {
    const pathItem = deref(rawItem);
    for (const m of METHODS) {
      const op = pathItem?.[m];
      if (!op) continue;
      count++;
      const params = [...(pathItem.parameters || []), ...(op.parameters || [])].map((p: any) => deref(p));
      // parameter level operasi menimpa level path
      const uniq = new Map<string, any>();
      params.forEach((p) => uniq.set(`${p.in}:${p.name}`, p));
      const pv = (p: any) => str(p.example ?? p.schema?.example ?? p['x-example'] ?? p.schema?.default ?? p.default ?? (p.examples ? (Object.values(p.examples)[0] as any)?.value : ''));

      const query: KV[] = [], pathVars: KV[] = [], headers: KV[] = [];
      const formFields: KV[] = [];
      let body: Body = { mode: 'none' };
      for (const p of uniq.values()) {
        const d = p.description ? { description: p.description } : {};
        if (p.in === 'query') { const value = pv(p); query.push({ key: p.name, value, enabled: !!p.required || value !== '', ...d }); }
        else if (p.in === 'path') pathVars.push({ key: p.name, value: pv(p), enabled: true, ...d });
        else if (p.in === 'header') headers.push({ key: p.name, value: pv(p), enabled: !!p.required, ...d });
        else if (p.in === 'body') body = { mode: 'json', raw: JSON.stringify(example(p.schema), null, 2) };
        else if (p.in === 'formData') formFields.push({ key: p.name, value: pv(p), enabled: true, ...(p.type === 'file' ? { type: 'file' as const } : {}), ...d });
      }
      if (formFields.length) {
        const consumes = op.consumes ?? spec.consumes ?? [];
        body = { mode: consumes.includes('multipart/form-data') || formFields.some((f) => f.type) ? 'formdata' : 'urlencoded', fields: formFields };
      }

      if (!v2 && op.requestBody) {
        const rb = deref(op.requestBody);
        const content = rb?.content || {};
        const ct = Object.keys(content)[0];
        const media = content[ct] || {};
        const ex = media.example ?? (media.examples ? deref(Object.values<any>(media.examples)[0])?.value : undefined) ?? example(media.schema);
        if (/json/.test(ct)) body = { mode: 'json', raw: JSON.stringify(ex, null, 2) };
        else if (ct === 'application/x-www-form-urlencoded' || ct === 'multipart/form-data') {
          const props = deref(media.schema)?.properties || {};
          const fields = Object.entries<any>(props).map(([k, s]) => {
            const ds = deref(s);
            return { key: k, value: ds.format === 'binary' ? '' : str(example(ds)), enabled: true, ...(ds.format === 'binary' ? { type: 'file' as const } : {}) };
          });
          body = { mode: ct === 'multipart/form-data' ? 'formdata' : 'urlencoded', fields };
        } else if (ct) body = { mode: 'raw', raw: typeof ex === 'string' ? ex : str(ex ?? ''), contentType: ct };
      }

      // Contoh response
      const examples: Example[] = [];
      for (const [code, rr] of Object.entries<any>(op.responses || {})) {
        const r = deref(rr);
        let b: any;
        if (v2) b = r?.examples?.['application/json'] ?? (r?.schema ? example(r.schema) : undefined);
        else {
          const c = r?.content?.['application/json'] ?? Object.values<any>(r?.content || {})[0];
          if (c) b = c.example ?? (c.examples ? deref(Object.values<any>(c.examples)[0])?.value : undefined) ?? (c.schema ? example(c.schema) : undefined);
        }
        examples.push({
          name: r?.description || code, status: Number(code) || 0, statusText: r?.description || '',
          headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
          body: b === undefined ? '' : typeof b === 'string' ? b : JSON.stringify(b, null, 2),
        });
      }

      const auth = secToAuth(op.security) ?? { type: 'inherit' };
      for (const a of [auth, rootAuth]) {
        if (a.type === 'bearer') usedVars.add('token');
        if (a.type === 'apikey') usedVars.add('apiKey');
        if (a.type === 'basic') { usedVars.add('username'); usedVars.add('password'); }
      }

      const req: RequestItem = {
        kind: 'request', id: op.operationId || uid(), method: m.toUpperCase() as Method,
        name: op.summary || op.operationId || `${m.toUpperCase()} ${path}`,
        description: op.description || '',
        url: '{{baseUrl}}' + path.replace(/\{([^}]+)\}/g, ':$1'),
        query, pathVars, headers, body, auth, examples,
      };
      const tag = op.tags?.[0];
      if (tag) {
        if (!folders.has(tag)) folders.set(tag, { kind: 'folder', id: uid(), name: tag, description: tagDesc[tag] || '', auth: { type: 'inherit' }, items: [] });
        folders.get(tag)!.items.push(req);
      } else root.push(req);
    }
  }

  const variables: KV[] = [{ key: 'baseUrl', value: baseUrl, enabled: true }];
  for (const v of usedVars) variables.push({ key: v, value: '', enabled: true });

  return {
    source: v2 ? 'swagger' : 'openapi',
    name: spec.info?.title || 'Untitled API',
    description: spec.info?.description || '',
    version: spec.info?.version,
    variables,
    auth: rootAuth,
    items: [...[...folders.values()].filter((f) => f.items.length), ...root],
    endpointCount: count,
    warnings: [...new Set(warnings)],
  };
}
