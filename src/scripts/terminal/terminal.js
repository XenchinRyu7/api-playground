import { send, parseCurl, buildRequest, highlightJSON, fmtSize, statusTone, esc, parseJSON } from '../core/http.js';

export class Terminal {
  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.options = options;
    this.history = JSON.parse(localStorage.getItem('apg_term_history') || '[]');
    this.historyIndex = -1;
    this.context = {
      project: options.project || null,
      folder: null,
      variables: { ...(options.variables || {}) },
    };
    this.initDOM();
    this.bindEvents();
    if (options.autoBoot !== false) {
      this.boot();
    }
  }

  setProject(project, vars = {}) {
    this.context.project = project;
    this.context.folder = null;
    this.context.variables = { ...vars };
    this.updatePrompt();
  }

  initDOM() {
    this.container.classList.add('term', 'flex', 'flex-col', 'h-full', 'overflow-hidden');
    this.container.innerHTML = `
      <div class="flex items-center justify-between border-b border-line/10 px-4 py-2 text-xs font-mono select-none">
        <div class="flex items-center gap-2">
          <div class="traffic">
            <i class="cursor-pointer" data-term-act="close" title="Tutup"></i>
            <i class="cursor-pointer" data-term-act="min" title="Minimize"></i>
            <i class="cursor-pointer" data-term-act="max" title="Maximize"></i>
          </div>
          <span class="text-muted ml-2">Terminal — <span id="term-pwd">~/</span></span>
        </div>
        <div class="flex items-center gap-2 text-faint text-[11px]">
          <span>Ctrl+\` toggle</span>
          <span>Tab complete</span>
          <button type="button" class="hover:text-fg px-1" data-term-act="clear">Clear</button>
        </div>
      </div>
      <div class="term-screen flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[12.5px] leading-relaxed" id="term-output"></div>
      <div class="border-t border-line/10 p-3 bg-black/5 dark:bg-white/5 flex items-center gap-2">
        <span class="font-mono text-accent text-xs font-bold shrink-0 select-none" id="term-prompt">api-cli $</span>
        <input type="text" id="term-input" class="w-full bg-transparent outline-none font-mono text-xs text-fg placeholder:text-muted" placeholder="Ketik perintah (contoh: help, ls, GET /users, curl...)" autocomplete="off" spellcheck="false" />
      </div>
    `;

    this.outputEl = this.container.querySelector('#term-output');
    this.inputEl = this.container.querySelector('#term-input');
    this.promptEl = this.container.querySelector('#term-prompt');
    this.pwdEl = this.container.querySelector('#term-pwd');
    this.updatePrompt();
  }

  updatePrompt() {
    const slug = this.context.project?.slug || 'home';
    const folder = this.context.folder ? `/${this.context.folder}` : '';
    this.pwdEl.textContent = `~/${slug}${folder}`;
    this.promptEl.textContent = `guest@api ~/${slug}${folder} $`;
  }

  bindEvents() {
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = this.inputEl.value.trim();
        if (val) {
          this.execute(val);
          this.inputEl.value = '';
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.history.length && this.historyIndex < this.history.length - 1) {
          this.historyIndex++;
          this.inputEl.value = this.history[this.history.length - 1 - this.historyIndex] || '';
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.historyIndex > 0) {
          this.historyIndex--;
          this.inputEl.value = this.history[this.history.length - 1 - this.historyIndex] || '';
        } else if (this.historyIndex === 0) {
          this.historyIndex = -1;
          this.inputEl.value = '';
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.autocomplete();
      } else if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.clear();
      } else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
        this.echo(`<span class="t-dim">${this.promptEl.textContent} ${esc(this.inputEl.value)}^C</span>`);
        this.inputEl.value = '';
      }
    });

    this.container.addEventListener('click', (e) => {
      const act = e.target.closest('[data-term-act]')?.dataset?.termAct;
      if (act === 'clear') this.clear();
      else if (act === 'close') this.container.dispatchEvent(new CustomEvent('term:close'));
      else if (act === 'max') this.container.dispatchEvent(new CustomEvent('term:maximize'));
      else this.inputEl.focus();
    });
  }

  echo(html) {
    const div = document.createElement('div');
    div.className = 'term-line';
    div.innerHTML = html;
    this.outputEl.appendChild(div);
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  clear() {
    this.outputEl.innerHTML = '';
  }

  boot() {
    const time = new Date().toLocaleTimeString();
    this.echo(`
      <div class="mb-2 text-xs">
        <span class="t-acc t-b"> macOS API Terminal Engine</span> <span class="t-dim">v1.2.0 [${time}]</span><br>
        <span class="t-mut">Ketik <span class="t-acc">help</span> untuk daftar perintah, atau gunakan <span class="t-acc">Tab</span> untuk autocomplete.</span>
      </div>
    `);
  }

  async execute(rawCmd) {
    this.echo(`<div><span class="t-acc font-semibold">${this.promptEl.textContent}</span> <span class="text-fg font-medium">${esc(rawCmd)}</span></div>`);

    // Add to history
    this.history.push(rawCmd);
    if (this.history.length > 100) this.history.shift();
    localStorage.setItem('apg_term_history', JSON.stringify(this.history));
    this.historyIndex = -1;

    const parts = rawCmd.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    if (rawCmd.trim().startsWith('curl ')) {
      await this.runCurl(rawCmd.trim());
      return;
    }

    switch (cmd) {
      case 'help':
        this.showHelp();
        break;
      case 'clear':
      case 'cls':
        this.clear();
        break;
      case 'theme':
        this.setTheme(args[0]);
        break;
      case 'ls':
      case 'list':
        this.runLs();
        break;
      case 'cd':
        this.runCd(args[0]);
        break;
      case 'open':
        this.runOpen(args[0]);
        break;
      case 'env':
        this.runEnv(args);
        break;
      case 'history':
        this.showHistory();
        break;
      case '!!':
        if (this.history.length > 1) {
          const last = this.history[this.history.length - 2];
          this.execute(last);
        }
        break;
      case 'whoami':
      case 'about':
        this.showAbout();
        break;
      case 'neofetch':
        this.showNeofetch();
        break;
      case 'docs':
        this.showDocs(args.join(' '));
        break;
      case 'snippet':
        this.showSnippet(args[0], args[1]);
        break;
      case 'get':
      case 'post':
      case 'put':
      case 'patch':
      case 'delete':
      case 'head':
      case 'options':
        await this.runHttp(cmd.toUpperCase(), args);
        break;
      default:
        this.echo(`<span class="t-err">Perintah tidak dikenal: "${esc(cmd)}". Ketik <span class="t-acc">help</span> untuk bantuan.</span>`);
    }
  }

  showHelp() {
    this.echo(`
      <div class="text-xs space-y-1.5 my-1">
        <div class="t-acc t-b">Perintah Dasar:</div>
        <div>  <span class="t-teal font-semibold">help</span>               <span class="t-mut">Tampilkan pesan bantuan ini</span></div>
        <div>  <span class="t-teal font-semibold">clear / Ctrl+L</span>     <span class="t-mut">Bersihkan layar terminal</span></div>
        <div>  <span class="t-teal font-semibold">theme [light|dark]</span> <span class="t-mut">Ubah tema antarmuka</span></div>
        <div>  <span class="t-teal font-semibold">neofetch</span>           <span class="t-mut">Info sistem & portfolio</span></div>

        <div class="t-acc t-b mt-2">Navigasi:</div>
        <div>  <span class="t-teal font-semibold">ls</span>                  <span class="t-mut">Daftar project, folder, atau endpoint</span></div>
        <div>  <span class="t-teal font-semibold">cd &lt;project|folder&gt;</span> <span class="t-mut">Pindah ke project/folder tertentu (atau "cd ..")</span></div>
        <div>  <span class="t-teal font-semibold">open &lt;id&gt;</span>          <span class="t-mut">Buka endpoint di panel UI playground</span></div>

        <div class="t-acc t-b mt-2">Uji Coba API:</div>
        <div>  <span class="t-teal font-semibold">GET /path</span>           <span class="t-mut">Kirim request GET langsung</span></div>
        <div>  <span class="t-teal font-semibold">POST /path '{"k":"v"}'</span> <span class="t-mut">Kirim request POST dengan JSON body</span></div>
        <div>  <span class="t-teal font-semibold">curl &lt;command...&gt;</span>    <span class="t-mut">Tempel perintah cURL lengkap dan jalankan langsung</span></div>
        <div>  <span class="t-teal font-semibold">env [set|unset]</span>     <span class="t-mut">Lihat atau atur variabel lingkungan (mis. baseUrl, token)</span></div>
        <div>  <span class="t-teal font-semibold">docs &lt;id&gt;</span>          <span class="t-mut">Lihat dokumentasi deskripsi & contoh response</span></div>
        <div>  <span class="t-teal font-semibold">snippet &lt;id&gt; [lang]</span>  <span class="t-mut">Generate code snippet (curl, fetch, python, go, php)</span></div>
      </div>
    `);
  }

  setTheme(mode) {
    if (!['light', 'dark', 'system'].includes(mode)) {
      this.echo(`<span class="t-err">Gunakan: theme light | dark | system</span>`);
      return;
    }
    if (window.__theme) window.__theme.set(mode);
    this.echo(`<span class="t-ok">Tema diubah ke: ${mode}</span>`);
  }

  showAbout() {
    this.echo(`
      <div class="text-xs space-y-1 my-1">
        <span class="t-acc t-b">Portfolio API Playground</span><br>
        <span class="t-mut">Interactive macOS/iOS inspired API developer portfolio. Built with Astro, Tailwind, and Vanilla JS.</span>
      </div>
    `);
  }

  showNeofetch() {
    const slug = this.context.project?.slug || 'home';
    const epCount = this.context.project?.endpointCount || 0;
    this.echo(`
      <div class="flex gap-4 my-2 text-xs">
        <div class="text-accent font-mono select-none font-bold hidden sm:block">
           .:'
         __ :'__
      .'\`__\`-'__\`\`.
     :__________.-'
     :_________:
      :_________'-.
       \`.__.-.__.'
        </div>
        <div class="space-y-0.5 font-mono">
          <div><span class="t-acc t-b">guest</span>@<span class="t-acc t-b">api-playground</span></div>
          <div class="t-dim">------------------------</div>
          <div><span class="t-teal">OS:</span> macOS API Engine (Darwin x86_64 Web)</div>
          <div><span class="t-teal">Host:</span> Vercel Serverless / Edge</div>
          <div><span class="t-teal">Current Project:</span> ${esc(slug)}</div>
          <div><span class="t-teal">Endpoints:</span> ${epCount} total</div>
          <div><span class="t-teal">Theme:</span> ${document.documentElement.dataset.theme || 'auto'}</div>
          <div><span class="t-teal">Shell:</span> api-sh 1.2</div>
          <div class="mt-2 flex gap-1">
            <span class="inline-block h-3 w-3 bg-bad rounded-sm"></span>
            <span class="inline-block h-3 w-3 bg-warn rounded-sm"></span>
            <span class="inline-block h-3 w-3 bg-yellow rounded-sm"></span>
            <span class="inline-block h-3 w-3 bg-ok rounded-sm"></span>
            <span class="inline-block h-3 w-3 bg-teal rounded-sm"></span>
            <span class="inline-block h-3 w-3 bg-accent rounded-sm"></span>
            <span class="inline-block h-3 w-3 bg-purple rounded-sm"></span>
          </div>
        </div>
      </div>
    `);
  }

  runLs() {
    const p = this.context.project;
    if (!p) {
      this.echo(`<span class="t-mut">Gunakan di dalam project playground (/p/slug). Ketik <span class="t-acc">cd &lt;slug&gt;</span> untuk berpindah project.</span>`);
      return;
    }

    const items = p.items || [];
    let lines = [];
    const walk = (list, prefix = '') => {
      list.forEach((it) => {
        if (it.kind === 'folder') {
          lines.push(`📁 <span class="t-acc font-semibold">${prefix}${it.name}/</span>`);
          walk(it.items || [], `${prefix}  `);
        } else {
          lines.push(`  <span class="verb v-${it.method.toLowerCase()} text-[10px]">${it.method}</span> <span class="text-fg">${esc(it.name)}</span> <span class="t-dim">(${it.id})</span>`);
        }
      });
    };
    walk(items);
    this.echo(`<div class="space-y-0.5 text-xs">${lines.join('<br>')}</div>`);
  }

  runCd(target) {
    if (!target || target === '~' || target === '/') {
      this.context.folder = null;
      this.updatePrompt();
      return;
    }
    if (target === '..') {
      this.context.folder = null;
      this.updatePrompt();
      return;
    }
    this.context.folder = target;
    this.updatePrompt();
    this.echo(`<span class="t-mut">Pindah ke: ${esc(target)}</span>`);
  }

  runOpen(id) {
    if (!id) {
      this.echo(`<span class="t-err">Gunakan: open &lt;endpoint-id&gt;</span>`);
      return;
    }
    window.location.hash = id;
    this.echo(`<span class="t-ok">Membuka endpoint #${esc(id)} di playground...</span>`);
  }

  runEnv(args) {
    const [sub, k, ...vParts] = args;
    if (!sub) {
      // List
      const vars = this.context.variables;
      const keys = Object.keys(vars);
      if (!keys.length) {
        this.echo(`<span class="t-mut">Tidak ada variabel lingkungan tersimpan. Gunakan: env set &lt;key&gt; &lt;val&gt;</span>`);
        return;
      }
      const lines = keys.map((key) => `<div>  <span class="t-teal font-mono">${esc(key)}</span> = <span class="text-fg font-mono">"${esc(vars[key])}"</span></div>`);
      this.echo(`<div class="text-xs space-y-0.5"><div class="t-acc t-b">Variabel Lingkungan:</div>${lines.join('')}</div>`);
    } else if (sub === 'set') {
      const v = vParts.join(' ');
      if (!k) return this.echo(`<span class="t-err">Gunakan: env set &lt;key&gt; &lt;val&gt;</span>`);
      this.context.variables[k] = v;
      this.container.dispatchEvent(new CustomEvent('term:envchange', { detail: this.context.variables }));
      this.echo(`<span class="t-ok">Variabel "${esc(k)}" diset.</span>`);
    } else if (sub === 'unset') {
      delete this.context.variables[k];
      this.container.dispatchEvent(new CustomEvent('term:envchange', { detail: this.context.variables }));
      this.echo(`<span class="t-ok">Variabel "${esc(k)}" dihapus.</span>`);
    }
  }

  showHistory() {
    const lines = this.history.map((h, i) => `<div>  <span class="t-dim">${i + 1}</span>  ${esc(h)}</div>`);
    this.echo(`<div class="text-xs space-y-0.5 max-h-48 overflow-y-auto">${lines.join('')}</div>`);
  }

  async runCurl(curlStr) {
    this.echo(`<span class="t-dim">Memparsing dan mengirim curl...</span>`);
    try {
      const req = parseCurl(curlStr);
      const built = buildRequest(req, this.context.variables);
      const res = await send(built);
      this.renderResponse(built, res);
    } catch (e) {
      this.echo(`<span class="t-err">Gagal: ${esc(e.message)}</span>`);
    }
  }

  async runHttp(method, args) {
    let path = args[0] || '/';
    let bodyText = args.slice(1).join(' ').trim();
    if (bodyText.startsWith("'") && bodyText.endsWith("'")) bodyText = bodyText.slice(1, -1);

    const baseUrl = this.context.variables.baseUrl || '';
    let fullUrl = path.startsWith('http') ? path : `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

    const req = {
      method,
      url: fullUrl,
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      body: bodyText ? { mode: 'json', raw: bodyText } : { mode: 'none' },
    };

    const built = buildRequest(req, this.context.variables);
    this.echo(`<span class="t-dim">Mengirim ${method} ${esc(built.url)}...</span>`);
    const res = await send(built);
    this.renderResponse(built, res);
  }

  renderResponse(req, res) {
    if (res.error) {
      this.echo(`
        <div class="rounded bg-bad/10 p-2 text-xs border border-bad/20">
          <span class="t-err font-bold">Request Gagal:</span> ${esc(res.message)}<br>
          ${res.hint ? `<span class="t-dim">${esc(res.hint)}</span>` : ''}
        </div>
      `);
      return;
    }

    const tone = statusTone(res.status);
    const toneClass = tone === 'ok' ? 't-ok' : tone === 'warn' ? 't-warn' : 't-err';

    let preview = '';
    if (res.json !== undefined) {
      preview = highlightJSON(JSON.stringify(res.json, null, 2));
    } else {
      preview = esc(res.text.slice(0, 800));
    }

    this.echo(`
      <div class="my-1.5 rounded-lg border border-line/15 bg-black/10 dark:bg-black/30 p-2.5 text-xs space-y-1.5">
        <div class="flex items-center justify-between border-b border-line/10 pb-1.5">
          <div class="flex items-center gap-2">
            <span class="font-bold ${toneClass}">${res.status} ${esc(res.statusText)}</span>
            <span class="t-dim">·</span>
            <span class="t-mut">${res.ms}ms</span>
            <span class="t-dim">·</span>
            <span class="t-mut">${fmtSize(res.size)}</span>
          </div>
          <span class="t-dim text-[11px]">${esc(req.method)} ${esc(req.url)}</span>
        </div>
        <pre class="overflow-x-auto max-h-60 leading-relaxed font-mono text-[11.5px]">${preview}</pre>
      </div>
    `);

    // Broadcast event so UI can log or capture token
    this.container.dispatchEvent(new CustomEvent('term:requestsent', { detail: { req, res } }));
  }

  autocomplete() {
    const val = this.inputEl.value;
    const cmds = ['help', 'clear', 'theme', 'ls', 'cd', 'open', 'env', 'history', 'docs', 'snippet', 'neofetch', 'whoami', 'GET', 'POST', 'PUT', 'DELETE', 'curl'];
    const matched = cmds.filter((c) => c.toLowerCase().startsWith(val.toLowerCase()));
    if (matched.length === 1) {
      this.inputEl.value = matched[0] + ' ';
    } else if (matched.length > 1) {
      this.echo(`<div class="t-dim text-xs">${matched.join('   ')}</div>`);
    }
  }
}
