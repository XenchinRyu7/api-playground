import {
  send,
  buildRequest,
  highlightVars,
  effectiveAuth,
  highlightJSON,
  fmtSize,
  statusTone,
  findToken,
  SNIPPETS,
  SNIPPET_LANGS,
  md,
  esc,
  parseJSON,
} from '../core/http.js';

// Playground Client Island
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function initPlayground(project) {
  // State
  const storageKey = `apg_vars_${project.slug}`;
  const defaultVars = Object.fromEntries((project.variables || []).filter((v) => v.enabled).map((v) => [v.key, v.value]));
  const storedVars = parseJSON(localStorage.getItem(storageKey) || '{}') || {};
  let variables = { ...defaultVars, ...storedVars };

  // Expose to window for Terminal and Command Palette
  window.__PLAYGROUND_PROJECT__ = project;
  window.__PLAYGROUND_VARS__ = variables;

  const endpointCache = {}; // stores modified request params/headers/body per endpoint
  let currentReq = null;
  let activeTab = 'params';
  let activeResTab = 'pretty';
  let activeSnippetLang = 'curl';
  let lastResponse = null;
  let history = parseJSON(localStorage.getItem(`apg_hist_${project.slug}`) || '[]') || [];

  // Flatten items for fast lookup
  const flatEndpoints = [];
  const walk = (items, parentAuth = project.auth, path = []) => {
    items.forEach((it) => {
      if (it.kind === 'folder') {
        const folderAuth = it.auth?.type && it.auth.type !== 'inherit' ? it.auth : parentAuth;
        walk(it.items || [], folderAuth, [...path, it.name]);
      } else {
        flatEndpoints.push({ ...it, inheritedAuth: parentAuth, folderPath: path.join(' / ') });
      }
    });
  };
  walk(project.items || []);

  // DOM Elements
  const navEl = $('#ep-nav');
  const searchInput = $('#ep-search');
  const methodSelect = $('#req-method');
  const urlInput = $('#req-url');
  const sendBtn = $('#req-send');
  const statusBadge = $('#res-status');
  const timeBadge = $('#res-time');
  const sizeBadge = $('#res-size');
  const resViewer = $('#res-viewer');
  const snippetViewer = $('#snippet-viewer');
  const tabContentEl = $('#tab-content');
  const envModal = $('#env-modal');
  const envTable = $('#env-table-body');

  function getState(req) {
    if (!endpointCache[req.id]) {
      const auth = req.auth?.type === 'inherit' ? req.inheritedAuth : req.auth;
      endpointCache[req.id] = {
        method: req.method,
        url: req.url,
        query: (req.query || []).map((x) => ({ ...x })),
        pathVars: (req.pathVars || []).map((x) => ({ ...x })),
        headers: (req.headers || []).map((x) => ({ ...x })),
        body: req.body ? JSON.parse(JSON.stringify(req.body)) : { mode: 'none' },
        auth: auth ? JSON.parse(JSON.stringify(auth)) : { type: 'none' },
      };
    }
    return endpointCache[req.id];
  }

  // Render Sidebar
  function renderNav(filter = '') {
    const q = filter.trim().toLowerCase();
    const filtered = flatEndpoints.filter((it) => {
      if (!q) return true;
      return it.name.toLowerCase().includes(q) || it.url.toLowerCase().includes(q) || it.method.toLowerCase().includes(q);
    });

    if (!filtered.length) {
      navEl.innerHTML = '<div class="p-4 text-center text-xs text-muted">Tidak ada endpoint cocok.</div>';
      return;
    }

    // Group by folder
    const groups = {};
    filtered.forEach((it) => {
      const g = it.folderPath || 'General';
      (groups[g] ??= []).push(it);
    });

    navEl.innerHTML = Object.entries(groups)
      .map(
        ([grp, items]) => `
      <div class="mb-3">
        <div class="px-3 py-1 text-[11px] font-semibold text-muted tracking-tight truncate">${esc(grp)}</div>
        <div class="space-y-0.5">
          ${items
            .map(
              (it) => `
            <a href="#${esc(it.id)}" data-ep-id="${esc(it.id)}" class="side-item ${currentReq?.id === it.id ? 'active' : ''}">
              <span class="verb v-${it.method.toLowerCase()}">${it.method}</span>
              <span class="truncate text-xs font-medium">${esc(it.name)}</span>
            </a>
          `
            )
            .join('')}
        </div>
      </div>
    `
      )
      .join('');

    $$('.side-item', navEl).forEach((a) => {
      a.addEventListener('click', (e) => {
        const id = a.dataset.epId;
        selectEndpoint(id);
      });
    });
  }

  function selectEndpoint(id) {
    const ep = flatEndpoints.find((x) => x.id === id) || flatEndpoints[0];
    if (!ep) return;
    currentReq = ep;

    $$('.side-item', navEl).forEach((a) => {
      a.setAttribute('aria-current', String(a.dataset.epId === ep.id));
    });

    const s = getState(ep);
    methodSelect.value = s.method;
    urlInput.value = s.url;

    $('#req-summary').textContent = ep.name;
    $('#req-desc-short').textContent = ep.description ? ep.description.split('\n')[0] : '';

    renderRequestTabs();
    updateSnippets();
  }

  // Render Tabs
  function renderRequestTabs() {
    if (!currentReq) return;
    const s = getState(currentReq);

    // Active tab styles
    $$('.req-tab-btn').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.tab === activeTab));
    });

    if (activeTab === 'docs') {
      renderDocsTab(currentReq);
    } else if (activeTab === 'params') {
      renderParamsTab(s);
    } else if (activeTab === 'headers') {
      renderHeadersTab(s);
    } else if (activeTab === 'body') {
      renderBodyTab(s);
    } else if (activeTab === 'auth') {
      renderAuthTab(s);
    }
  }

  function renderDocsTab(ep) {
    const examples = ep.examples || [];
    tabContentEl.innerHTML = `
      <div class="space-y-4">
        ${ep.description ? `<div class="prose-doc">${md(ep.description)}</div>` : '<p class="text-xs text-muted">Tidak ada deskripsi rinci untuk endpoint ini.</p>'}

        ${
          examples.length
            ? `
          <div class="border-t border-line/10 pt-4">
            <div class="flex items-center justify-between mb-2">
              <h4 class="text-xs font-semibold text-muted">Contoh Response (${examples.length})</h4>
              <div class="flex gap-1" id="example-buttons">
                ${examples
                  .map(
                    (ex, i) => `
                  <button type="button" class="btn btn-ghost px-2 py-0.5 text-xs font-mono" data-ex-idx="${i}">
                    ${esc(ex.name)} (${ex.status})
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>
            <pre class="code max-h-60" id="example-preview">${highlightJSON(examples[0].body || '{}')}</pre>
          </div>
        `
            : ''
        }
      </div>
    `;

    $$('#example-buttons button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = +btn.dataset.exIdx;
        const ex = examples[idx];
        if (ex) {
          $('#example-preview').innerHTML = highlightJSON(ex.body || '{}');
        }
      });
    });
  }

  function renderParamsTab(s) {
    tabContentEl.innerHTML = `
      <div class="space-y-4">
        <!-- Query Params -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <h4 class="text-xs font-semibold text-muted">Query Parameters</h4>
            <button type="button" class="text-xs text-accent hover:underline" id="add-query-btn">+ Tambah Parameter</button>
          </div>
          <table class="kv">
            <thead>
              <tr class="border-b border-line/10">
                <th class="w-8"></th>
                <th class="w-1/3">Key</th>
                <th>Value</th>
                <th class="w-8"></th>
              </tr>
            </thead>
            <tbody id="query-table-body">
              ${(s.query || [])
                .map(
                  (q, i) => `
                <tr class="border-b border-line/5">
                  <td class="text-center"><input type="checkbox" class="check" data-idx="${i}" data-field="enabled" ${q.enabled ? 'checked' : ''} /></td>
                  <td><input type="text" data-idx="${i}" data-field="key" value="${esc(q.key)}" placeholder="parameter" /></td>
                  <td><input type="text" data-idx="${i}" data-field="value" value="${esc(q.value)}" placeholder="value" /></td>
                  <td class="text-center"><button type="button" class="text-muted hover:text-bad px-1" data-del-query="${i}">×</button></td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>

        <!-- Path Variables -->
        ${
          s.pathVars?.length
            ? `
          <div class="border-t border-line/10 pt-4">
            <h4 class="text-xs font-semibold text-muted mb-2">Path Variables</h4>
            <table class="kv">
              <thead>
                <tr class="border-b border-line/10">
                  <th class="w-1/3">Variable</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody id="pathvars-table-body">
                ${s.pathVars
                  .map(
                    (pv, i) => `
                  <tr class="border-b border-line/5">
                    <td class="font-mono text-xs text-purple px-2">:${esc(pv.key)}</td>
                    <td><input type="text" data-idx="${i}" data-field="pathVar" value="${esc(pv.value)}" placeholder="value" /></td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        `
            : ''
        }
      </div>
    `;

    $('#add-query-btn')?.addEventListener('click', () => {
      s.query.push({ key: '', value: '', enabled: true });
      renderParamsTab(s);
      updateSnippets();
    });

    $$('#query-table-body input', tabContentEl).forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const i = +inp.dataset.idx;
        const f = inp.dataset.field;
        if (f === 'enabled') s.query[i].enabled = inp.checked;
        else s.query[i][f] = inp.value;
        updateSnippets();
      });
    });

    $$('#pathvars-table-body input', tabContentEl).forEach((inp) => {
      inp.addEventListener('input', () => {
        const i = +inp.dataset.idx;
        s.pathVars[i].value = inp.value;
        updateSnippets();
      });
    });

    $$('[data-del-query]', tabContentEl).forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.delQuery;
        s.query.splice(i, 1);
        renderParamsTab(s);
        updateSnippets();
      });
    });
  }

  function renderHeadersTab(s) {
    tabContentEl.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-xs font-semibold text-muted">Headers</h4>
          <button type="button" class="text-xs text-accent hover:underline" id="add-header-btn">+ Tambah Header</button>
        </div>
        <table class="kv">
          <thead>
            <tr class="border-b border-line/10">
              <th class="w-8"></th>
              <th class="w-1/3">Header</th>
              <th>Value</th>
              <th class="w-8"></th>
            </tr>
          </thead>
          <tbody id="headers-table-body">
            ${(s.headers || [])
              .map(
                (h, i) => `
              <tr class="border-b border-line/5">
                <td class="text-center"><input type="checkbox" class="check" data-idx="${i}" data-field="enabled" ${h.enabled ? 'checked' : ''} /></td>
                <td><input type="text" data-idx="${i}" data-field="key" value="${esc(h.key)}" placeholder="Content-Type" /></td>
                <td><input type="text" data-idx="${i}" data-field="value" value="${esc(h.value)}" placeholder="application/json" /></td>
                <td class="text-center"><button type="button" class="text-muted hover:text-bad px-1" data-del-header="${i}">×</button></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;

    $('#add-header-btn')?.addEventListener('click', () => {
      s.headers.push({ key: '', value: '', enabled: true });
      renderHeadersTab(s);
      updateSnippets();
    });

    $$('#headers-table-body input', tabContentEl).forEach((inp) => {
      inp.addEventListener('input', () => {
        const i = +inp.dataset.idx;
        const f = inp.dataset.field;
        if (f === 'enabled') s.headers[i].enabled = inp.checked;
        else s.headers[i][f] = inp.value;
        updateSnippets();
      });
    });

    $$('[data-del-header]', tabContentEl).forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.delHeader;
        s.headers.splice(i, 1);
        renderHeadersTab(s);
        updateSnippets();
      });
    });
  }

  function renderBodyTab(s) {
    const b = s.body || { mode: 'none' };
    tabContentEl.innerHTML = `
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div class="seg" id="body-mode-seg">
            <button type="button" data-mode="none" ${b.mode === 'none' ? 'aria-selected="true"' : ''}>None</button>
            <button type="button" data-mode="json" ${b.mode === 'json' ? 'aria-selected="true"' : ''}>JSON</button>
            <button type="button" data-mode="urlencoded" ${b.mode === 'urlencoded' ? 'aria-selected="true"' : ''}>Form URL-encoded</button>
            <button type="button" data-mode="formdata" ${b.mode === 'formdata' ? 'aria-selected="true"' : ''}>Form Data</button>
            <button type="button" data-mode="raw" ${b.mode === 'raw' ? 'aria-selected="true"' : ''}>Raw Text</button>
          </div>
          ${b.mode === 'json' ? '<button type="button" class="btn btn-ghost px-2 py-1 text-xs" id="fmt-json-btn">Prettify JSON</button>' : ''}
        </div>

        ${
          b.mode === 'none'
            ? '<p class="text-xs text-muted py-4">Request ini tidak mengirim request body.</p>'
            : b.mode === 'json'
            ? `<textarea id="body-json-input" rows="8" class="field font-mono text-xs leading-relaxed" spellcheck="false" placeholder="{\n  &quot;key&quot;: &quot;value&quot;\n}">${esc(b.raw || '')}</textarea>`
            : b.mode === 'raw'
            ? `<textarea id="body-raw-input" rows="8" class="field font-mono text-xs leading-relaxed" spellcheck="false">${esc(b.raw || '')}</textarea>`
            : `<div class="text-xs text-muted p-2">Dukungan Form key-value mode aktif (${b.mode}).</div>`
        }
      </div>
    `;

    $$('#body-mode-seg button').forEach((btn) => {
      btn.addEventListener('click', () => {
        s.body.mode = btn.dataset.mode;
        renderBodyTab(s);
        updateSnippets();
      });
    });

    $('#fmt-json-btn')?.addEventListener('click', () => {
      const parsed = parseJSON(s.body.raw);
      if (parsed !== undefined) {
        s.body.raw = JSON.stringify(parsed, null, 2);
        $('#body-json-input').value = s.body.raw;
        updateSnippets();
      }
    });

    $('#body-json-input')?.addEventListener('input', (e) => {
      s.body.raw = e.target.value;
      updateSnippets();
    });

    $('#body-raw-input')?.addEventListener('input', (e) => {
      s.body.raw = e.target.value;
      updateSnippets();
    });
  }

  function renderAuthTab(s) {
    const a = s.auth || { type: 'none' };
    tabContentEl.innerHTML = `
      <div class="space-y-4 max-w-md">
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">Tipe Autentikasi</label>
          <select id="auth-type-select" class="field text-xs">
            <option value="none" ${a.type === 'none' ? 'selected' : ''}>No Auth</option>
            <option value="bearer" ${a.type === 'bearer' ? 'selected' : ''}>Bearer Token</option>
            <option value="basic" ${a.type === 'basic' ? 'selected' : ''}>Basic Auth</option>
            <option value="apikey" ${a.type === 'apikey' ? 'selected' : ''}>API Key</option>
          </select>
        </div>

        ${
          a.type === 'bearer'
            ? `
          <div>
            <label class="mb-1 block text-xs font-medium text-muted">Token (mendukung {{token}})</label>
            <input type="text" id="auth-token-input" class="field font-mono text-xs" value="${esc(a.token || '')}" placeholder="{{token}}" />
          </div>
        `
            : a.type === 'basic'
            ? `
          <div class="space-y-2">
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">Username</label>
              <input type="text" id="auth-basic-u" class="field text-xs" value="${esc(a.username || '')}" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">Password</label>
              <input type="password" id="auth-basic-p" class="field text-xs" value="${esc(a.password || '')}" />
            </div>
          </div>
        `
            : a.type === 'apikey'
            ? `
          <div class="space-y-2">
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">Key Name</label>
              <input type="text" id="auth-key-name" class="field text-xs" value="${esc(a.key || 'X-API-Key')}" />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">Value</label>
              <input type="text" id="auth-key-val" class="field font-mono text-xs" value="${esc(a.value || '')}" />
            </div>
          </div>
        `
            : ''
        }
      </div>
    `;

    $('#auth-type-select')?.addEventListener('change', (e) => {
      s.auth.type = e.target.value;
      renderAuthTab(s);
      updateSnippets();
    });

    $('#auth-token-input')?.addEventListener('input', (e) => {
      s.auth.token = e.target.value;
      updateSnippets();
    });
  }

  // Code snippets update
  function updateSnippets() {
    if (!currentReq) return;
    const s = getState(currentReq);
    const built = buildRequest(
      {
        method: methodSelect.value,
        url: urlInput.value,
        query: s.query,
        pathVars: s.pathVars,
        headers: s.headers,
        body: s.body,
        auth: s.auth,
      },
      variables
    );

    const snipFn = SNIPPETS[activeSnippetLang] || SNIPPETS.curl;
    snippetViewer.textContent = snipFn(built);

    // Update URL bar highlight
    $('#url-resolved-preview').innerHTML = highlightVars(built.url, variables);
  }

  // Send Request
  async function triggerSend() {
    if (!currentReq) return;
    const s = getState(currentReq);

    sendBtn.disabled = true;
    sendBtn.textContent = 'Mengirim...';
    statusBadge.textContent = 'loading';
    statusBadge.className = 'badge text-muted';
    resViewer.innerHTML = '<div class="p-6 text-center text-xs text-muted animate-blink">Memuat response dari server...</div>';

    const built = buildRequest(
      {
        method: methodSelect.value,
        url: urlInput.value,
        query: s.query,
        pathVars: s.pathVars,
        headers: s.headers,
        body: s.body,
        auth: s.auth,
      },
      variables
    );

    const res = await send(built);
    lastResponse = res;

    // Auto capture token if present
    const captured = findToken(res.json);
    if (captured) {
      variables.token = captured;
      localStorage.setItem(storageKey, JSON.stringify(variables));
      window.__PLAYGROUND_VARS__ = variables;
      showToast(`Token otomatis disimpan ke {{token}}`);
    }

    // Save to history
    history.unshift({
      id: currentReq.id,
      name: currentReq.name,
      method: built.method,
      url: built.url,
      status: res.status,
      time: Date.now(),
    });
    if (history.length > 50) history.pop();
    localStorage.setItem(`apg_hist_${project.slug}`, JSON.stringify(history));

    renderResponse(res);
    sendBtn.disabled = false;
    sendBtn.innerHTML = '<span>Kirim</span> <kbd class="kbd text-[9.5px]">Ctrl+Enter</kbd>';

    // Notify terminal or other listeners
    window.dispatchEvent(new CustomEvent('playground:requestsent', { detail: { req: built, res } }));
  }

  function renderResponse(res) {
    if (res.error) {
      statusBadge.textContent = 'Gagal';
      statusBadge.className = 'badge text-bad';
      timeBadge.textContent = `${res.ms}ms`;
      sizeBadge.textContent = '0 B';
      resViewer.innerHTML = `
        <div class="p-4 rounded-lg bg-bad/10 border border-bad/20 text-xs text-bad space-y-1">
          <p class="font-bold">${esc(res.message)}</p>
          ${res.hint ? `<p class="text-muted">${esc(res.hint)}</p>` : ''}
        </div>
      `;
      return;
    }

    const tone = statusTone(res.status);
    statusBadge.textContent = `${res.status} ${res.statusText}`;
    statusBadge.className = `badge font-bold ${tone === 'ok' ? 'text-ok bg-ok/10' : tone === 'warn' ? 'text-warn bg-warn/10' : 'text-bad bg-bad/10'}`;
    timeBadge.textContent = `${res.ms}ms`;
    sizeBadge.textContent = fmtSize(res.size);

    if (activeResTab === 'pretty') {
      if (res.json !== undefined) {
        resViewer.innerHTML = `<pre class="code font-mono text-[11.5px] leading-relaxed">${highlightJSON(JSON.stringify(res.json, null, 2))}</pre>`;
      } else {
        resViewer.innerHTML = `<pre class="code font-mono text-[11.5px]">${esc(res.text)}</pre>`;
      }
    } else if (activeResTab === 'raw') {
      resViewer.innerHTML = `<pre class="code font-mono text-[11.5px]">${esc(res.text)}</pre>`;
    } else if (activeResTab === 'headers') {
      resViewer.innerHTML = `
        <div class="p-3 font-mono text-xs space-y-1">
          ${res.headers.map(([k, v]) => `<div><span class="text-muted font-semibold">${esc(k)}:</span> <span class="text-fg">${esc(v)}</span></div>`).join('')}
        </div>
      `;
    }
  }

  function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'fixed top-4 right-4 z-50 rounded-xl glass px-4 py-2.5 text-xs font-medium text-fg shadow-window border border-line/15 animate-pop';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  // Bind Events
  sendBtn?.addEventListener('click', triggerSend);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      triggerSend();
    }
  });

  methodSelect?.addEventListener('change', () => {
    if (currentReq) getState(currentReq).method = methodSelect.value;
    updateSnippets();
  });

  urlInput?.addEventListener('input', () => {
    if (currentReq) getState(currentReq).url = urlInput.value;
    updateSnippets();
  });

  searchInput?.addEventListener('input', (e) => {
    renderNav(e.target.value);
  });

  $$('.req-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      renderRequestTabs();
    });
  });

  $$('.res-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeResTab = btn.dataset.resTab;
      $$('.res-tab-btn').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.resTab === activeResTab)));
      if (lastResponse) renderResponse(lastResponse);
    });
  });

  $$('#snip-lang-select button').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeSnippetLang = btn.dataset.lang;
      $$('#snip-lang-select button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.lang === activeSnippetLang)));
      updateSnippets();
    });
  });

  $('#copy-res-btn')?.addEventListener('click', () => {
    if (!lastResponse) return;
    navigator.clipboard.writeText(lastResponse.text);
    showToast('Response tersalin ke clipboard!');
  });

  $('#copy-snip-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(snippetViewer.textContent || '');
    showToast('Code snippet tersalin ke clipboard!');
  });

  // Environment Modal
  function openEnvModal() {
    envTable.innerHTML = Object.entries(variables)
      .map(
        ([k, v]) => `
      <tr class="border-b border-line/10">
        <td><input type="text" class="field py-1 font-mono text-xs" data-env-k value="${esc(k)}" /></td>
        <td><input type="text" class="field py-1 font-mono text-xs" data-env-v value="${esc(v)}" /></td>
        <td class="text-center"><button type="button" class="text-muted hover:text-bad px-1" data-env-del="${esc(k)}">×</button></td>
      </tr>
    `
      )
      .join('');

    $$('[data-env-del]', envTable).forEach((btn) => {
      btn.addEventListener('click', () => {
        delete variables[btn.dataset.envDel];
        openEnvModal();
      });
    });

    envModal.classList.remove('hidden');
  }

  $('#env-btn')?.addEventListener('click', openEnvModal);
  $('#close-env-btn')?.addEventListener('click', () => envModal.classList.add('hidden'));
  $('#add-env-row-btn')?.addEventListener('click', () => {
    variables['newVar'] = '';
    openEnvModal();
  });

  $('#save-env-btn')?.addEventListener('click', () => {
    const newVars = {};
    const rows = $$('tr', envTable);
    rows.forEach((r) => {
      const k = $('[data-env-k]', r)?.value?.trim();
      const v = $('[data-env-v]', r)?.value ?? '';
      if (k) newVars[k] = v;
    });
    variables = newVars;
    localStorage.setItem(storageKey, JSON.stringify(variables));
    window.__PLAYGROUND_VARS__ = variables;
    envModal.classList.add('hidden');
    updateSnippets();
    showToast('Variabel lingkungan tersimpan!');
  });

  // Deep Link
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.slice(1);
    if (hash) selectEndpoint(hash);
  });

  // Initial load
  renderNav();
  const initId = window.location.hash.slice(1) || flatEndpoints[0]?.id;
  if (initId) selectEndpoint(initId);
}
