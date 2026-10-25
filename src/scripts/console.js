// Client island (vanilla JS): parser OpenAPI, request builder, fetch, snippet generator.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const parsed = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

let spec, ops = [], current, baseUrl = '', token = '';
const cache = {}; // state per endpoint, supaya edit tidak hilang saat pindah

/* ---------- OpenAPI parsing ---------- */
const deref = (o, root) => (o?.$ref ? o.$ref.replace('#/', '').split('/').reduce((a, k) => a?.[k], root) : o);

function example(schema, root, d = 0) {
  schema = deref(schema, root);
  if (!schema || d > 4) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  switch (schema.type) {
    case 'object': return Object.fromEntries(Object.entries(schema.properties || {}).map(([k, v]) => [k, example(v, root, d + 1)]));
    case 'array': return [example(schema.items, root, d + 1)];
    case 'integer': case 'number': return 0;
    case 'boolean': return false;
    default: return schema.enum?.[0] ?? 'string';
  }
}

function parse(s) {
  spec = s; ops = [];
  baseUrl = s.servers?.[0]?.url ?? '';
  for (const [path, item] of Object.entries(s.paths || {}))
    for (const m of METHODS) {
      const o = item[m];
      if (!o) continue;
      const params = [...(item.parameters || []), ...(o.parameters || [])].map((p) => deref(p, s));
      const body = deref(o.requestBody, s)?.content?.['application/json'];
      const sec = o.security ?? s.security;
      ops.push({
        id: o.operationId || `${m}${path}`.replace(/\W+/g, '_'),
        method: m.toUpperCase(), path, summary: o.summary || '', tag: o.tags?.[0] || 'Other',
        params, secured: !!sec?.length,
        body: body ? (body.example ?? example(body.schema, s)) : undefined,
      });
    }
}

/* ---------- Sidebar (dipakai ulang saat spec dimuat dari URL) ---------- */
function renderNav() {
  const groups = {};
  ops.forEach((o) => (groups[o.tag] ??= []).push(o));
  $('#nav').innerHTML = Object.entries(groups).map(([tag, items]) =>
    `<section class="mb-3"><h2 class="px-4 pb-1 text-zinc-600">${esc(tag)}</h2>${items.map((o) =>
      `<a class="nav-link" href="#${esc(o.id)}" data-id="${esc(o.id)}"><span class="verb v-${o.method.toLowerCase()}">${o.method}</span><span class="truncate">${esc(o.path)}</span></a>`).join('')}</section>`).join('');
  $('#title').textContent = spec.info?.title ?? 'API';
  $('#version').textContent = 'v' + (spec.info?.version ?? '');
}

/* ---------- Request state ---------- */
function stateFor(o) {
  return cache[o.id] ??= {
    params: Object.fromEntries(o.params.map((p) => [p.name, p.example ?? p.schema?.example ?? p.schema?.default ?? ''])),
    headers: [
      ...(o.body !== undefined ? [{ k: 'Content-Type', v: 'application/json', on: true }] : []),
      ...(o.secured ? [{ k: 'Authorization', v: `Bearer ${token}`, on: true }] : []),
    ],
    body: o.body !== undefined ? JSON.stringify(o.body, null, 2) : '',
    tab: 'curl',
  };
}

function buildReq() {
  const o = current, s = stateFor(o), q = new URLSearchParams();
  let path = o.path;
  for (const p of o.params) {
    const v = s.params[p.name];
    if (v === '' || v == null) continue;
    if (p.in === 'path') path = path.replace(`{${p.name}}`, encodeURIComponent(v));
    else if (p.in === 'query') q.set(p.name, v);
  }
  const qs = q.toString();
  return {
    method: o.method,
    url: baseUrl.replace(/\/$/, '') + path + (qs ? '?' + qs : ''),
    headers: Object.fromEntries(s.headers.filter((h) => h.k && h.on).map((h) => [h.k, h.v])),
    body: o.body !== undefined && o.method !== 'GET' && s.body.trim() ? s.body : undefined,
  };
}

/* ---------- Snippet generator ---------- */
const py = (v) => JSON.stringify(v, null, 4).replace(/(:\s)(true|false|null)\b/g, (_, a, b) => a + { true: 'True', false: 'False', null: 'None' }[b]);
const SNIPPETS = {
  curl: (r) => [`curl -X ${r.method} '${r.url}'`,
    ...Object.entries(r.headers).map(([k, v]) => `  -H '${k}: ${v}'`),
    ...(r.body ? [`  -d '${JSON.stringify(parsed(r.body) ?? r.body)}'`] : [])].join(' \\\n'),
  js: (r) => {
    let s = JSON.stringify({ method: r.method, headers: r.headers }, null, 2);
    if (r.body) {
      const b = parsed(r.body);
      s = s.replace(/\n}$/, `,\n  body: ${b !== undefined ? `JSON.stringify(${JSON.stringify(b, null, 2).replace(/\n/g, '\n  ')})` : JSON.stringify(r.body)}\n}`);
    }
    return `const res = await fetch("${r.url}", ${s});\nconst data = await res.json();\nconsole.log(data);`;
  },
  python: (r) => {
    const b = parsed(r.body);
    return `import requests\n\nres = requests.request(\n    "${r.method}",\n    "${r.url}",\n    headers=${py(r.headers)},${b !== undefined ? `\n    json=${py(b)},` : r.body ? `\n    data=${JSON.stringify(r.body)},` : ''}\n)\nprint(res.status_code, res.json())`;
  },
};
const TAB_NAMES = { curl: 'cURL', js: 'fetch', python: 'Python' };

