// Core HTTP engine (dipakai Playground UI & Terminal).

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const parseJSON = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function resolve(str, vars, missing) {
  return String(str ?? '').replace(VAR_RE, (m, k) => {
    if (vars[k] !== undefined && vars[k] !== '') return vars[k];
    missing?.add(k);
    return vars[k] ?? m;
  });
}

/** HTML URL dengan {{var}} ter-highlight (hijau jika ada, merah jika belum di-set) */
export function highlightVars(str, vars) {
  return esc(str).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => `<span class="${vars[k] ? 'var-ok' : 'var-miss'}" title="${esc(vars[k] ?? 'belum di-set')}">${m}</span>`)
    .replace(/(^|\/)(:[A-Za-z_][\w-]*)/g, '$1<span class="text-purple">$2</span>');
}

export const effectiveAuth = (req) => (!req.auth || req.auth.type === 'inherit' ? req.inheritedAuth ?? { type: 'none' } : req.auth);
const b64 = (s) => btoa(unescape(encodeURIComponent(s)));

/**
 * Bangun request final dari state editor + variabel env.
 * Return: { method, url, headers: [[k,v]], body, bodyText, form, missing: [] }
 */
export function buildRequest(req, vars) {
  const missing = new Set();
  const R = (s) => resolve(s, vars, missing);
  let url = R(req.url).trim();
  for (const p of req.pathVars || []) {
    if (!p.key) continue;
    const v = R(p.value);
    if (v !== '') url = url.replace(new RegExp(`:${reEsc(p.key)}(?=/|$|\\?|#)`, 'g'), encodeURIComponent(v));
  }
  const q = new URLSearchParams();
  (req.query || []).filter((x) => x.enabled && x.key).forEach((x) => q.append(R(x.key), R(x.value)));
  const headers = (req.headers || []).filter((h) => h.enabled && h.key).map((h) => [R(h.key), R(h.value)]);
  const has = (k) => headers.some(([h]) => h.toLowerCase() === k.toLowerCase());

  const auth = effectiveAuth(req);
  if (auth.type === 'bearer' && !has('authorization')) headers.push(['Authorization', `Bearer ${R(auth.token)}`]);
  else if (auth.type === 'basic' && !has('authorization')) headers.push(['Authorization', `Basic ${b64(`${R(auth.username)}:${R(auth.password)}`)}`]);
  else if (auth.type === 'apikey' && auth.key) {
    if (auth.in === 'query') q.append(R(auth.key), R(auth.value));
    else if (!has(auth.key)) headers.push([R(auth.key), R(auth.value)]);
  }

  let body, bodyText, form;
  const b = req.body || { mode: 'none' };
  const method = (req.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) {
    if (b.mode === 'json' && b.raw?.trim()) { body = bodyText = R(b.raw); if (!has('content-type')) headers.push(['Content-Type', 'application/json']); }
    else if (b.mode === 'raw' && b.raw) { body = bodyText = R(b.raw); if (!has('content-type')) headers.push(['Content-Type', b.contentType || 'text/plain']); }
    else if (b.mode === 'urlencoded') {
      const u = new URLSearchParams();
      b.fields.filter((f) => f.enabled && f.key).forEach((f) => u.append(R(f.key), R(f.value)));
      body = bodyText = u.toString();
      form = b.fields.filter((f) => f.enabled && f.key).map((f) => ({ key: R(f.key), value: R(f.value) }));
      if (!has('content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
    } else if (b.mode === 'formdata') {
      const fd = new FormData();
      form = [];
      b.fields.filter((f) => f.enabled && f.key).forEach((f) => {
        if (f.type === 'file') { if (f.file) fd.append(R(f.key), f.file, f.file.name); form.push({ key: R(f.key), file: f.file?.name || 'file.bin' }); }
        else { fd.append(R(f.key), R(f.value)); form.push({ key: R(f.key), value: R(f.value) }); }
      });
      body = fd;
      // jangan set Content-Type — browser menambahkan boundary
      for (let i = headers.length - 1; i >= 0; i--) if (headers[i][0].toLowerCase() === 'content-type') headers.splice(i, 1);
    }
  }
  const qs = q.toString();
  if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  return { method, url, headers, body, bodyText, bodyMode: b.mode, form, missing: [...missing] };
}

const TEXTUAL = /json|text|xml|html|javascript|csv|yaml|x-www-form-urlencoded|graphql/i;

/** Kirim request. Return objek hasil (tidak pernah throw). */
export async function send(built, { signal } = {}) {
  const t0 = performance.now();
  try {
    if (!/^https?:\/\//i.test(built.url)) throw new Error(`URL tidak valid: "${built.url || '(kosong)'}". Pastikan variabel baseUrl sudah di-set.`);
    const res = await fetch(built.url, { method: built.method, headers: built.headers, body: built.body, signal });
    const buf = await res.arrayBuffer();
    const ms = Math.round(performance.now() - t0);
    const contentType = res.headers.get('content-type') || '';
    const headers = [...res.headers.entries()];
    let text = '', json, blobUrl;
    if (!contentType || TEXTUAL.test(contentType)) {
      text = new TextDecoder().decode(buf);
      json = parseJSON(text);
    } else {
      blobUrl = URL.createObjectURL(new Blob([buf], { type: contentType }));
      text = `[binary ${contentType}, ${buf.byteLength} bytes]`;
    }
    return { ok: res.ok, status: res.status, statusText: res.statusText || STATUS[res.status] || '', ms, size: buf.byteLength, headers, contentType, text, json, blobUrl, at: Date.now() };
  } catch (e) {
    const aborted = e.name === 'AbortError';
    return {
      error: true, aborted, ms: Math.round(performance.now() - t0), status: 0,
      message: aborted ? 'Request dibatalkan.' : e.message,
      hint: aborted ? '' : e instanceof TypeError ? 'Kemungkinan diblokir CORS, server mati, atau masalah jaringan / mixed content (http di halaman https).' : '',
      at: Date.now(),
    };
  }
}

export const STATUS = { 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable' };

export const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1048576).toFixed(2)} MB`);
export const statusTone = (s) => (s >= 200 && s < 300 ? 'ok' : s >= 300 && s < 400 ? 'warn' : 'bad');

/** Cari token di response login */
export function findToken(json) {
  if (!json || typeof json !== 'object') return;
  const keys = ['accessToken', 'access_token', 'token', 'jwt', 'id_token', 'idToken'];
  for (const obj of [json, json.data, json.result, json.data?.tokens, json.tokens]) {
    if (!obj || typeof obj !== 'object') continue;
    for (const k of keys) if (typeof obj[k] === 'string' && obj[k].length > 8) return obj[k];
  }
}

/* ---------------- Syntax highlight ---------------- */
export function highlightJSON(src) {
  const re = /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"\n])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    const [, str, colon, lit, num] = m;
    out += str ? `<span class="${colon ? 'tok-k' : 'tok-s'}">${esc(str)}</span>${colon ? esc(colon) : ''}` : lit ? `<span class="tok-b">${lit}</span>` : `<span class="tok-n">${num}</span>`;
    last = re.lastIndex;
  }
  return out + esc(src.slice(last));
}

/* ---------------- Code snippets ---------------- */
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const dq = (s) => JSON.stringify(String(s));
const pyVal = (v, ind = 4) => JSON.stringify(v, null, ind).replace(/: (true|false|null)\b/g, (_, b) => ': ' + { true: 'True', false: 'False', null: 'None' }[b]);
const hdrObj = (r) => Object.fromEntries(r.headers);

export const SNIPPET_LANGS = { curl: 'cURL', fetch: 'JavaScript', axios: 'Axios', python: 'Python', go: 'Go', php: 'PHP', dart: 'Dart', httpie: 'HTTPie' };

export const SNIPPETS = {
  curl: (r) => {
    const parts = [`curl -X ${r.method} ${sq(r.url)}`, ...r.headers.map(([k, v]) => `  -H ${sq(`${k}: ${v}`)}`)];
    if (r.bodyMode === 'formdata' && r.form) parts.push(...r.form.map((f) => `  -F ${sq(f.file ? `${f.key}=@${f.file}` : `${f.key}=${f.value}`)}`));
    else if (r.bodyText) { const j = parseJSON(r.bodyText); parts.push(`  -d ${sq(j !== undefined ? JSON.stringify(j) : r.bodyText)}`); }
    return parts.join(' \\\n');
  },
  fetch: (r) => {
    const lines = [`const res = await fetch(${dq(r.url)}, {`, `  method: ${dq(r.method)},`];
    if (r.headers.length) lines.push(`  headers: ${JSON.stringify(hdrObj(r), null, 2).replace(/\n/g, '\n  ')},`);
    if (r.bodyMode === 'formdata' && r.form) { lines.unshift('const form = new FormData();', ...r.form.map((f) => `form.append(${dq(f.key)}, ${f.file ? `fileInput.files[0] /* ${f.file} */` : dq(f.value)});`), ''); lines.push('  body: form,'); }
    else if (r.bodyText) { const j = parseJSON(r.bodyText); lines.push(`  body: ${j !== undefined ? `JSON.stringify(${JSON.stringify(j, null, 2).replace(/\n/g, '\n  ')})` : dq(r.bodyText)},`); }
    lines.push('});', '', 'const data = await res.json();', 'console.log(res.status, data);');
    return lines.join('\n');
  },
  axios: (r) => {
    const cfg = { method: r.method.toLowerCase(), url: r.url, ...(r.headers.length ? { headers: hdrObj(r) } : {}) };
    let s = JSON.stringify(cfg, null, 2);
    if (r.bodyText) { const j = parseJSON(r.bodyText); s = s.replace(/\n}$/, `,\n  "data": ${j !== undefined ? JSON.stringify(j, null, 2).replace(/\n/g, '\n  ') : dq(r.bodyText)}\n}`); }
    return `import axios from 'axios';\n\nconst { data, status } = await axios.request(${s.replace(/"(\w+)":/g, '$1:')});\nconsole.log(status, data);`;
  },
  python: (r) => {
    const j = parseJSON(r.bodyText ?? '');
    const lines = ['import requests', '', `url = ${dq(r.url)}`];
    if (r.headers.length) lines.push(`headers = ${pyVal(hdrObj(r))}`);
    if (j !== undefined) lines.push(`payload = ${pyVal(j)}`);
    else if (r.form && r.bodyMode !== 'formdata') lines.push(`payload = ${pyVal(Object.fromEntries(r.form.map((f) => [f.key, f.value])))}`);
    else if (r.bodyText) lines.push(`payload = ${dq(r.bodyText)}`);
    const args = [dq(r.method), 'url', r.headers.length && 'headers=headers', j !== undefined ? 'json=payload' : r.bodyText ? 'data=payload' : ''].filter(Boolean);
    if (r.bodyMode === 'formdata' && r.form) { lines.push(`files = ${pyVal(Object.fromEntries(r.form.map((f) => [f.key, f.file ? `open('${f.file}', 'rb')` : f.value])))}`); args.push('files=files'); }
    lines.push('', `res = requests.request(${args.join(', ')})`, 'print(res.status_code, res.json())');
    return lines.join('\n');
  },
  go: (r) => {
    const body = r.bodyText ? `strings.NewReader(${'`' + r.bodyText.replace(/`/g, '` + "`" + `') + '`'})` : 'nil';
    return `package main

import (
\t"fmt"
\t"io"
\t"net/http"${r.bodyText ? '\n\t"strings"' : ''}
)

func main() {
\treq, _ := http.NewRequest(${dq(r.method)}, ${dq(r.url)}, ${body})
${r.headers.map(([k, v]) => `\treq.Header.Set(${dq(k)}, ${dq(v)})`).join('\n')}
\tres, err := http.DefaultClient.Do(req)
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer res.Body.Close()
\tb, _ := io.ReadAll(res.Body)
\tfmt.Println(res.Status, string(b))
}`;
  },
  php: (r) => `<?php
$ch = curl_init(${sq(r.url)});
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => '${r.method}',
    CURLOPT_HTTPHEADER => [
${r.headers.map(([k, v]) => `        ${sq(`${k}: ${v}`)},`).join('\n')}
    ],${r.bodyText ? `\n    CURLOPT_POSTFIELDS => ${sq(r.bodyText)},` : ''}
]);
$response = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
echo $status . PHP_EOL . $response;`,
  dart: (r) => `import 'package:http/http.dart' as http;

void main() async {
  final req = http.Request('${r.method}', Uri.parse(${sq(r.url)}));
${r.headers.map(([k, v]) => `  req.headers[${sq(k)}] = ${sq(v)};`).join('\n')}${r.bodyText ? `\n  req.body = ${sq(r.bodyText)};` : ''}
  final res = await http.Response.fromStream(await req.send());
  print('\${res.statusCode} \${res.body}');
}`,
  httpie: (r) => {
    const j = parseJSON(r.bodyText ?? '');
    const parts = [`http ${r.method} ${sq(r.url)}`, ...r.headers.map(([k, v]) => sq(`${k}:${v}`))];
    if (j && typeof j === 'object' && !Array.isArray(j)) parts.push(...Object.entries(j).map(([k, v]) => sq(typeof v === 'string' ? `${k}=${v}` : `${k}:=${JSON.stringify(v)}`)));
    else if (r.bodyText) return `echo ${sq(r.bodyText)} | ` + parts.join(' ');
    return parts.join(' \\\n  ');
  },
};

/* ---------------- Shell tokenizer + cURL parser ---------------- */
export function tokenize(line) {
  const out = []; let cur = '', q = null, has = false;
  line = line.replace(/\\\r?\n/g, ' ');
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && /["\\$`]/.test(line[i + 1])) cur += line[++i];
      else cur += c;
    } else if (c === "'" || c === '"') { q = c; has = true; }
    else if (c === '\\' && i + 1 < line.length) { cur += line[++i]; has = true; }
    else if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; }
    else { cur += c; has = true; }
  }
  if (q) throw new Error('Tanda kutip belum ditutup');
  if (cur || has) out.push(cur);
  return out;
}

export function parseCurl(line) {
  const t = tokenize(line.trim());
  if (t[0] !== 'curl') throw new Error('Bukan perintah curl');
  const r = { method: '', url: '', headers: [], body: undefined };
  const data = [];
  let user;
  for (let i = 1; i < t.length; i++) {
    const a = t[i];
    const next = () => t[++i] ?? '';
    if (a === '-X' || a === '--request') r.method = next().toUpperCase();
    else if (a.startsWith('-X') && a.length > 2) r.method = a.slice(2).toUpperCase();
    else if (a === '-H' || a === '--header') { const h = next(); const k = h.indexOf(':'); if (k > 0) r.headers.push([h.slice(0, k).trim(), h.slice(k + 1).trim()]); }
    else if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode'].includes(a)) data.push(next());
    else if (a === '--json') { data.push(next()); r.headers.push(['Content-Type', 'application/json'], ['Accept', 'application/json']); }
    else if (a === '-u' || a === '--user') user = next();
    else if (a === '--url') r.url = next();
    else if (a === '-I' || a === '--head') r.method = 'HEAD';
    else if (['-F', '--form', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '-o', '--output', '-m', '--max-time', '--connect-timeout'].includes(a)) next();
    else if (a.startsWith('-')) { /* flag tanpa argumen: -s -L -k -v -i --compressed, abaikan */ }
    else if (!r.url) r.url = a;
  }
  if (data.length) r.body = data.join('&');
  if (user) r.headers.push(['Authorization', 'Basic ' + b64(user)]);
  if (!r.method) r.method = r.body !== undefined ? 'POST' : 'GET';
  if (r.body !== undefined && !r.headers.some(([k]) => k.toLowerCase() === 'content-type'))
    r.headers.push(['Content-Type', parseJSON(r.body) !== undefined ? 'application/json' : 'application/x-www-form-urlencoded']);
  if (!r.url) throw new Error('URL tidak ditemukan');
  if (!/^https?:\/\//i.test(r.url)) r.url = 'https://' + r.url;
  return { method: r.method, url: r.url, headers: r.headers, body: r.body, bodyText: r.body, bodyMode: 'raw', missing: [] };
}

/* ---------------- Mini markdown (untuk deskripsi) ---------------- */
export function md(src = '') {
  if (!src.trim()) return '';
  const blocks = esc(src).split(/```/);
  return blocks.map((b, i) => {
    if (i % 2) return `<pre><code>${b.replace(/^\w*\n/, '')}</code></pre>`;
    return b.split(/\n{2,}/).map((p) => {
      const inline = (s) => s
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      const t = p.trim();
      if (!t) return '';
      const h = t.match(/^(#{1,3})\s+(.*)$/);
      if (h) return `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`;
      if (/^[-*]\s/m.test(t) && t.split('\n').every((l) => /^\s*[-*]\s/.test(l))) return `<ul>${t.split('\n').map((l) => `<li>${inline(l.replace(/^\s*[-*]\s/, ''))}</li>`).join('')}</ul>`;
      return `<p>${inline(t).replace(/\n/g, '<br>')}</p>`;
    }).join('');
  }).join('');
}
