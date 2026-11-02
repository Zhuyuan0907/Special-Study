// 問 AI：在網站裡問 Claude 關於自己的學校、簡章的問題。
// 兩種接法（設定 › 問 AI）：
//   cli：這台電腦的 Claude Code（claude -p）。關掉所有內建工具（--tools ""），只給 scripts/ai-mcp.js 這個 MCP 伺服器（唯讀，經過本伺服器查資料）。
//   api：Anthropic API Key。伺服器自己跑工具迴圈（Node 內建 fetch，不用 npm install）。
// 兩邊用同一組工具（TOOLS／runTool）：只能查使用者的紀錄和簡章全文，不能讀別的檔案、不能改紀錄、不能執行指令。
// 資料：DATA_DIR/ai.json（設定與對話，原子寫入）、DATA_DIR/secrets.json（API Key，0600）。兩個都不在 git 裡，/data 也不會送出去。
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');

const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const BACKENDS = ['auto', 'cli', 'api', 'off'];
const DEFAULTS = {backend: 'auto', model: 'claude-opus-5-5', effort: 'xhigh'};
const KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;
const CHAT_ID = /^c[a-z0-9]{6,40}$/;
const MAX_Q = 4000, MAX_TURNS = 40, MAX_CHATS = 100, MAX_ITER = 16, RUN_MS = 15 * 60 * 1000;
const API_VERSION = '2026-10-21';
const NOW_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const SYSTEM = `你是「我的特選紀錄」網站裡的助理。使用者是準備 116 學年度大學「特殊選才」的高中生；這個網站記著他加了哪些學校、各校的時程、備審和狀態，也收了各校簡章的全文。

回答的方式
- 用台灣的繁體中文，直接回答，先講結論。一般 2 到 8 行；需要時才列點；不要用表格和標題。
- 日期、時間、名額、要繳的資料、甄選方式、面試規定這些事實，一律先用工具查再回答：他自己的學校用 my_schools、school_detail、upcoming；簡章內容用 search_brochure、read_brochure_pages；還沒加入的系組用 find_programs、program_info。
- 引用簡章要附頁碼。工具結果給了連結就寫成 Markdown 連結，例如 [中興 p.63](/data/brochures/pdf/006.pdf#page=63)；沒有連結就寫「中興簡章 p.63」。
- 簡章沒寫、工具查不到的，就說查不到，建議問招生單位或看招生網，不要猜。
- 日期寫成 11/09（一）17:00 這種格式。
- 每則使用者訊息開頭的〔網站附註〕是網站自動加的（現在時間、他正在看哪一間），不是他打的字。
- 你只能查資料，不能改紀錄；要改的話請他在網站上改。`;

/* ---------- 工具（兩種接法共用） ---------- */
const obj = (props, required = []) => ({type: 'object', properties: props, required, additionalProperties: false});
const TOOLS = [
  {name: 'my_schools', description: '使用者加入的所有學校：狀態、下一步、面試和放榜日期、同一天的面試。回答跟他自己的學校有關的問題時先用這個。', input_schema: obj({})},
  {name: 'school_detail', description: '一間使用者加入的學校的完整資料：全部時程（含附註）、報名勾了哪些、備審清單、筆記、名額、甄選方式、報名資格、簡章頁碼與連結。', input_schema: obj({school: {type: 'string', description: 'app_id，或學校簡稱／名稱（例：中興、中興 資工、國立中興大學）'}}, ['school'])},
  {name: 'upcoming', description: '接下來幾天要處理的事（和網站「接下來」畫面同一套）：截止、面試、名單、放榜，含逾期還沒回答的。', input_schema: obj({days: {type: 'integer', minimum: 1, maximum: 120, description: '看幾天，預設 14'}})},
  {name: 'search_brochure', description: '在簡章全文裡找字，回傳有這些字的頁和前後文。不給 school 就找使用者加入的學校的簡章。多個詞用空白分開，每個詞都要出現在同一頁。', input_schema: obj({query: {type: 'string', description: '要找的詞，例：面試 攜帶、推薦函、身分證'}, school: {type: 'string', description: '學校簡稱、名稱或簡章代碼（三位數字），可省略'}, limit: {type: 'integer', minimum: 1, maximum: 10, description: '最多幾頁，預設 6'}}, ['query'])},
  {name: 'read_brochure_pages', description: '讀簡章某幾頁的全文（一次最多 4 頁）。', input_schema: obj({school: {type: 'string', description: '學校簡稱、名稱或簡章代碼'}, pages: {type: 'array', items: {type: 'integer', minimum: 1}, minItems: 1, maxItems: 4, description: '頁碼'}}, ['school', 'pages'])},
  {name: 'find_programs', description: '在 116 學年度全部特選系組裡搜尋（學校、系名、簡章裡的字，例：資安、APCS、臺北 資工），回傳系組代碼、名額、甄選方式、報名截止、簡章頁碼。', input_schema: obj({query: {type: 'string'}}, ['query'])},
  {name: 'program_info', description: '一個系組（用 find_programs 拿到的代碼，例：116-006-051）在簡章裡的資料：名額、甄選方式、報名費、全部日期、指定繳交資料、報名資格、頁碼。', input_schema: obj({program_id: {type: 'string'}}, ['program_id'])},
];
const TOOL_NAMES = new Set(TOOLS.map(t => t.name));
// 送 API 用：串流時讓工具參數邊產生邊送（參數很短，主要是照建議）；收到後一律自己檢查格式（validate）。
const API_TOOLS = TOOLS.map(t => ({...t, eager_input_streaming: true}));

function validate(name, input) {
  const t = TOOLS.find(x => x.name === name);
  if (!t) return '沒有這個工具';
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return '參數要是物件';
  const s = t.input_schema;
  for (const k of Object.keys(input)) if (!s.properties[k]) return `不認得的參數 ${k}`;
  for (const k of s.required) if (input[k] === undefined || input[k] === '') return `缺少參數 ${k}`;
  for (const [k, v] of Object.entries(input)) {
    const p = s.properties[k];
    if (p.type === 'string' && (typeof v !== 'string' || v.length > 200)) return `${k} 要是 200 字以內的文字`;
    if (p.type === 'integer' && (!Number.isInteger(v) || v < (p.minimum ?? -Infinity) || v > (p.maximum ?? Infinity))) return `${k} 要是 ${p.minimum}–${p.maximum} 的整數`;
    if (p.type === 'array' && (!Array.isArray(v) || v.length < (p.minItems || 0) || v.length > (p.maxItems || 99) || !v.every(n => Number.isInteger(n) && n >= 1 && n <= 2000))) return `${k} 要是 1–${p.maxItems} 個頁碼`;
  }
  return '';
}