/* ---------- Rendering ---------- */
const highlight = (json) => json.replace(
  /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
  (m) => `<span class="tok-${/^"/.test(m) ? (/:$/.test(m) ? 'k' : 's') : /true|false|null/.test(m) ? 'b' : 'n'}">${esc(m)}</span>`);

function headersHTML(s) {
  return s.headers.map((h, i) => `<div class="mb-1.5 flex items-center gap-1.5">
    <input type="checkbox" class="accent-cyan-300" data-h="${i}" data-f="on" ${h.on ? 'checked' : ''} aria-label="aktifkan header" />
    <input class="field" data-h="${i}" data-f="k" value="${esc(h.k)}" placeholder="Header" />
    <input class="field" data-h="${i}" data-f="v" value="${esc(h.v)}" placeholder="value" />
    <button class="px-1 text-zinc-600 transition-colors hover:text-red-300" data-act="rm-h" data-i="${i}" aria-label="hapus header">×</button></div>`).join('')
    || '<p class="text-zinc-600">tidak ada header</p>';
}

function renderDetail() {
  const o = current, s = stateFor(o), m = o.method.toLowerCase();
  const params = o.params.filter((p) => p.in !== 'header').map((p) => `<label class="mb-1.5 grid grid-cols-[9rem_1fr] items-center gap-2">
    <span class="truncate text-zinc-400">${esc(p.name)} <i class="not-italic text-zinc-600">${p.in}${p.required ? ' *' : ''}</i></span>
    <input class="field" data-param="${esc(p.name)}" value="${esc(s.params[p.name] ?? '')}" placeholder="${esc(p.schema?.type || '')}" /></label>`).join('')
    || '<p class="text-zinc-600">tidak ada parameter</p>';

  $('#detail').innerHTML = `
  <header class="border-b border-zinc-800 px-6 py-5">
    <div class="flex items-baseline gap-3"><span class="verb v-${m}">${o.method}</span><h2 class="break-all text-base">${esc(o.path)}</h2></div>
    <p class="mt-1 text-zinc-500">${esc(o.summary)}</p>
  </header>
  <div class="grid xl:grid-cols-2 xl:divide-x xl:divide-zinc-800">
    <section class="space-y-6 p-6">
      <div><div class="label"><span>base url</span></div><input id="base" class="field" value="${esc(baseUrl)}" /></div>
      <div><div class="label"><span>params</span></div>${params}</div>
      <div><div class="label"><span>headers</span><button class="text-zinc-500 transition-colors hover:text-accent" data-act="add-h">+ tambah</button></div><div id="headers">${headersHTML(s)}</div></div>
      ${o.body !== undefined ? `<div><div class="label"><span>json body</span><button class="text-zinc-500 transition-colors hover:text-accent" data-act="fmt">format</button></div>
        <textarea id="body" rows="9" spellcheck="false" class="field resize-y leading-relaxed">${esc(s.body)}</textarea></div>` : ''}
      <button class="btn btn-primary w-full py-2" data-act="send" id="send">kirim request <span class="text-zinc-600">ctrl+enter</span></button>
    </section>
    <section class="space-y-6 p-6 xl:sticky xl:top-0 xl:max-h-screen xl:self-start xl:overflow-y-auto">
      <div>
        <div class="label"><span id="status" class="text-zinc-500">response</span><button class="hover:text-accent" data-act="copy-res">copy</button></div>
        <pre id="res" class="max-h-[26rem] min-h-[8rem] overflow-auto border border-zinc-800 bg-zinc-950 p-3 text-zinc-300"><span class="text-zinc-600">// menunggu request</span><span class="animate-blink text-accent">▍</span></pre>
      </div>
      <div>
        <div class="label"><div class="flex gap-4" role="tablist">${Object.entries(TAB_NAMES).map(([k, n]) =>
          `<button class="tab" role="tab" data-act="tab" data-t="${k}" aria-selected="${s.tab === k}">${n}</button>`).join('')}</div>
          <button class="hover:text-accent" data-act="copy-snip">copy</button></div>
        <pre class="overflow-auto border border-zinc-800 bg-zinc-950 p-3 text-zinc-300"><code id="snip"></code></pre>
      </div>
    </section>
  </div>`;
  refresh();
}

function refresh() {
  const s = stateFor(current);
  $('#snip').textContent = SNIPPETS[s.tab](buildReq());
  document.querySelectorAll('[data-act=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.t === s.tab));
}

function select(id) {
  const o = ops.find((x) => x.id === id) ?? ops[0];
  if (!o) return;
  current = o;
  document.querySelectorAll('.nav-link').forEach((a) => a.setAttribute('aria-current', a.dataset.id === o.id));
  renderDetail();
  $('#detail').scrollTop = 0;
}

/* ---------- Send ---------- */
async function send() {
  const r = buildReq(), btn = $('#send'), res = $('#res'), st = $('#status');
  btn.disabled = true;
  st.className = 'text-zinc-500'; st.textContent = 'mengirim…';
  res.innerHTML = '<span class="animate-blink text-accent">▍</span>';
  const t0 = performance.now();
  try {
    const resp = await fetch(r.url, { method: r.method, headers: r.headers, body: r.body });
    const text = await resp.text(), ms = Math.round(performance.now() - t0);
    const json = parsed(text);
    const pretty = json !== undefined ? JSON.stringify(json, null, 2) : text;
    st.className = resp.ok ? 'text-accent-ok' : 'text-red-300';
    st.textContent = `${resp.status} ${resp.statusText} · ${ms}ms · ${(new Blob([text]).size / 1024).toFixed(1)}kB`;
    const lines = (json !== undefined ? highlight(pretty) : esc(pretty)).split('\n').slice(0, 600);
    res.innerHTML = lines.map((l, i) => `<span class="ln" style="--i:${i}">${l || ' '}</span>`).join('');
    res.dataset.raw = pretty;
    const t = json?.accessToken ?? json?.token; // auto-simpan token dari endpoint login
    if (t) setToken(t);
  } catch (e) {
    st.className = 'text-red-300'; st.textContent = 'gagal';
    res.innerHTML = `<span class="text-red-300">${esc(e.message)}</span>\n<span class="text-zinc-600">kemungkinan CORS, jaringan, atau URL tidak valid.</span>`;
  }
  btn.disabled = false;
}

function setToken(t) {
  token = t;
  for (const s of Object.values(cache)) s.headers.forEach((h) => { if (h.k.toLowerCase() === 'authorization') h.v = `Bearer ${t}`; });
  $('#headers').innerHTML = headersHTML(stateFor(current));
  refresh();
  $('#status').textContent += ' · token tersimpan';
}

function copy(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const old = btn.textContent;
    btn.textContent = 'tersalin ✓'; btn.classList.add('text-accent-ok');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('text-accent-ok'); }, 1200);
  });
}

/* ---------- Events ---------- */
const root = $('#detail');
root.addEventListener('input', (e) => {
  const t = e.target, s = stateFor(current);
  if (t.dataset.param) s.params[t.dataset.param] = t.value;
  else if (t.dataset.h !== undefined) {
    const h = s.headers[+t.dataset.h];
    if (t.dataset.f === 'on') h.on = t.checked; else h[t.dataset.f] = t.value;
    if (t.dataset.f === 'v' && h.k.toLowerCase() === 'authorization') token = h.v.replace(/^Bearer\s+/i, '');
  } else if (t.id === 'body') { s.body = t.value; t.classList.toggle('invalid', t.value.trim() !== '' && parsed(t.value) === undefined); }
  else if (t.id === 'base') baseUrl = t.value;
  refresh();
});

root.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const s = stateFor(current), act = b.dataset.act;
  if (act === 'send') send();
  else if (act === 'tab') { s.tab = b.dataset.t; refresh(); }
  else if (act === 'add-h') { s.headers.push({ k: '', v: '', on: true }); $('#headers').innerHTML = headersHTML(s); refresh(); }
  else if (act === 'rm-h') { s.headers.splice(+b.dataset.i, 1); $('#headers').innerHTML = headersHTML(s); refresh(); }
  else if (act === 'fmt') { const j = parsed(s.body); if (j !== undefined) { s.body = $('#body').value = JSON.stringify(j, null, 2); refresh(); } }
  else if (act === 'copy-snip') copy($('#snip').textContent, b);
  else if (act === 'copy-res') copy($('#res').dataset.raw ?? '', b);
});

document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && current) send(); });
window.addEventListener('hashchange', () => select(location.hash.slice(1)));

/* ---------- Spec loading: embedded (SSG), ?spec=URL, atau input ---------- */
async function loadSpec(url) {
  const status = $('#spec-status');
  status.textContent = 'memuat…';
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    parse(await r.json());
    renderNav(); select(ops[0]?.id);
    status.textContent = `${ops.length} endpoint dimuat`;
  } catch (e) { status.textContent = `gagal: ${e.message}`; }
}

$('#spec-form').addEventListener('submit', (e) => { e.preventDefault(); const u = $('#spec-url').value.trim(); if (u) loadSpec(u); });

parse(JSON.parse($('#spec-data').textContent));
const qs = new URLSearchParams(location.search).get('spec');
if (qs) { $('#spec-url').value = qs; loadSpec(qs); } else select(location.hash.slice(1));