const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
const flat = s => String(s ?? '').replace(/\s+/g, ' ').trim();

function createAI(ctx) {
  const {dataDir, L, DB, alias, search, norm, progOf, logicOpts, getRecords} = ctx;
  const STORE = path.join(dataDir, 'ai.json');
  const SECRETS = path.join(dataDir, 'secrets.json');

  /* ---------- 存檔：設定與對話（ai.json）、API Key（secrets.json） ---------- */
  let store = null, chain = Promise.resolve();
  function loadStore() {
    let d = null;
    try { d = JSON.parse(fs.readFileSync(STORE, 'utf8')); }
    catch (e) {
      if (e.code !== 'ENOENT') { try { fs.renameSync(STORE, `${STORE}.bad-${Date.now()}`); } catch { /* ignore */ } console.warn('data/ai.json 讀不懂，改用新的（舊的改名留著）'); }
    }
    const s = d && typeof d === 'object' ? d : {};
    store = {version: 1, settings: cleanSettings(s.settings || {}), chats: Array.isArray(s.chats) ? s.chats.filter(c => c && CHAT_ID.test(c.id) && Array.isArray(c.turns)) : []};
  }
  function cleanSettings(s) {
    return {backend: BACKENDS.includes(s.backend) ? s.backend : DEFAULTS.backend, model: MODELS.includes(s.model) ? s.model : DEFAULTS.model, effort: EFFORTS.includes(s.effort) ? s.effort : DEFAULTS.effort};
  }
  async function writeAtomic(file, text, mode) {
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, text, mode ? {mode} : undefined);
    await fsp.rename(tmp, file);
  }
  function saveStore() {
    const text = JSON.stringify(store);
    chain = chain.catch(() => {}).then(() => writeAtomic(STORE, text));
    return chain;
  }
  const readSecrets = () => { try { return JSON.parse(fs.readFileSync(SECRETS, 'utf8')) || {}; } catch { return {}; } };
  const apiKey = () => (process.env.ANTHROPIC_API_KEY || '').trim() || (KEY_RE.test(readSecrets().anthropicApiKey || '') ? readSecrets().anthropicApiKey : '');
  function keyInfo() {
    const env = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (env) return {set: true, source: 'env', hint: '…' + env.slice(-4)};
    const k = readSecrets().anthropicApiKey;
    return KEY_RE.test(k || '') ? {set: true, source: 'file', hint: '…' + k.slice(-4)} : {set: false, source: '', hint: ''};
  }
  async function setKey(key) {
    const s = readSecrets();
    if (key) s.anthropicApiKey = key; else delete s.anthropicApiKey;
    await writeAtomic(SECRETS, JSON.stringify(s, null, 2), 0o600);
    try { fs.chmodSync(SECRETS, 0o600); } catch { /* Windows */ }
  }

  /* ---------- 這台電腦的 Claude Code ---------- */
  function findClaude() {
    const home = os.homedir();
    const cands = [process.env.CLAUDE_BIN, ...String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(d => path.join(d, 'claude')),
      path.join(home, '.local/bin/claude'), path.join(home, '.claude/local/claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude', '/usr/bin/claude'].filter(Boolean);
    for (const c of cands) { try { fs.accessSync(c, fs.constants.X_OK); if (fs.statSync(c).isFile()) return c; } catch { /* next */ } }
    return '';
  }
  // 子程序只拿到需要的環境變數：systemd 底下可能沒有 HOME（claude 要靠它找登入資料）；API Key 不給（Claude Code 用自己的登入）
  function childEnv(extra = {}) {
    const home = os.homedir();
    const env = {PATH: [String(process.env.PATH || '/usr/local/bin:/usr/bin:/bin'), path.join(home, '.local/bin')].join(path.delimiter), HOME: home, LANG: process.env.LANG || 'C.UTF-8'};
    for (const k of ['USER', 'LOGNAME', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'CLAUDE_CONFIG_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE']) if (process.env[k]) env[k] = process.env[k];
    return {...env, ...extra};
  }
  let cliCache = null;
  function cliStatus(fresh = false) {
    if (!fresh && cliCache && Date.now() - cliCache.at < 5 * 60 * 1000) return Promise.resolve(cliCache.v);
    const bin = findClaude();
    if (!bin) { cliCache = {at: Date.now(), v: {found: false, loggedIn: false}}; return Promise.resolve(cliCache.v); }
    return new Promise(resolve => {
      let out = '';
      let ch;
      try { ch = spawn(bin, ['auth', 'status'], {cwd: os.tmpdir(), env: childEnv(), stdio: ['ignore', 'pipe', 'ignore']}); }
      catch { resolve({found: true, loggedIn: false}); return; }
      const t = setTimeout(() => ch.kill('SIGKILL'), 15000);
      ch.stdout.on('data', d => { out += d; });
      ch.on('error', () => {});
      ch.on('close', () => {
        clearTimeout(t);
        let j = null;
        try { j = JSON.parse(out); } catch { /* 舊版沒有 JSON */ }
        const v = {found: true, loggedIn: !!(j && j.loggedIn), method: j && typeof j.authMethod === 'string' ? j.authMethod : ''};
        cliCache = {at: Date.now(), v};
        resolve(v);
      });
    });
  }
  async function pickBackend() {
    const s = store.settings.backend;
    if (s === 'off') return '';
    if (s === 'api') return apiKey() ? 'api' : '';
    const cli = await cliStatus();
    if (s === 'cli') return cli.loggedIn ? 'cli' : '';
    return cli.loggedIn ? 'cli' : apiKey() ? 'api' : '';
  }

  /* ---------- 工具的實作（唯讀） ---------- */
  const recs = () => getRecords() || {apps: []};
  const apps = () => (recs().apps || []).filter(a => a && typeof a === 'object');
  const opts = () => ({...logicOpts(), apps: apps(), programs: progOf});
  const nameOf = a => L.appName(a, apps(), alias);
  const codeOfApp = a => { const p = progOf(a.programId); if (p && p.code) return p.code; const s = DB.schools.find(x => x.name === a.school); return s ? s.code : ''; };
  const schoolByCode = code => DB.schools.find(s => s.code === code) || null;
  const shortOfCode = code => { const s = schoolByCode(code); return s ? L.shortSchool(s.name, alias) : code; };
  const hasPdf = code => (DB.meta.pdfSchools || []).includes(code);
  const pdfUrl = (code, page) => hasPdf(code) ? `/data/brochures/pdf/${code}.pdf#page=${page}` : '';
  const pageRef = (code, page) => { const u = pdfUrl(code, page); return `${shortOfCode(code)} p.${page}${u ? ` ${u}` : ''}`; };
  const when = (date, time) => date ? `${L.fmtDate(date)}${time ? ' ' + time : ''}` : '';

  function resolveApps(q) {
    const s = String(q || '').trim(), list = apps();
    if (!s) return [];
    const byId = list.filter(a => a.id === s);
    if (byId.length) return byId;
    const n = norm(s);
    const exact = list.filter(a => norm(nameOf(a)) === n);
    if (exact.length) return exact;
    const sch = list.filter(a => norm(L.shortSchool(a.school, alias)) === n || norm(a.school) === n || (alias[s] && a.school === alias[s]));
    if (sch.length) return sch;
    return list.filter(a => norm(`${a.school}${a.dept}${nameOf(a)}`).includes(n) || norm(nameOf(a)).includes(n));
  }
  function resolveCodes(q) {
    const s = String(q || '').trim();
    if (!s) return [];
    if (/^\d{3}$/.test(s) && schoolByCode(s)) return [s];
    const n = norm(s);
    const full = alias[s] || alias[s.split(/\s+/)[0]];
    if (full) { const sc = DB.schools.find(x => x.name === full); if (sc) return [sc.code]; }
    const exact = DB.schools.filter(x => x.name === s || norm(L.shortSchool(x.name, alias)) === n);
    if (exact.length) return exact.map(x => x.code);
    const viaApps = [...new Set(resolveApps(s).map(codeOfApp).filter(Boolean))];
    if (viaApps.length) return viaApps;
    return DB.schools.filter(x => norm(x.name).includes(n)).slice(0, 3).map(x => x.code);
  }
  // 同一天的面試（準備中的也算）：{date: [名字]}
  function goDays(now) {
    const by = new Map(), c = now.slice(0, 10);
    for (const a of apps()) {
      if (a.ivSkip || ['ended'].includes(L.displayStage(a, progOf(a.programId), now))) continue;
      for (const e of L.eventsOf(a, progOf(a.programId))) if (e.role === 'go' && e.date >= c) { const s = by.get(e.date) || new Set(); s.add(L.shortSchool(a.school, alias)); by.set(e.date, s); }
    }
    return [...by].filter(([, s]) => s.size > 1).sort(([a], [b]) => a.localeCompare(b));
  }
  function rowText(r, now) {
    const tt = L.timeText(r, now);
    const parts = (r.parts || []).filter(p => !p.opt).map(p => `${p.name}${p.done ? '（已勾）' : ''}`).join('・');
    return `${L.fmtDate(r.date)}${tt ? ' ' + tt : ''} ${r.role === 'reg' && parts ? parts : r.label}${r.overdue ? '［逾期／還沒回答］' : ''}${r.tentative ? '［要先過名單］' : ''}`;
  }
  function tMySchools(_, now) {
    const list = apps();
    if (!list.length) return '使用者還沒有加入任何學校。';
    const {active, ended} = L.orderApps(list, progOf, now);
    const line = a => {
      const p = progOf(a.programId), evs = L.eventsOf(a, p);
      const nx = L.nextStep(a, p, now, opts());
      const go = evs.filter(e => e.role === 'go').map(e => `${e.label} ${when(e.date, e.time)}${e.end ? '～' + L.md(e.end) : ''}`);
      const rel = evs.filter(e => e.role === 'release').map(e => `放榜 ${when(e.date, e.time)}`);
      const code = codeOfApp(a);
      return `- ${nameOf(a)}｜${a.school} ${a.dept || ''}｜${L.statusWord(a, p, now)}｜app_id=${a.id}${code ? `｜簡章代碼 ${code}` : ''}\n  下一步：${nx ? rowText(nx, now) : '沒有'}${go.length ? `\n  ${go.join('；')}` : ''}${rel.length ? `；${rel.join('；')}` : ''}`;
    };
    const same = goDays(now);
    return [`現在：${now.replace('T', ' ')}（台北）`, `進行中（${active.length} 間）：`, ...active.map(line),
      ended.length ? `已結束（${ended.length} 間）：\n${ended.map(a => `- ${nameOf(a)}｜${L.statusWord(a, progOf(a.programId), now)}｜app_id=${a.id}`).join('\n')}` : '',
      same.length ? `同一天的面試：${same.map(([d, s]) => `${L.fmtDate(d)} ${[...s].join('、')}`).join('；')}` : ''].filter(Boolean).join('\n');
  }
  function programFacts(p) {
    if (!p) return [];
    const out = [];
    if (p.q != null) out.push(`招生名額：${p.q}`);
    const it = (p.it || []).filter(i => i && i[0]).map(([n, w]) => w != null && w !== '' ? `${n} ${w}%` : n);
    if (it.length) out.push(`甄選方式：${it.join('、')}`);
    if (p.fee) out.push(`報名費：${p.fee}`);
    if (Array.isArray(p.docs) && p.docs.length) out.push(`簡章的指定繳交資料：\n${p.docs.map(d => `  - ${flat(d)}`).join('\n')}`);
    if (p.qx) out.push(`報名資格（簡章 p.${p.qxp || '?'}）：${clip(flat(p.qx), 700)}`);
    if (p.cw) out.push(`報到：${clip(flat(p.cw), 300)}`);
    if (p.nt) out.push(`附註：${clip(flat(p.nt), 300)}`);
    const code = p.code;
    if (code && Array.isArray(p.pg) && p.pg.length) out.push(`這個系組在簡章的頁：${p.pg.map(n => `p.${n}${pdfUrl(code, n) ? ' ' + pdfUrl(code, n) : ''}`).join('、')}`);
    const links = (DB.links && DB.links[code]) || {};
    const l = [links.apply && `報名系統 ${links.apply}`, links.adm && `招生網 ${links.adm}`, p.du && `系網 ${p.du}`].filter(Boolean);
    if (l.length) out.push(l.join('｜'));
    return out;
  }
  function tSchoolDetail({school}, now) {
    const found = resolveApps(school);
    if (!found.length) return {error: `使用者的學校裡沒有「${school}」。可以用 my_schools 看清單，或用 find_programs 找還沒加的系組。`};
    if (found.length > 3) return {error: `「${school}」對到 ${found.length} 間：${found.map(a => `${nameOf(a)}（app_id=${a.id}）`).join('、')}，請說清楚是哪一間。`};
    return found.map(a => {
      const p = progOf(a.programId);
      const tl = L.timeline(a, p, now, opts());
      const rows = tl.filter(r => !r.gone).map(r => `  - ${when(r.date, r.time)}${r.end ? '～' + L.md(r.end) : ''}${r.from ? `（${L.md(r.from)}${r.fromTime ? ' ' + r.fromTime : ''} 起）` : ''} ${r.raw || r.label}${r.mail === 'postmark' ? '［郵戳為憑］' : r.mail === 'arrive' ? '［寄達為憑］' : ''}${r.next ? '［下一個］' : r.done ? '［做完］' : r.past ? '［過了］' : ''}${r.note ? `｜${flat(r.note)}` : ''}`);
      const steps = (a.regSteps || []).filter(s => s && s.name).map(s => `${s.name}${s.done ? '✓' : '✗'}`);
      const docs = (a.docs || []).filter(d => d && d.name && !d.gone).map(d => `  - ${d.name}${d.opt ? '（選繳）' : ''}${d.done ? ' ✓' : ''}`);
      const rec = L.recordFields(a, p, now).filter(f => f.value).map(f => `${f.label}：${clip(flat(f.value), 300)}`);
      return [`${nameOf(a)}｜${a.school} ${a.dept || ''}｜狀態：${L.statusWord(a, p, now)}｜app_id=${a.id}${p ? `｜系組代碼 ${a.programId}｜簡章代碼 ${p.code}` : ''}`,
        `時程：\n${rows.join('\n') || '  （沒有日期）'}`,
        steps.length ? `報名步驟：${steps.join('　')}` : '',
        docs.length ? `備審清單（✓ 是已準備好）：\n${docs.join('\n')}` : '',
        ...rec, ...programFacts(p)].filter(Boolean).join('\n');
    }).join('\n\n');
  }
  function tUpcoming({days = 14}, now) {
    const end = L.addDays(now.slice(0, 10), days);
    const ag = L.agenda(apps(), progOf, now, opts());
    const rows = ag.rows.filter(r => r.date <= end);
    if (!rows.length) return `接下來 ${days} 天沒有要處理的事。${ag.upcoming ? `下一件：${when(ag.upcoming.date, ag.upcoming.time)} ${ag.upcoming.label}` : ''}`;
    const byId = new Map(apps().map(a => [a.id, a]));
    return [`現在：${now.replace('T', ' ')}；接下來 ${days} 天：`, ...rows.map(r => `- ${rowText(r, now)}｜${byId.get(r.appId) ? nameOf(byId.get(r.appId)) : ''}${r.context ? `｜${r.context}` : ''}${r.note ? `｜${clip(flat(r.note), 160)}` : ''}`)].join('\n');
  }
  function snippets(pg, tokens, n = 2) {
    const out = [];
    for (const t of tokens) {
      const at = pg.norm.indexOf(t);
      if (at < 0) continue;
      const s = pg.map[at], e = pg.map[at + t.length - 1] + 1;
      const from = Math.max(0, s - 90), to = Math.min(pg.text.length, e + 140);
      if (out.some(o => Math.abs(o.s - s) < 150)) continue;
      out.push({s, text: (from > 0 ? '…' : '') + flat(pg.text.slice(from, to)) + (to < pg.text.length ? '…' : '')});
      if (out.length >= n) break;
    }
    return out.map(o => o.text);
  }
  function tSearchBrochure({query, school, limit = 6}) {
    const tokens = String(query).trim().split(/\s+/).map(norm).filter(Boolean);
    if (!tokens.length) return {error: 'query 是空的'};
    let codes;
    if (school) { codes = resolveCodes(school); if (!codes.length) return {error: `找不到「${school}」這間學校的簡章`}; }
    else codes = [...new Set(apps().map(codeOfApp).filter(Boolean))];
    codes = codes.filter(c => DB.pages.has(c));
    if (!codes.length) return {error: '沒有這間學校的簡章全文'};
    // 使用者加入的系組所在的頁加分（同一份簡章裡有很多系）
    const mine = new Map();
    for (const a of apps()) { const p = progOf(a.programId); if (p && p.code) for (const n of p.pg || []) mine.set(`${p.code}:${n}`, 1); }
    const hits = [];
    for (const code of codes) DB.pages.get(code).forEach((pg, i) => {
      let score = 0;
      for (const t of tokens) { let k = 0, at = pg.norm.indexOf(t); while (at >= 0 && k < 20) { k++; at = pg.norm.indexOf(t, at + t.length); } if (!k) return; score += k; }
      hits.push({code, page: i + 1, score: score + (mine.has(`${code}:${i + 1}`) ? 5 : 0), pg});
    });
    if (!hits.length) return `簡章裡沒有同時出現「${tokens.join('」「')}」的頁（找了：${codes.map(shortOfCode).join('、')}）。換個說法再找，或用 read_brochure_pages 讀系組的頁。`;
    hits.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code) || a.page - b.page);
    return hits.slice(0, limit).map(h => `【${pageRef(h.code, h.page)}】\n${snippets(h.pg, tokens).join('\n')}`).join('\n\n') + (hits.length > limit ? `\n\n（還有 ${hits.length - limit} 頁也有）` : '');
  }
  function tReadPages({school, pages}) {
    const codes = resolveCodes(school).filter(c => DB.pages.has(c));
    if (!codes.length) return {error: `找不到「${school}」這間學校的簡章全文`};
    if (codes.length > 1) return {error: `「${school}」對到好幾間：${codes.map(c => `${schoolByCode(c).name}（${c}）`).join('、')}，請用簡章代碼。`};
    const code = codes[0], all = DB.pages.get(code);
    const want = [...new Set(pages)].filter(n => n >= 1 && n <= all.length).slice(0, 4);
    if (!want.length) return {error: `${shortOfCode(code)} 簡章只有 ${all.length} 頁`};
    return `${schoolByCode(code).name} 簡章（共 ${all.length} 頁）\n\n` + want.map(n => `【${pageRef(code, n)}】\n${clip(all[n - 1].text.replace(/[ \t　]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(), 5000)}`).join('\n\n');
  }
  const evText = e => { const [kind, sd, ed, st, et, name, note] = e; return `${name || kind}：${sd ? L.md(sd) : ''}${st ? ' ' + st : ''}${ed && ed !== sd ? ` ～ ${L.md(ed)}${et ? ' ' + et : ''}` : !ed && et ? '～' + et : ed && et ? ' ' + et : ''}${note ? `（${flat(note)}）` : ''}`; };
  function tFindPrograms({query}) {
    const r = search(String(query).slice(0, 100));
    if (!r.programs.length && !r.general.length) return `找不到「${query}」。`;
    const lines = r.programs.slice(0, 12).map(x => {
      const p = progOf(x.id);
      if (!p) return '';
      const reg = (p.ev || []).find(e => e[0] === 'reg');
      const it = (p.it || []).filter(i => i && i[0]).map(([n, w]) => w ? `${n} ${w}%` : n).join('・');
      return `- ${x.id}｜${L.shortSchool(p.school, alias)} ${p.n}｜名額 ${p.q ?? '?'}｜${it}${reg ? `｜報名 ${L.md(reg[2] || reg[1])}${reg[4] ? ' ' + reg[4] : ''} 止` : ''}${x.page ? `｜簡章 ${pageRef(p.code, x.page)}` : p.pg && p.pg.length ? `｜簡章 p.${p.pg.join('、')}` : ''}`;
    }).filter(Boolean);
    const gen = r.general.slice(0, 5).map(g => `- ${pageRef(g.code, g.page)}：${g.snippet ? flat(g.snippet.before + g.snippet.match + g.snippet.after) : ''}`);
    return [`系組（共 ${r.programs.length} 個，列前 ${lines.length} 個）：`, ...lines, gen.length ? '簡章總則等頁：' : '', ...gen].filter(Boolean).join('\n');
  }
  function tProgramInfo({program_id: id}) {
    const p = progOf(String(id).trim());
    if (!p) return {error: `沒有 ${id} 這個系組代碼`};
    const mine = apps().filter(a => a.programId === p.i);
    return [`${p.i}｜${p.school} ${p.n}｜簡章代碼 ${p.code}${mine.length ? `｜使用者已加入（app_id=${mine.map(a => a.id).join('、')}）` : ''}`,
      `日期：\n${(p.ev || []).map(e => `  - ${evText(e)}`).join('\n')}`, ...programFacts(p)].join('\n');
  }
  const IMPL = {my_schools: tMySchools, school_detail: tSchoolDetail, upcoming: tUpcoming, search_brochure: tSearchBrochure, read_brochure_pages: tReadPages, find_programs: tFindPrograms, program_info: tProgramInfo};
  // 回傳 {text, isError}；輸出最多 14000 字，免得一次塞爆對話
  function runTool(name, input, now) {
    const bad = validate(name, input);
    if (bad) return {text: `參數不對：${bad}`, isError: true};
    try {
      const r = IMPL[name](input, NOW_RE.test(now || '') ? now : ctx.nowKey());
      if (r && typeof r === 'object' && r.error) return {text: r.error, isError: true};
      return {text: clip(r, 14000), isError: false};
    } catch (e) {
      console.warn('問 AI 工具錯誤', name, e);
      return {text: `查詢失敗：${e.message}`, isError: true};
    }
  }
  // 網頁上顯示的「查了什麼」
  function toolLabel(name, input = {}) {
    const i = input && typeof input === 'object' ? {...input} : {};
    if (typeof i.school === 'string' && /^\d{3}$/.test(i.school.trim())) i.school = shortOfCode(i.school.trim());
    switch (name) {
      case 'my_schools': return '看了我的學校';
      case 'school_detail': return `看了 ${clip(i.school || '', 20)} 的紀錄`;
      case 'upcoming': return '看了接下來';
      case 'search_brochure': return `在${i.school ? ` ${clip(i.school, 12)} ` : ''}簡章找「${clip(i.query || '', 20)}」`;
      case 'read_brochure_pages': return `讀了 ${clip(i.school || '', 12)} 簡章 p.${(Array.isArray(i.pages) ? i.pages : []).slice(0, 4).join('、')}`;
      case 'find_programs': return `搜尋系組「${clip(i.query || '', 20)}」`;
      case 'program_info': return `看了系組 ${clip(i.program_id || '', 16)}`;
      default: return '查資料';
    }
  }

  /* ---------- 一次回答 ---------- */
  let run = null; // {id, chatId, abort(), token}
  const turnNote = (now, app) => `〔網站附註：現在 ${now.replace('T', ' ')}（台北）。${app ? `使用者正在看「${nameOf(app)}」（app_id=${app.id}）。` : ''}〕\n`;
  const sigNow = crypto.createHash('sha1').update(SYSTEM).update(JSON.stringify(API_TOOLS)).digest('hex').slice(0, 12);

  // API：append-only 的訊息（含 thinking 區塊，原封不動送回去）。系統提示或工具改過（sig 不同）、或用 Claude Code 答過的回合，用純文字補上，不重送舊的 thinking。
  function apiHistory(chat) {
    if (!Array.isArray(chat.api) || chat.apiSig !== sigNow) { chat.api = []; chat.apiTurns = 0; chat.apiSig = sigNow; }
    const msgs = chat.api.slice();
    for (const t of chat.turns.slice(chat.apiTurns || 0)) {
      if (!t.a) continue;
      msgs.push({role: 'user', content: [{type: 'text', text: (t.note || '') + t.q}]}, {role: 'assistant', content: [{type: 'text', text: t.a}]});
    }
    return msgs;
  }
  const stripThinking = msgs => msgs.map(m => m.role !== 'assistant' || !Array.isArray(m.content) ? m : {...m, content: m.content.filter(b => b.type !== 'thinking' && b.type !== 'redacted_thinking')}).filter(m => !Array.isArray(m.content) || m.content.length);
  // 中途換到備援模型（fallback）：最後一個 fallback 區塊之前，只留文字（官方說明：echo 回去時略過 thinking／tool_use）
  function echoable(blocks) {
    const last = blocks.map(b => b.type).lastIndexOf('fallback');
    if (last < 0) return blocks;
    return [...blocks.slice(0, last).filter(b => b.type === 'text'), ...blocks.slice(last + 1)];
  }
  async function apiStream(body, key, signal, onText) {
    const base = String(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
    const betas = body.fallbacks ? ['server-side-fallback-2026-07-01'] : [];
    let res;
    try {
      res = await fetch(`${base}/v1/messages`, {method: 'POST', signal, headers: {'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': API_VERSION, ...(betas.length ? {'anthropic-beta': betas.join(',')} : {})}, body: JSON.stringify(body)});
    } catch (e) {
      if (signal.aborted) throw Object.assign(new Error('已停止'), {stopped: true});
      throw Object.assign(new Error('連不到 Anthropic'), {retry: true});
    }
    if (!res.ok) {
      let msg = '';
      try { const j = await res.json(); msg = (j && j.error && j.error.message) || ''; } catch { /* ignore */ }
      const s = res.status;
      const text = s === 401 ? 'API Key 不對或已經失效' : s === 403 ? '這個 API Key 沒有權限' : s === 429 ? '用量到上限了，等一下再試' : s >= 500 ? 'Anthropic 伺服器忙，等一下再試' : `API 錯誤 ${s}${msg ? '：' + clip(msg, 200) : ''}`;
      throw Object.assign(new Error(text), {status: s, raw: msg, retry: s === 429 || s >= 500});
    }
    const blocks = [], parts = new Map();
    let stop = null, stopDetails = null, usage = {}, model = body.model, buf = '';
    const dec = new TextDecoder();
    const onEvent = ev => {
      switch (ev.type) {
        case 'message_start': model = (ev.message && ev.message.model) || model; usage = {...usage, ...(ev.message && ev.message.usage)}; break;
        case 'content_block_start': { const b = {...ev.content_block}; blocks[ev.index] = b; if (b.type === 'tool_use') { parts.set(ev.index, ''); b.input = {}; } break; }
        case 'content_block_delta': {
          const b = blocks[ev.index], d = ev.delta || {};
          if (!b) break;
          if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; onText(d.text); }
          else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
          else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
          else if (d.type === 'input_json_delta') parts.set(ev.index, (parts.get(ev.index) || '') + d.partial_json);
          break;
        }
        case 'content_block_stop': {
          const b = blocks[ev.index];
          if (b && b.type === 'tool_use') { const raw = parts.get(ev.index) || ''; try { b.input = raw ? JSON.parse(raw) : {}; } catch { b.input = {}; b._bad = true; } }
          break;
        }
        case 'message_delta': stop = (ev.delta && ev.delta.stop_reason) || stop; stopDetails = (ev.delta && ev.delta.stop_details) || stopDetails; usage = {...usage, ...(ev.usage || {})}; break;
        case 'error': throw Object.assign(new Error(ev.error && ev.error.type === 'overloaded_error' ? 'Anthropic 伺服器忙，等一下再試' : `API 錯誤：${clip((ev.error && ev.error.message) || '', 200)}`), {retry: ev.error && ev.error.type === 'overloaded_error'});
      }
    };
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, {stream: true});
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
          if (!data) continue;
          let ev;
          try { ev = JSON.parse(data); } catch { continue; }
          onEvent(ev);
        }
      }
    } catch (e) {
      if (signal.aborted) throw Object.assign(new Error('已停止'), {stopped: true});
      throw e;
    }
    return {blocks: blocks.filter(Boolean), stop, stopDetails, usage, model};
  }
  async function runApi(chat, q, note, now, emit, signal) {
    const key = apiKey();
    if (!key) throw new Error('還沒有設定 API Key');
    const {model, effort} = store.settings;
    let msgs = [...apiHistory(chat), {role: 'user', content: [{type: 'text', text: note + q}]}];
    const base = {model, max_tokens: 64000, stream: true, system: SYSTEM, tools: API_TOOLS, thinking: {type: 'adaptive'}, output_config: {effort}, cache_control: {type: 'ephemeral'}};
    // 安全機制擋下時改用建議的備援模型（Haiku 沒有備援）
    if (model !== 'claude-haiku-5-5') base.fallbacks = 'default';
    let text = '', usage = {input: 0, output: 0}, stripped = false, servedBy = model;
    const tools = [];
    for (let iter = 0; iter < MAX_ITER; iter++) {
      let r, tries = 0;
      for (;;) {
        try { r = await apiStream({...base, messages: msgs}, key, signal, t => { text += t; emit('text', {t}); }); break; }
        catch (e) {
          if (e.stopped) throw e;
          // 舊的 thinking 區塊對不上（系統提示或歷史變了）：去掉 thinking 重送一次
          if (e.status === 400 && !stripped && /thinking|signature|prefix/i.test(e.raw || '')) { stripped = true; msgs = stripThinking(msgs); continue; }
          if (e.retry && tries < 1 && !text) { tries++; await new Promise(res => setTimeout(res, 2500)); continue; }
          throw e;
        }
      }
      usage.input += Number(r.usage.input_tokens || 0) + Number(r.usage.cache_read_input_tokens || 0) + Number(r.usage.cache_creation_input_tokens || 0);
      usage.output += Number(r.usage.output_tokens || 0);
      servedBy = r.model || servedBy;
      if (r.stop === 'refusal') throw Object.assign(new Error('這個問題被安全機制擋下，換個問法試試'), {refusal: true});
      const blocks = echoable(r.blocks).map(b => { const {_bad, ...rest} = b; return rest; });
      msgs.push({role: 'assistant', content: blocks});
      const calls = r.blocks.filter(b => b.type === 'tool_use');
      if (r.stop !== 'tool_use' || !calls.length) {
        if (r.stop === 'max_tokens' && !text) throw new Error('回答太長被截斷了');
        return {text, msgs, usage, model: servedBy, tools};
      }
      if (text && !/\n\s*$/.test(text)) { text += '\n\n'; emit('text', {t: '\n\n'}); }
      const results = calls.map(c => {
        const label = toolLabel(c.name, c.input);
        tools.push(label); emit('tool', {label});
        const out = c._bad ? {text: '參數不是有效的 JSON，請重新呼叫', isError: true} : TOOL_NAMES.has(c.name) ? runTool(c.name, c.input, now) : {text: '沒有這個工具', isError: true};
        return {type: 'tool_result', tool_use_id: c.id, content: out.text, ...(out.isError ? {is_error: true} : {})};
      });
      msgs.push({role: 'user', content: results});
    }
    throw new Error('查太多次了，換個問法試試');
  }

  // Claude Code：一次一個 claude -p，對話紀錄用文字放在提示裡（--no-session-persistence，不留在 Claude Code 的紀錄）
  const mcpScript = path.join(__dirname, 'scripts', 'ai-mcp.js');
  const sandboxDir = () => { const d = path.join(os.tmpdir(), 'special-study-ai'); fs.mkdirSync(d, {recursive: true}); return d; };
  function cliArgs(model, effort, mcpJson) {
    return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--tools', '', '--strict-mcp-config', '--mcp-config', mcpJson, '--allowedTools', 'mcp__tracker', '--permission-mode', 'dontAsk',
      '--restricted', '--disable-slash-commands', '--no-session-persistence', '--model', model, '--effort', effort, '--system-prompt', SYSTEM];
  }
  function cliPrompt(chat, q, note) {
    const prev = chat.turns.filter(t => t.a).slice(-12);
    const hist = prev.length ? `這段對話先前的內容：\n${prev.map(t => `<使用者>\n${t.q}\n</使用者>\n<助理>\n${t.a}\n</助理>`).join('\n')}\n\n現在的問題：\n` : '';
    return hist + note + q;
  }
  function runCli(chat, q, note, now, emit, signal) {
    const bin = findClaude();
    if (!bin) return Promise.reject(new Error('這台電腦找不到 claude 指令'));
    const {model, effort} = store.settings;
    const token = crypto.randomBytes(24).toString('hex');
    run.token = token; run.now = now;
    const mcp = JSON.stringify({mcpServers: {tracker: {type: 'stdio', command: process.execPath, args: [mcpScript], env: {TRACKER_URL: ctx.selfUrl(), TRACKER_TOKEN: token}}}});
    return new Promise((resolve, reject) => {
      const ch = spawn(bin, cliArgs(model, effort, mcp), {cwd: sandboxDir(), env: childEnv(), stdio: ['pipe', 'pipe', 'pipe']});
      let text = '', out = '', err = '', done = false, servedBy = model, usage = {input: 0, output: 0}, resultErr = '', newMsg = false;
      const tools = [];
      const finish = (e, v) => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', onAbort); if (e) reject(e); else resolve(v); };
      const kill = () => { try { ch.kill('SIGTERM'); } catch { /* gone */ } setTimeout(() => { try { ch.kill('SIGKILL'); } catch { /* gone */ } }, 3000).unref(); };
      const onAbort = () => { kill(); finish(Object.assign(new Error('已停止'), {stopped: true})); };
      signal.addEventListener('abort', onAbort);
      const timer = setTimeout(() => { kill(); finish(new Error('回答太久，停掉了')); }, RUN_MS);
      const onLine = line => {
        let m;
        try { m = JSON.parse(line); } catch { return; }
        // 再檢查一次：開起來的工具只能是我們的（將來 claude 改了旗標的意思，也不會變成能讀檔、跑指令）
        if (m.type === 'system' && m.subtype === 'init') {
          const extra = (Array.isArray(m.tools) ? m.tools : []).filter(t => !/^mcp__tracker__\w+$/.test(String(t)));
          if (extra.length) { kill(); finish(new Error(`Claude Code 開了不該開的工具（${extra.slice(0, 3).join('、')}），停掉了`)); }
          return;
        }
        if (m.type === 'stream_event' && m.event) {
          const ev = m.event;
          if (ev.type === 'message_start') { newMsg = true; if (ev.message && ev.message.model) servedBy = ev.message.model; }
          if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta' && ev.delta.text) {
            if (newMsg && text && !/\n\s*$/.test(text)) { text += '\n\n'; emit('text', {t: '\n\n'}); }
            newMsg = false;
            text += ev.delta.text; emit('text', {t: ev.delta.text});
          }
        } else if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
          for (const b of m.message.content) if (b.type === 'tool_use') { const name = String(b.name || '').replace(/^mcp__tracker__/, ''); const label = toolLabel(name, b.input); tools.push(label); emit('tool', {label}); }
        } else if (m.type === 'result') {
          const u = m.usage || {};
          usage = {input: Number(u.input_tokens || 0) + Number(u.cache_read_input_tokens || 0) + Number(u.cache_creation_input_tokens || 0), output: Number(u.output_tokens || 0)};
          if (m.is_error || (m.subtype && m.subtype !== 'success')) resultErr = String(m.result || (Array.isArray(m.errors) ? m.errors.join('；') : '') || m.subtype || '');
          else if (!text && typeof m.result === 'string') { text = m.result; emit('text', {t: m.result}); }
        }
      };
      ch.stdout.on('data', d => { out += d; let i; while ((i = out.indexOf('\n')) >= 0) { const l = out.slice(0, i).trim(); out = out.slice(i + 1); if (l) onLine(l); } });
      ch.stderr.on('data', d => { err = (err + d).slice(-4000); });
      ch.on('error', e => finish(new Error(`claude 跑不起來：${e.message}`)));
      ch.on('close', code => {
        if (out.trim()) onLine(out.trim());
        if (resultErr || (code !== 0 && !text)) {
          const msg = resultErr || err;
          const login = /log ?in|login|auth|credential|401/i.test(msg);
          if (login) cliCache = null;
          return finish(new Error(login ? '這台電腦的 Claude Code 沒有登入（在這台電腦跑一次 claude 登入）' : `Claude Code 出錯了${msg ? '：' + clip(flat(msg), 200) : ''}`));
        }
        finish(null, {text, usage, model: servedBy, tools});
      });
      ch.stdin.end(cliPrompt(chat, q, note));
    });
  }

  async function ask({chatId, question, appId, now}, emit, signal) {
    const backend = await pickBackend();
    if (!backend) throw Object.assign(new Error('還沒設定 AI'), {setup: true});
    let chat = chatId ? store.chats.find(c => c.id === chatId) : null;
    if (chatId && !chat) throw Object.assign(new Error('這段對話已經刪掉了'), {status: 404});
    if (chat && chat.turns.length >= MAX_TURNS) throw new Error('這段對話太長了，開一段新對話');
    const app = apps().find(a => a.id === (appId || (chat && chat.appId))) || null;
    if (!chat) {
      chat = {id: 'c' + crypto.randomBytes(8).toString('hex'), title: clip(flat(question), 40), appId: app ? app.id : '', createdAt: new Date().toISOString(), updatedAt: '', turns: []};
      store.chats.unshift(chat);
      if (store.chats.length > MAX_CHATS) store.chats.length = MAX_CHATS;
    }
    const at = NOW_RE.test(now || '') ? now : ctx.nowKey();
    const note = turnNote(at, app);
    emit('start', {chatId: chat.id, title: chat.title, backend, model: store.settings.model});
    const turn = {q: question, note, a: '', at: new Date().toISOString(), backend, model: store.settings.model, tools: [], status: 'running'};
    let partial = '';
    const emitT = (type, d) => { if (type === 'text') partial += d.t; if (type === 'tool') turn.tools.push(d.label); emit(type, d); };
    try {
      if (backend === 'api') {
        const r = await runApi(chat, question, note, at, emitT, signal);
        // 這回合成功才把 API 訊息接上（先補上前面用 Claude Code 答的回合）
        chat.api = r.msgs; chat.apiSig = sigNow; chat.apiTurns = chat.turns.length + 1;
        Object.assign(turn, {a: r.text, status: 'done', model: r.model, usage: r.usage});
      } else {
        const r = await runCli(chat, question, note, at, emitT, signal);
        Object.assign(turn, {a: r.text, status: 'done', model: r.model, usage: r.usage});
      }
    } catch (e) {
      Object.assign(turn, {a: partial, status: e.stopped ? 'stopped' : 'error', error: e.stopped ? '' : e.message});
      if (!e.stopped) emit('error', {message: e.message});
    }
    turn.tools = [...new Set(turn.tools)];
    chat.turns.push(turn);
    chat.updatedAt = new Date().toISOString();
    store.chats.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    try { await saveStore(); } catch (e) { console.warn('問 AI：對話沒有存到', e.message); }
    emit('done', {chatId: chat.id, turn: publicTurn(turn)});
  }
  const publicTurn = t => ({q: t.q, a: t.a, at: t.at, backend: t.backend, model: t.model, tools: t.tools || [], status: t.status, error: t.error || ''});
  const publicChat = c => ({id: c.id, title: c.title, appId: c.appId || '', createdAt: c.createdAt, updatedAt: c.updatedAt, turns: c.turns.map(publicTurn)});

  /* ---------- HTTP ---------- */
  async function handle(req, res, url, {readBody, sendJson, send}) {
    const parts = url.pathname.split('/').filter(Boolean).slice(2); // drop "api", "ai"
    const [what, id] = parts;
    const m = req.method;

    if (what === 'status' && m === 'GET') {
      const cli = await cliStatus(url.searchParams.get('fresh') === '1');
      return sendJson(req, res, 200, {settings: store.settings, models: MODELS, efforts: EFFORTS, cli, key: keyInfo(), active: await pickBackend(), busy: !!run, chats: store.chats.length});
    }
    if (what === 'settings' && m === 'PUT') {
      const b = await readBody(req);
      if (!b || typeof b !== 'object') return sendJson(req, res, 400, {error: '格式不正確'});
      const next = {...store.settings};
      for (const [k, list] of [['backend', BACKENDS], ['model', MODELS], ['effort', EFFORTS]]) if (b[k] !== undefined) { if (!list.includes(b[k])) return sendJson(req, res, 400, {error: `${k} 不認得`}); next[k] = b[k]; }
      const old = store.settings;
      store.settings = next;
      try { await saveStore(); } catch (e) { store.settings = old; return sendJson(req, res, 500, {error: `沒有存到（${e.code || e.message}）`}); }
      return sendJson(req, res, 200, {settings: store.settings, active: await pickBackend()});
    }
    if (what === 'key' && (m === 'PUT' || m === 'DELETE')) {
      let key = '';
      if (m === 'PUT') {
        const b = await readBody(req);
        key = String((b && b.key) || '').trim();
        if (!KEY_RE.test(key)) return sendJson(req, res, 400, {error: 'API Key 的格式是 sk-ant-…'});
      }
      try { await setKey(key); } catch (e) { return sendJson(req, res, 500, {error: `沒有存到（${e.code || e.message}）`}); }
      return sendJson(req, res, 200, {key: keyInfo(), active: await pickBackend()});
    }
    if (what === 'chats' && m === 'GET' && !id) return sendJson(req, res, 200, store.chats.map(c => ({id: c.id, title: c.title, appId: c.appId || '', updatedAt: c.updatedAt || c.createdAt, turns: c.turns.length})));
    if (what === 'chats' && id) {
      if (!CHAT_ID.test(id)) return sendJson(req, res, 400, {error: '對話 id 不對'});
      const i = store.chats.findIndex(c => c.id === id);
      if (m === 'GET') return i < 0 ? sendJson(req, res, 404, {error: '沒有這段對話'}) : sendJson(req, res, 200, publicChat(store.chats[i]));
      if (m === 'DELETE') {
        if (run && run.chatId === id) return sendJson(req, res, 409, {error: '這段對話正在回答'});
        if (i < 0) return send(res, 204, '');
        const gone = store.chats.splice(i, 1)[0];
        try { await saveStore(); } catch (e) { store.chats.splice(i, 0, gone); return sendJson(req, res, 500, {error: `沒有存到（${e.code || e.message}）`}); }
        return send(res, 204, '');
      }
    }
    if (what === 'chats' && !id && m === 'DELETE') {
      if (run) return sendJson(req, res, 409, {error: '正在回答，等一下再刪'});
      const old = store.chats;
      store.chats = [];
      try { await saveStore(); } catch (e) { store.chats = old; return sendJson(req, res, 500, {error: `沒有存到（${e.code || e.message}）`}); }
      return send(res, 204, '');
    }
    if (what === 'stop' && m === 'POST') { if (run) run.abort(); return send(res, 204, ''); }

    // scripts/ai-mcp.js（claude 開的 MCP 伺服器）來查資料：只收本機、只收正在跑的那一次的 token
    if (what === 'tool' && m === 'POST') {
      const local = /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress || '');
      const tok = String(req.headers['x-ai-token'] || '');
      if (!local || !run || !run.token || tok.length !== run.token.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(run.token))) return sendJson(req, res, 403, {error: 'forbidden'});
      const b = await readBody(req);
      if (b && b.op === 'list') return sendJson(req, res, 200, {tools: TOOLS.map(t => ({name: t.name, description: t.description, inputSchema: t.input_schema}))});
      if (!b || typeof b.name !== 'string') return sendJson(req, res, 400, {error: '格式不正確'});
      return sendJson(req, res, 200, runTool(b.name, b.input || {}, run.now));
    }

    if (what === 'ask' && m === 'POST') {
      const b = await readBody(req);
      const question = String((b && b.question) || '').trim();
      if (!question) return sendJson(req, res, 400, {error: '問題是空的'});
      if (question.length > MAX_Q) return sendJson(req, res, 400, {error: `問題太長（最多 ${MAX_Q} 字）`});
      if (b.chatId !== undefined && b.chatId !== '' && !CHAT_ID.test(String(b.chatId))) return sendJson(req, res, 400, {error: '對話 id 不對'});
      if (b.appId !== undefined && typeof b.appId !== 'string') return sendJson(req, res, 400, {error: 'appId 不對'});
      if (run) return sendJson(req, res, 429, {error: '上一個問題還在回答'});
      const ac = new AbortController();
      run = {chatId: String(b.chatId || ''), abort: () => ac.abort(), token: '', now: ''};
      res.writeHead(200, {'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive'});
      res.flushHeaders && res.flushHeaders();
      const emit = (type, data) => { if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
      const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
      // 網頁關掉或按了停止（連線斷了）：停掉這次回答，已經寫出來的部分照樣存
      res.on('close', () => { if (!res.writableEnded) ac.abort(); });
      try {
        await ask({chatId: String(b.chatId || ''), question, appId: String(b.appId || ''), now: String(b.now || '')}, (type, data) => { if (type === 'start') run.chatId = data.chatId; emit(type, data); }, ac.signal);
      } catch (e) {
        emit('error', {message: e.message, setup: !!e.setup});
      } finally {
        clearInterval(ping);
        run = null;
        if (!res.writableEnded) res.end();
      }
      return;
    }
    return sendJson(req, res, 404, {error: '找不到這個 API'});
  }

  loadStore();
  return {handle, runTool, toolLabel, TOOLS, SYSTEM, cliArgs, validate, store: () => store, keyInfo, busy: () => !!run};
}

module.exports = {createAI, TOOLS, SYSTEM, MODELS, EFFORTS, validate};
