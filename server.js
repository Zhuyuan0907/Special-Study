// 我的特選紀錄 — 本機伺服器（不需要安裝任何套件）
//   node server.js            → http://localhost:5180
//   PORT=3000 HOST=127.0.0.1 node server.js
//   DATA_DIR=/某個/資料夾 node server.js   （測試用：換一個資料夾）
//
// 個人紀錄存在 data/records.json；科系與簡章資料在 data/programs.json。
// 日期怎麼算、哪些事要做（.ics、每日提醒、總表）都用 public/js/logic.js，和網頁同一份。改了 logic.js 要重新啟動。

'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const os = require('node:os');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const RECORDS = path.join(DATA_DIR, 'records.json');
const RECORDS_EXAMPLE = path.join(DATA_DIR, 'records.example.json');
const PORT = /^\d+$/.test(process.env.PORT || '') ? Number(process.env.PORT) : 5180; // PORT=0：隨便一個空的（測試用）
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_.~:@+-]{1,120}$/;
const DAILY_KEEP = 30;
// 新版網頁每個寫入都帶 X-Client: 3；舊分頁（v2）會把整間學校的新欄位洗掉，所以擋下來請它重新整理。
const CLIENT_VERSION = 3;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

let L = null; // public/js/logic.js（main() 裡載入）
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isDate = k => /^\d{4}-\d{2}-\d{2}$/.test(k || '');
const TZ = 'Asia/Taipei';
// 現在的臺灣時間（伺服器本身可能在別的時區）
function nowTaipei() {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false}).formatToParts(new Date())) parts[p.type] = p.value;
  const h = parts.hour === '24' ? '00' : parts.hour;
  return {date: `${parts.year}-${parts.month}-${parts.day}`, time: `${h}:${parts.minute}`, sec: parts.second};
}
const nowKey = () => { const t = nowTaipei(); return `${t.date}T${t.time}`; };
let stampSeq = 0;
const stamp = () => { const t = nowTaipei(); return `${t.date.replace(/-/g, '')}-${t.time.replace(':', '')}${t.sec}-${(stampSeq++ % 1000).toString().padStart(3, '0')}`; };

/* ---------- records store ---------- */
let records = null;
let writeChain = Promise.resolve();
let example = false;   // 還在用範例資料（records.json 不存在）：使用者第一次動作才寫檔
let recovered = null;  // records.json 壞掉，從備份救回來的話記在這裡（/api/meta 會告訴網頁）

const TOP = ['version', 'apps', 'todos', 'profile', 'notifyLastSent', 'updatedAt', 'brochureHash', 'syncLog'];
function normalizeRecords(d) {
  d = isPlainObject(d) ? d : {};
  return {version: Number(d.version) || 2, apps: Array.isArray(d.apps) ? d.apps.filter(isPlainObject) : [], todos: Array.isArray(d.todos) ? d.todos : [],
    profile: isPlainObject(d.profile) ? d.profile : {}, notifyLastSent: d.notifyLastSent || '', updatedAt: d.updatedAt || null,
    brochureHash: typeof d.brochureHash === 'string' ? d.brochureHash : '', syncLog: Array.isArray(d.syncLog) ? d.syncLog : []};
}
function loadRecords() {
  let raw;
  try { raw = fs.readFileSync(RECORDS, 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e; // 讀不到（權限等）就不要開，免得拿範例蓋掉
    example = true;
    try { return normalizeRecords(JSON.parse(fs.readFileSync(RECORDS_EXAMPLE, 'utf8'))); } catch { return normalizeRecords({}); }
  }
  try { return normalizeRecords(JSON.parse(raw)); }
  catch (e) {
    // 檔案壞了：搬到 backups，載入最新一份讀得懂的備份。絕對不要用範例資料。
    fs.mkdirSync(BACKUP_DIR, {recursive: true});
    const corrupt = `records-corrupt-${stamp()}.json`;
    fs.renameSync(RECORDS, path.join(BACKUP_DIR, corrupt));
    console.error(`records.json 讀不懂（${e.message}），已移到 backups/${corrupt}`);
    const files = fs.readdirSync(BACKUP_DIR).filter(f => /^records-.+\.json$/.test(f) && !f.startsWith('records-corrupt-'))
      .map(f => ({f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs})).sort((a, b) => b.t - a.t);
    for (const {f} of files) {
      try {
        const d = normalizeRecords(JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8')));
        recovered = {from: f, corrupt, at: new Date().toISOString()};
        console.error(`  改用備份 backups/${f}`);
        return d;
      } catch { /* 下一份 */ }
    }
    recovered = {from: '', corrupt, at: new Date().toISOString()};
    console.error('  沒有可用的備份，從空白開始');
    return normalizeRecords({});
  }
}

/* ---------- 備份 ---------- */
// 每天第一次寫入前，把磁碟上的檔案（還沒有這次改動）複製一份；只清每日備份，其他備份都留著。
async function backupDaily() {
  const name = `records-${nowTaipei().date}.json`;
  try { await fsp.copyFile(RECORDS, path.join(BACKUP_DIR, name), fs.constants.COPYFILE_EXCL); }
  catch (e) { if (e.code !== 'EEXIST' && e.code !== 'ENOENT') console.warn('每日備份失敗：', e.message); return; }
  const daily = (await fsp.readdir(BACKUP_DIR)).filter(f => /^records-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
  for (const f of daily.slice(DAILY_KEEP)) await fsp.unlink(path.join(BACKUP_DIR, f)).catch(() => {});
}
// 遷移、同步、匯入之前的備份；複製失敗或讀不懂就丟錯，呼叫的人不可以繼續寫。
async function backupBefore(what) {
  if (!fs.existsSync(RECORDS)) return '';
  await fsp.mkdir(BACKUP_DIR, {recursive: true});
  const name = `records-before-${what}-${stamp()}.json`;
  const file = path.join(BACKUP_DIR, name);
  await fsp.copyFile(RECORDS, file, fs.constants.COPYFILE_EXCL);
  JSON.parse(await fsp.readFile(file, 'utf8'));
  return name;
}
// 寫檔：排隊、先備份、tmp + rename。失敗會丟錯（API 回 500，網頁會留著重試）。
function saveRecords({sheets = true} = {}) {
  records.updatedAt = new Date().toISOString();
  example = false;
  const body = JSON.stringify(Object.fromEntries(TOP.map(k => [k, records[k]])), null, 2) + '\n';
  const job = writeChain.then(async () => {
    await fsp.mkdir(BACKUP_DIR, {recursive: true});
    await backupDaily();
    const tmp = RECORDS + '.tmp';
    await fsp.writeFile(tmp, body, 'utf8');
    await fsp.rename(tmp, RECORDS);
  });
  writeChain = job.catch(e => console.error('儲存 records.json 失敗：', e.message));
  if (sheets) scheduleSheetSync();
  return job;
}

/* ---------- 科系資料與簡章全文搜尋 ---------- */
function readJson(name, fallback) {
  for (const dir of [DATA_DIR, path.join(ROOT, 'data')]) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { /* next */ }
  }
  return fallback;
}
const TERMS = readJson('search-terms.json', {synonyms: {}, aliases: {}});
const SYN = TERMS.synonyms || {};
const ALIAS = TERMS.aliases || {};

// Normalise one character for matching: drop whitespace, fold full-width ASCII and 台/臺, lower-case.
const SPACE = new Set([9, 10, 11, 12, 13, 32, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]);
function normCode(c) {
  if (SPACE.has(c) || (c >= 0x2000 && c <= 0x200a)) return -1;
  if (c >= 0xff01 && c <= 0xff5e) c -= 0xfee0;
  if (c >= 65 && c <= 90) return c + 32;
  if (c === 0x53f0) return 0x81fa; // 台 → 臺
  return c;
}
function indexText(text) {
  const codes = new Uint16Array(text.length);
  const map = new Int32Array(text.length);
  let k = 0;
  for (let i = 0; i < text.length; i++) {
    const c = normCode(text.charCodeAt(i));
    if (c < 0) continue;
    codes[k] = c;
    map[k++] = i;
  }
  let out = '';
  for (let i = 0; i < k; i += 8192) out += String.fromCharCode.apply(null, codes.subarray(i, Math.min(k, i + 8192)));
  return {norm: out, map: map.subarray(0, k)};
}
const norm = s => indexText(String(s || '')).norm;

// raw：logic.js 要用的完整系組資料（ev、docs、rl、scr…），key 是系組代碼。
const DB = {programs: [], schools: [], byId: new Map(), raw: new Map(), pages: new Map(), general: [], meta: {year: null, fetched: '', pdfSchools: []}, hash: '', body: null, links: {}};
function loadProgramData() {
  const file = path.join(DATA_DIR, 'programs.json');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { console.warn('找不到 data/programs.json，請先執行 npm run build-data'); return; }
  const d = JSON.parse(text);
  // data/overrides.json 平常由 build-data 併進 programs.json；這裡再併一次（同樣的值，結果不變），還沒重建時網頁和伺服器也看得到。
  const ovFile = path.join(DATA_DIR, 'overrides.json');
  let ovText = '';
  try { ovText = fs.readFileSync(ovFile, 'utf8'); } catch { /* 沒有就算了 */ }
  if (ovText) {
    try {
      const fixes = JSON.parse(ovText).programs || {};
      for (const p of d.programs) for (const [k, v] of Object.entries(fixes[p.i] || {})) { if (k === 'src') continue; if (v === null) delete p[k]; else p[k] = k === 'pg' && Array.isArray(v) ? [...v].sort((a, b) => a - b) : v; }
    } catch (e) { console.warn('data/overrides.json 讀不懂，略過：', e.message); ovText = ''; }
  }
  DB.hash = crypto.createHash('sha1').update(text).update('\0').update(ovText).digest('hex');
  DB.body = ovText ? Buffer.from(JSON.stringify(d)) : Buffer.from(text);
  DB.bodyGz = null;
  DB.schools = d.schools;
  DB.links = readJson('school-links.json', {schools: {}}).schools || {};
  const pdfDir = path.join(DATA_DIR, 'brochures/pdf');
  DB.meta = {year: d.year || null, fetched: d.fetched || '', source: d.source || '', pdfSchools: d.schools.filter(s => fs.existsSync(path.join(pdfDir, `${s.code}.pdf`))).map(s => s.code)};
  DB.raw = new Map(d.programs.map(p => { const s = d.schools[p.s] || {}; return [p.i, {...p, school: s.name || '', code: s.code || ''}]; }));
  DB.pages = new Map();
  DB.general = [];
  for (const s of d.schools) {
    const tf = path.join(DATA_DIR, 'brochures/text', `${s.code}.json`);
    if (!fs.existsSync(tf)) continue;
    const t = JSON.parse(fs.readFileSync(tf, 'utf8'));
    DB.pages.set(s.code, t.pages.map(text => ({text, ...indexText(text)})));
  }
  const usedPages = new Map();
  DB.programs = d.programs.map(p => {
    const school = d.schools[p.s];
    for (const n of p.pg || []) (usedPages.get(school.code) || usedPages.set(school.code, new Set()).get(school.code)).add(n);
    return {
      id: p.i, code: school.code, school: school.name, pg: p.pg || [],
      name: norm(p.n), schoolN: norm(school.name), groups: norm([p.g, p.x, p.c].filter(Boolean).join(' ')),
      data: norm([p.tgt, p.deb, p.deo, p.pr, p.nt, p.cw, (p.it || []).map(i => i.join(' ')).join(' ')].filter(Boolean).join(' ')),
    };
  });
  DB.byId = new Map(DB.programs.map(p => [p.id, p]));
  for (const [code, pages] of DB.pages) {
    const used = usedPages.get(code) || new Set();
    pages.forEach((pg, i) => { if (!used.has(i + 1)) DB.general.push({code, school: DB.schools.find(s => s.code === code).name, page: i + 1}); });
  }
  console.log(`科系資料：${DB.programs.length} 個系組，${DB.pages.size} 份簡章全文`);
}
const progOf = id => DB.raw.get(id) || null;
const SEASON = () => readJson('season.json', {events: []}).events || [];
const logicOpts = () => ({aliases: ALIAS, links: DB.links, season: SEASON()});

function subseqSpan(hay, needle) {
  let best = Infinity;
  for (let i = hay.indexOf(needle[0]); i !== -1; i = hay.indexOf(needle[0], i + 1)) {
    let j = i, k = 1;
    for (; k < needle.length; k++) { j = hay.indexOf(needle[k], j + 1); if (j === -1) break; }
    if (k === needle.length) best = Math.min(best, j - i + 1);
  }
  return best;
}
// How well one query word matches a program, and where in its brochure pages if that is the only match.
function tokenMatch(p, t) {
  if (ALIAS[t]) {
    if (p.school === ALIAS[t]) return {score: 85};
    if (p.name.includes(t)) return {score: 100};
    return null;
  }
  if (p.name.includes(t)) return {score: 100};
  for (const s of SYN[t] || []) if (p.name.includes(norm(s))) return {score: 95, term: norm(s)};
  if (p.schoolN.includes(t)) return {score: 80};
  if (t.length >= 2 && !SYN[t]) { const sp = subseqSpan(p.name, t); if (sp <= t.length * 3) return {score: 70 - (sp - t.length)}; }
  if (p.groups.includes(t)) return {score: 40};
  for (const s of SYN[t] || []) if (p.groups.includes(norm(s))) return {score: 38};
  if (t.length >= 2 && p.data.includes(t)) return {score: 30, deep: true};
  if (t.length >= 2) {
    const pages = DB.pages.get(p.code) || [];
    for (const n of p.pg) { const pg = pages[n - 1]; if (pg && pg.norm.includes(t)) return {score: 20, deep: true}; }
  }
  return null;
}
function snippet(pg, terms) {
  for (const t of terms) {
    const at = pg.norm.indexOf(t);
    if (at < 0) continue;
    const start = pg.map[at], end = pg.map[at + t.length - 1] + 1;
    const clip = s => s.replace(/\s+/g, ' ');
    const from = Math.max(0, start - 30), to = Math.min(pg.text.length, end + 56);
    return {before: (from > 0 ? '…' : '') + clip(pg.text.slice(from, start)), match: clip(pg.text.slice(start, end)), after: clip(pg.text.slice(end, to)) + (to < pg.text.length ? '…' : '')};
  }
  return null;
}
function search(q) {
  const tokens = norm(q.replace(/\s+/g, ' ')).length ? q.trim().split(/\s+/).map(norm).filter(Boolean) : [];
  if (!tokens.length) return {tokens, programs: [], general: []};
  const results = [];
  for (const p of DB.programs) {
    let score = 0, deep = [];
    for (const t of tokens) {
      const m = tokenMatch(p, t);
      if (!m) { score = -1; break; }
      score += m.score;
      if (m.deep) deep.push(t);
    }
    if (score < 0) continue;
    const r = {id: p.id, score};
    if (deep.length) {
      const pages = DB.pages.get(p.code) || [];
      for (const n of p.pg) { const s = pages[n - 1] && snippet(pages[n - 1], deep); if (s) { r.page = n; r.snippet = s; break; } }
    }
    results.push(r);
  }
  // Brochure pages not tied to one department (總則、名額表…): every word must hit the page text or name the school.
  const general = [];
  for (const g of DB.general) {
    const pg = DB.pages.get(g.code)[g.page - 1];
    const schoolN = norm(g.school);
    const inPage = [];
    const ok = tokens.every(t => {
      if (ALIAS[t]) return g.school === ALIAS[t];
      if (t.length >= 2 && pg.norm.includes(t)) { inPage.push(t); return true; }
      return schoolN.includes(t);
    });
    if (!ok || !inPage.length) continue;
    general.push({code: g.code, school: g.school, page: g.page, snippet: snippet(pg, inPage)});
    if (general.length >= 40) break;
  }
  results.sort((a, b) => b.score - a.score);
  return {tokens, programs: results, general};
}

/* ---------- 遷移與簡章同步（啟動時） ---------- */
// 顏色固定成舊版畫面上的顏色（依建立順序）；遷移只動沒有 v:3 的學校，所以可以重複跑。
function colorIndex(app) {
  const sorted = [...records.apps].sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
  return Math.max(0, sorted.indexOf(app));
}
function migrateAll() {
  let n = 0;
  const idx = new Map([...records.apps].sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0)).map((a, i) => [a, i]));
  records.apps = records.apps.map(a => { if (a.v === 3) return a; n++; return L.migrateApp(a, progOf(a.programId), idx.get(a)); });
  if (records.apps.every(a => a.v === 3) && records.version < 3) records.version = 3;
  return n;
}
// 簡章同步：只在 programs.json（＋overrides）的內容變了才跑。每間學校各自保護：沒有系組、簡章是空的、會少掉四成以上的列，就跳過。
function syncAll() {
  const id = 's' + Date.now().toString(36);
  const changes = [], skipped = [];
  migrateAll();
  records.apps = records.apps.map(a => {
    const p = progOf(a.programId);
    if (!p) return a;
    const r = L.syncApp(a, p, nowKey(), {syncId: id});
    if (r.skipped) skipped.push(`${a.school}：${r.skipped}`);
    changes.push(...r.changes);
    return r.app;
  });
  if (skipped.length) console.warn('簡章同步跳過：', skipped.join('；'));
  if (changes.length) {
    records.syncLog.push({id, at: new Date().toISOString(), changes});
    records.syncLog = records.syncLog.slice(-20);
    console.log(`簡章同步：${changes.length} 個改動`);
  }
  return {id, changes};
}
async function prepareRecords() {
  if (example) { // 範例資料只在記憶體裡轉成 v3，不寫檔
    const idx = new Map(records.apps.map((a, i) => [a, i]));
    records.apps = records.apps.map(a => L.migrateApp(a, progOf(a.programId), idx.get(a)));
    return;
  }
  const needMigrate = records.apps.some(a => a.v !== 3);
  const needSync = !!DB.hash && DB.hash !== records.brochureHash && records.apps.length > 0;
  if (!needMigrate && !needSync && !recovered) {
    if (DB.hash && !records.brochureHash) { records.brochureHash = DB.hash; await saveRecords({sheets: false}); }
    return;
  }
  // 先複製磁碟上的檔案；複製失敗就不要動資料（丟錯，啟動中止）
  if (needMigrate || needSync) {
    const name = await backupBefore(needMigrate ? 'migrate' : 'sync');
    if (name) console.log(`已備份：backups/${name}`);
  }
  if (needMigrate) console.log(`遷移到 v3：${migrateAll()} 間學校`);
  if (needSync) syncAll();
  if (DB.hash) records.brochureHash = DB.hash;
  await saveRecords({sheets: false});
}

/* ---------- 行事曆訂閱（iCalendar）：只放接下來會出現的事 ---------- */
const icsText = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = k => k.replace(/-/g, '');
const icsFold = line => { const out = []; let s = line; while (Buffer.byteLength(s) > 70) { let cut = 70; while (Buffer.byteLength(s.slice(0, cut)) > 70) cut--; out.push(s.slice(0, cut)); s = ' ' + s.slice(cut); } out.push(s); return out.join('\r\n'); };
const appName = a => L.shortSchool(a.school, ALIAS) + (a.dept ? ' ' + L.shortDept(a.dept) : '');
// 一列的文字：「報名 ✓・繳費・郵寄備審（今天郵戳）」。行事曆會快取，abs 時不寫「今天」。
function rowText(r, now, abs = false) {
  const mailText = x => abs ? (x.mail === 'postmark' ? '郵戳為憑' : `${mdOf(x.date)} 前寄達`) : L.timeText(x, now);
  const own = p => p.mail ? mailText(p) : p.own;
  const parts = r.parts && r.parts.length ? r.parts.map(p => p.name + (p.done ? ' ✓' : '') + (p.opt ? '（選繳）' : '') + (own(p) ? `（${own(p)}）` : '')).join('・') : r.label;
  const head = r.role === 'reg' || r.role === 'ticket' || r.role === 'intent' ? parts : r.label;
  return head + (r.mail ? `（${mailText(r)}）` : '');
}
function buildIcs() {
  const stampNow = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const now = nowKey();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//special-study//我的特選紀錄//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:我的特選紀錄', 'X-WR-TIMEZONE:Asia/Taipei',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Taipei', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0800', 'TZOFFSETTO:+0800', 'TZNAME:CST', 'END:STANDARD', 'END:VTIMEZONE'];
  const {rows} = L.agenda(records.apps, progOf, now, logicOpts());
  for (const r of rows) {
    const a = records.apps.find(x => x.id === r.appId);
    if (!a) continue;
    const title = `${L.shortSchool(a.school, ALIAS)} ${rowText(r, now, true)}`;
    const timed = /^\d{2}:\d{2}$/.test(r.time || '') && !r.mail;
    lines.push('BEGIN:VEVENT', `UID:${a.id}-${r.rowIds[0] || icsDate(r.date)}@special-study`, `DTSTAMP:${stampNow}`, `SUMMARY:${icsText(title)}`);
    if (timed) {
      const [h, m] = r.time.split(':').map(Number);
      const end = h >= 23 ? '235900' : `${String(h + 1).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
      lines.push(`DTSTART;TZID=Asia/Taipei:${icsDate(r.date)}T${r.time.replace(':', '')}00`, `DTEND;TZID=Asia/Taipei:${icsDate(r.date)}T${end}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(r.date)}`, `DTEND;VALUE=DATE:${icsDate(L.addDays(r.date, 1))}`);
    }
    const desc = [appName(a), r.note, r.context, r.clash && r.clash.length ? '同天：' + r.clash.map(id => { const o = records.apps.find(x => x.id === id); return o ? L.shortSchool(o.school, ALIAS) : ''; }).filter(Boolean).join('、') : ''].filter(Boolean).join('\n');
    if (desc) lines.push(`DESCRIPTION:${icsText(desc)}`);
    // 只有「要做」的事提醒：前一天一次；有時間的再於三小時前一次。
    if (r.type === 'do') {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(title)}`, 'TRIGGER:-P1D', 'END:VALARM');
      if (timed) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(title)}`, 'TRIGGER:-PT3H', 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/* ---------- 總表、每日提醒、同步到 Google Sheets ---------- */
const mdOf = k => `${Number(k.slice(5, 7))}/${k.slice(8, 10)}`;
const firstDateOf = (a, kinds) => (a.dates || []).filter(d => kinds.includes(d.kind) && isDate(d.date)).sort((x, y) => x.date.localeCompare(y.date))[0] || null;
const whenText = d => d ? `${d.date}${d.time ? ' ' + d.time : ''}` : '';
// 所有學校的一張總表：匯出 CSV、貼到試算表、同步到 Google Sheets 都用同一份。狀態和下一步跟網頁一樣（logic.js）。
function buildTable() {
  const headers = ['學校', '系組', '狀態', '下一步', '報名截止', '繳件截止', '面試', '放榜', '報到截止', '放棄截止', '名額', '報名費', '備審完成', '備審項目', '報名系統', '筆記'];
  const now = nowKey();
  const ag = L.agenda(records.apps, progOf, now, logicOpts());
  const rows = records.apps.map(a => {
    const p = progOf(a.programId);
    const docs = (a.docs || []).filter(d => !d.gone), done = docs.filter(d => d.done).length;
    const L2 = (p && DB.links[p.code]) || {};
    const next = ag.rows.find(r => r.appId === a.id);
    return [a.school || '', a.dept || '', L.statusWord(a, p, now), next ? `${next.date}${next.time ? ' ' + next.time : ''} ${rowText(next, now)}` : '',
      whenText(firstDateOf(a, ['reg'])), whenText(firstDateOf(a, ['upload', 'letter'])), whenText(firstDateOf(a, ['interview', 'exam', 'window'])), whenText(firstDateOf(a, ['release'])),
      whenText(firstDateOf(a, ['confirm'])), whenText(firstDateOf(a, ['giveup'])), a.quota ?? '', a.fee ?? '', docs.length ? `${done}/${docs.length}` : '',
      docs.map(d => (d.done ? '✓' : '○') + d.name).join('；'), L2.apply || L2.adm || '', L.userNotes(a).replace(/\s+/g, ' ')];
  });
  return {headers, rows, updated: records.updatedAt};
}
const csvCell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const tableCsv = () => { const t = buildTable(); return '\ufeff' + [t.headers, ...t.rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; };
// 給 Notion、Obsidian 貼的 Markdown
function buildMarkdown() {
  const t = buildTable();
  const esc = s => String(s ?? '').replace(/\|/g, '\\|');
  const main = t.headers.slice(0, 12);
  const lines = [`# 我的特選紀錄（${nowTaipei().date}）`, '', `| ${main.join(' | ')} |`, `| ${main.map(() => '---').join(' | ')} |`, ...t.rows.map(r => `| ${r.slice(0, 12).map(esc).join(' | ')} |`), ''];
  for (const a of records.apps) {
    lines.push(`## ${a.school} ${a.dept || ''}`.trim(), '');
    const evs = L.eventsOf(a, progOf(a.programId));
    if (evs.length) lines.push(...evs.map(e => `- ${e.date}${e.time ? ' ' + e.time : ''} ${e.label}${e.note ? '：' + e.note : ''}`), '');
    if ((a.docs || []).length) lines.push(...a.docs.map(d => `- [${d.done ? 'x' : ' '}] ${d.name}`), '');
    if (a.prep) lines.push('面試準備：', '', a.prep, '');
    if (a.asked) lines.push('面試紀錄：', '', a.asked, '');
  }
  const todos = (records.todos || []).filter(t => !t.done);
  if (todos.length) lines.push('## 待辦', '', ...todos.map(t => `- [ ] ${t.text}${t.due ? `（${t.due}）` : ''}`), '');
  return lines.join('\n');
}
// 接下來幾天要做的事（和網頁的「接下來」同一份），做成一段純文字；每日提醒和「預覽」都用它。
function buildDigest(days) {
  const now = nowKey(), today = now.slice(0, 10);
  const until = L.addDays(today, Math.max(0, days));
  const items = [];
  for (const r of L.agenda(records.apps, progOf, now, logicOpts()).rows) {
    if (r.date > until) continue;
    const a = records.apps.find(x => x.id === r.appId);
    items.push({date: r.date < today ? today : r.date, time: r.date < today ? '' : (r.mail ? '' : r.time), text: `${L.shortSchool(a.school, ALIAS)} ${rowText(r, now)}${r.date < today ? `（${mdOf(r.date)} 還沒處理）` : ''}`});
  }
  for (const t of records.todos || []) {
    if (t.done || !isDate(t.due) || t.due > until) continue;
    const a = t.appId && records.apps.find(x => x.id === t.appId);
    items.push({date: t.due < today ? today : t.due, time: '', text: `待辦｜${t.text}${a ? `（${L.shortSchool(a.school, ALIAS)}）` : ''}${t.due < today ? `（${mdOf(t.due)} 到期）` : ''}`});
  }
  items.sort((x, y) => x.date.localeCompare(y.date) || (x.time || '').localeCompare(y.time || ''));
  const lines = [`特選提醒｜${mdOf(today)}（${L.weekday(today)}）`];
  let cur = '';
  for (const it of items) {
    if (it.date !== cur) { cur = it.date; lines.push('', `▌${L.dayLabel(cur, now)}`); }
    lines.push(`${it.time ? it.time + ' ' : ''}${it.text}`);
  }
  if (!items.length) lines.push('', `接下來 ${days} 天沒有要處理的事。`);
  return {today, count: items.length, text: lines.join('\n')};
}
function postJson(url, body) {
  return fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)});
}
const chunk = (s, n) => { const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out; };
async function sendNotify(text) {
  const cfg = (records.profile && records.profile.notify) || {};
  const sent = [], errors = [];
  if (/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(cfg.discord || '')) {
    try {
      for (const part of chunk(text, 1900)) { const r = await postJson(cfg.discord, {content: part}); if (!r.ok) throw new Error(`Discord 回應 ${r.status}`); }
      sent.push('discord');
    } catch (e) { errors.push(`Discord：${e.message}`); }
  }
  if (cfg.tgToken && cfg.tgChat) {
    try {
      for (const part of chunk(text, 4000)) {
        const r = await postJson(`https://api.telegram.org/bot${encodeURIComponent(cfg.tgToken)}/sendMessage`, {chat_id: cfg.tgChat, text: part});
        if (!r.ok) throw new Error(`Telegram 回應 ${r.status}`);
      }
      sent.push('telegram');
    } catch (e) { errors.push(`Telegram：${e.message}`); }
  }
  return {sent, errors};
}
const notifyConfigured = () => { const c = (records.profile && records.profile.notify) || {}; return !!(c.discord || (c.tgToken && c.tgChat)); };
// 每分鐘看一次：到了設定的時間、今天還沒送過，就把接下來幾天的摘要送出去。
async function notifyTick() {
  if (!notifyConfigured() || example) return;
  const cfg = records.profile.notify;
  const {date, time} = nowTaipei();
  // 到了設定的時間才送；電腦那時候睡著的話，醒來後當天補送一次。
  if (time < (cfg.time || '08:00') || records.notifyLastSent === date) return;
  records.notifyLastSent = date;
  const d = buildDigest(Number(cfg.days) || 7);
  if (!d.count && cfg.skipEmpty !== false) { await saveRecords(); return; }
  const r = await sendNotify(d.text);
  if (r.errors.length) console.warn('提醒傳送失敗：', r.errors.join('；'));
  await saveRecords();
}
// 同步到 Google Sheets：使用者在試算表的 Apps Script 貼一段程式並部署成網頁應用程式，這裡把總表 POST 過去。
const sheetsUrlOk = u => /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u || '');
async function syncSheets() {
  const cfg = (records.profile && records.profile.sheets) || {};
  if (!sheetsUrlOk(cfg.url)) throw Object.assign(new Error('請先在設定貼上 Apps Script 網址（結尾是 /exec）'), {status: 400});
  const t = buildTable();
  const r = await postJson(cfg.url, {sheet: cfg.sheet || '特選紀錄', headers: t.headers, rows: t.rows, updated: t.updated, digest: buildDigest(14).text});
  const body = await r.text();
  if (!r.ok) throw new Error(`Google 回應 ${r.status}`);
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* Apps Script 有時回 HTML（例如還沒授權） */ }
  if (!parsed || !parsed.ok) throw new Error(parsed && parsed.error ? parsed.error : '試算表沒有回應 ok，請確認 Apps Script 已部署、存取權是「所有人」');
  records.profile.sheets = {...cfg, lastSync: new Date().toISOString(), lastError: ''};
  return {rows: t.rows.length, at: records.profile.sheets.lastSync};
}
let sheetTimer = null, sheetDirty = false;
function scheduleSheetSync() {
  const cfg = (records.profile && records.profile.sheets) || {};
  if (!cfg.auto || !sheetsUrlOk(cfg.url)) return;
  sheetDirty = true;
  if (sheetTimer) return;
  sheetTimer = setTimeout(async () => {
    sheetTimer = null;
    if (!sheetDirty) return;
    sheetDirty = false;
    try { await syncSheets(); }
    catch (e) { records.profile.sheets = {...records.profile.sheets, lastError: e.message}; console.warn('同步 Google Sheets 失敗：', e.message); }
    // 寫回 lastSync／lastError，但不要再觸發一次同步。
    saveRecords({sheets: false}).catch(() => {});
  }, 4000);
}

/* ---------- helpers ---------- */
function send(res, status, body, headers = {}) {
  res.writeHead(status, {'Cache-Control': 'no-store', ...headers});
  res.end(body);
}
function sendJson(req, res, status, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  if (buf.length > 2048 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    return send(res, status, zlib.gzipSync(buf), {'Content-Type': TYPES['.json'], 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding'});
  }
  send(res, status, buf, {'Content-Type': TYPES['.json']});
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('資料太大'), {status: 413})); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null); }
      catch { reject(Object.assign(new Error('JSON 格式錯誤'), {status: 400})); }
    });
    req.on('error', reject);
  });
}
async function persist(req, res) {
  try { await saveRecords(); return true; }
  catch (e) { sendJson(req, res, 500, {error: `沒有存到（${e.code || e.message}）`}); return false; }
}
// 伺服器保管的欄位（簡章來源、同步基準、完整文字）網頁沒送回來時，從原本那一列補回去。
function carryOver(app, cur) {
  if (!cur) return;
  const byId = list => new Map((Array.isArray(list) ? list : []).filter(isPlainObject).map(x => [x.id, x]));
  const oldDates = byId(cur.dates), oldDocs = byId(cur.docs);
  for (const d of Array.isArray(app.dates) ? app.dates : []) { const o = isPlainObject(d) && oldDates.get(d.id); if (o) for (const k of ['src', 'ref', 'bro', 'from', 'fromTime', 'upd', 'gone', 'brochureNow']) if (d[k] === undefined && o[k] !== undefined) d[k] = o[k]; }
  for (const d of Array.isArray(app.docs) ? app.docs : []) { const o = isPlainObject(d) && oldDocs.get(d.id); if (o) for (const k of ['src', 'ref', 'full', 'opt', 'gone']) if (d[k] === undefined && o[k] !== undefined) d[k] = o[k]; }
  for (const k of ['v', 'hidden', 'color']) if (app[k] === undefined && cur[k] !== undefined) app[k] = cur[k];
}
const lanAddresses = () => Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
const cleanTodos = list => list.filter(t => isPlainObject(t) && ID_RE.test(String(t.id || '')) && typeof t.text === 'string').slice(0, 500)
  .map(t => ({id: t.id, text: t.text.slice(0, 300), due: isDate(t.due) ? t.due : '', appId: typeof t.appId === 'string' ? t.appId : '', done: !!t.done, createdAt: Number(t.createdAt) || Date.now()}));

/* ---------- static files ---------- */
// /data/ 底下只給這些：簡章資料與 PDF、全文。紀錄、備份、overrides 都不給。
const DATA_OK = /^(programs\.json|search-terms\.json|school-links\.json|season\.json|brochures\/pdf\/[\w-]+\.pdf|brochures\/text\/[\w-]+\.json)$/;
const gzCache = new Map();
async function serveStatic(req, res, baseDir, relPath) {
  const file = path.normalize(path.join(baseDir, relPath));
  if (!file.startsWith(baseDir + path.sep) && file !== baseDir) return send(res, 403, 'Forbidden');
  let stat;
  try { stat = await fsp.stat(file); } catch { return send(res, 404, 'Not found'); }
  if (stat.isDirectory()) return serveStatic(req, res, baseDir, path.join(relPath, 'index.html'));
  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';
  const compressible = ['.html', '.css', '.js', '.json', '.svg'].includes(ext);
  const gzip = compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  // ETag：檔案沒變就回 304，瀏覽器直接用已經下載過的。
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}${gzip ? '-gz' : ''}"`;
  const headers = {'Content-Type': type, 'Cache-Control': ext === '.pdf' ? 'max-age=86400' : 'no-cache', ETag: etag};
  if (String(req.headers['if-none-match'] || '').split(/\s*,\s*/).includes(etag)) {
    res.writeHead(304, {'Cache-Control': headers['Cache-Control'], ETag: etag, ...(compressible ? {Vary: 'Accept-Encoding'} : {})});
    return res.end();
  }
  if (gzip) {
    const key = file + ':' + stat.mtimeMs;
    let gz = gzCache.get(key);
    if (!gz) { gz = zlib.gzipSync(await fsp.readFile(file)); gzCache.set(key, gz); }
    return send(res, 200, req.method === 'HEAD' ? '' : gz, {...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding'});
  }
  res.writeHead(200, {...headers, 'Content-Length': stat.size});
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}
// programs.json 從記憶體送（可能併了 overrides）；programs.json 有 2 MB，ETag 用內容的 hash。
function servePrograms(req, res) {
  if (!DB.body) return send(res, 404, 'Not found');
  const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const etag = `W/"p-${DB.hash.slice(0, 16)}${gzip ? '-gz' : ''}"`;
  const headers = {'Content-Type': TYPES['.json'], 'Cache-Control': 'no-cache', ETag: etag, Vary: 'Accept-Encoding'};
  if (String(req.headers['if-none-match'] || '').split(/\s*,\s*/).includes(etag)) { res.writeHead(304, headers); return res.end(); }
  if (gzip) { DB.bodyGz = DB.bodyGz || zlib.gzipSync(DB.body); return send(res, 200, req.method === 'HEAD' ? '' : DB.bodyGz, {...headers, 'Content-Encoding': 'gzip'}); }
  return send(res, 200, req.method === 'HEAD' ? '' : DB.body, headers);
}

/* ---------- API ---------- */
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const [resource, id] = parts;
  const write = req.method !== 'GET' && req.method !== 'HEAD';
  if (write && !(Number(req.headers['x-client']) >= CLIENT_VERSION)) return sendJson(req, res, 409, {error: '網頁已更新，請重新整理'});

  if (resource === 'records' && req.method === 'GET' && !id) return sendJson(req, res, 200, records);

  if (resource === 'meta' && req.method === 'GET') {
    return sendJson(req, res, 200, {...DB.meta, lan: lanAddresses(), port: server.address().port, host: HOST, recovered, example, syncLog: records.syncLog[records.syncLog.length - 1] || null});
  }

  if (resource === 'search' && req.method === 'GET') return sendJson(req, res, 200, search(String(url.searchParams.get('q') || '').slice(0, 100)));

  if (resource === 'brochure' && req.method === 'GET' && id) {
    const pages = DB.pages.get(id);
    if (!pages) return sendJson(req, res, 404, {error: '沒有這間學校的簡章全文'});
    const want = String(url.searchParams.get('pages') || '').split(',').map(Number).filter(n => n >= 1 && n <= pages.length).slice(0, 12);
    const school = DB.schools.find(s => s.code === id);
    return sendJson(req, res, 200, {code: id, school: school && school.name, total: pages.length, pages: want.map(n => ({page: n, text: pages[n - 1].text}))});
  }

  if (resource === 'apps' && id) {
    if (!ID_RE.test(id)) return sendJson(req, res, 400, {error: '學校紀錄的 id 格式不正確'});
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (!isPlainObject(body) || typeof body.school !== 'string') return sendJson(req, res, 400, {error: '缺少學校名稱'});
      const i = records.apps.findIndex(a => a.id === id);
      const cur = i >= 0 ? records.apps[i] : null;
      // 每間學校一個版本號：網頁手上的版本不是最新的，就把最新的給它，讓它重做一次改動。
      if (cur && Number(body.rev || 0) !== Number(cur.rev || 0)) return sendJson(req, res, 409, {error: '這間學校在別的地方改過了', app: cur});
      let app = {...body, id};
      carryOver(app, cur);
      if (app.v !== 3) app = L.migrateApp(app, progOf(app.programId), cur ? colorIndex(cur) : records.apps.length);
      app.rev = (Number(cur && cur.rev) || 0) + 1;
      app.updatedAt = new Date().toISOString();
      if (i >= 0) records.apps[i] = app; else records.apps.push(app);
      if (!await persist(req, res)) return;
      return sendJson(req, res, 200, app);
    }
    if (req.method === 'DELETE') {
      if (!records.apps.some(a => a.id === id)) return sendJson(req, res, 404, {error: '沒有這間學校'});
      records.apps = records.apps.filter(a => a.id !== id);
      if (!await persist(req, res)) return;
      return send(res, 204, '');
    }
  }

  if (resource === 'profile' && req.method === 'PUT') {
    const body = await readBody(req);
    if (!isPlainObject(body)) return sendJson(req, res, 400, {error: '格式不正確'});
    // lastSync／lastError 是伺服器寫的，網頁手上的可能是舊的
    const prev = (records.profile && records.profile.sheets) || {};
    if (isPlainObject(body.sheets)) body.sheets = {...body.sheets, lastSync: prev.lastSync || '', lastError: prev.lastError || ''};
    records.profile = body;
    if (!await persist(req, res)) return;
    return sendJson(req, res, 200, records.profile);
  }

  if (resource === 'todos' && req.method === 'PUT') {
    const body = await readBody(req);
    if (!Array.isArray(body)) return sendJson(req, res, 400, {error: '待辦清單格式不正確'});
    records.todos = cleanTodos(body);
    if (!await persist(req, res)) return;
    return sendJson(req, res, 200, records.todos);
  }

  if (resource === 'digest' && req.method === 'GET') return sendJson(req, res, 200, buildDigest(Math.min(60, Number(url.searchParams.get('days')) || 7)));

  if (resource === 'notify' && id === 'test' && req.method === 'POST') {
    if (!notifyConfigured()) return sendJson(req, res, 400, {error: '還沒設定 Discord webhook 或 Telegram'});
    const d = buildDigest(Number((records.profile.notify || {}).days) || 7);
    const r = await sendNotify(d.text);
    return sendJson(req, res, r.sent.length ? 200 : 502, {...r, count: d.count});
  }

  if (resource === 'sheets' && id === 'sync' && req.method === 'POST') {
    let r;
    try { r = await syncSheets(); }
    catch (e) { return sendJson(req, res, e.status || 502, {error: e.message}); }
    try { await saveRecords({sheets: false}); } catch { /* lastSync 沒寫進去不影響結果 */ }
    return sendJson(req, res, 200, r);
  }

  if (resource === 'table' && req.method === 'GET') return sendJson(req, res, 200, buildTable());
  if (resource === 'table.csv' && req.method === 'GET') return send(res, 200, tableCsv(), {'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="special-study-${nowTaipei().date}.csv"`});
  if (resource === 'export.md' && req.method === 'GET') return send(res, 200, buildMarkdown(), {'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="special-study-${nowTaipei().date}.md"`});

  // 從備份匯入：先備份現在的檔案，每間學校先遷移再依 id 取代或加入；設定合併；待辦整理後補上沒有的。?dry=1 只回報會取代幾間。
  if (resource === 'import' && req.method === 'POST') {
    const body = await readBody(req);
    if (!isPlainObject(body) || !Array.isArray(body.apps)) return sendJson(req, res, 400, {error: '這不是有效的備份檔'});
    const incoming = body.apps.filter(a => isPlainObject(a) && typeof a.school === 'string' && ID_RE.test(String(a.id || '')));
    const replace = incoming.filter(a => records.apps.some(x => x.id === a.id)).length;
    if (url.searchParams.get('dry')) return sendJson(req, res, 200, {apps: incoming.length, replace});
    try { await backupBefore('import'); }
    catch (e) { return sendJson(req, res, 500, {error: `沒有先備份成功，不匯入（${e.code || e.message}）`}); }
    for (const a of incoming) {
      const i = records.apps.findIndex(x => x.id === a.id);
      const cur = i >= 0 ? records.apps[i] : null;
      const m = L.migrateApp(a, progOf(a.programId), cur ? colorIndex(cur) : records.apps.length);
      const app = {...m, rev: Math.max(Number(m.rev) || 0, Number(cur && cur.rev) || 0) + 1, updatedAt: new Date().toISOString()};
      if (i >= 0) records.apps[i] = app; else records.apps.push(app);
    }
    if (isPlainObject(body.profile)) {
      const sheets = records.profile.sheets;
      records.profile = {...records.profile, ...body.profile};
      if (sheets && isPlainObject(records.profile.sheets)) records.profile.sheets = {...records.profile.sheets, lastSync: sheets.lastSync || '', lastError: sheets.lastError || ''};
    }
    if (Array.isArray(body.todos)) for (const t of cleanTodos(body.todos)) if (!records.todos.some(x => x.id === t.id)) records.todos.push(t);
    if (!await persist(req, res)) return;
    return sendJson(req, res, 200, {imported: incoming.length, replaced: replace});
  }

  if (resource === 'calendar.ics' && req.method === 'GET') {
    return send(res, 200, buildIcs(), {'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="special-study.ics"'});
  }

  if (resource === 'export' && req.method === 'GET') {
    const name = `special-study-backup-${nowTaipei().date}.json`;
    return send(res, 200, JSON.stringify(records, null, 2), {'Content-Type': TYPES['.json'], 'Content-Disposition': `attachment; filename="${name}"`});
  }

  return sendJson(req, res, 404, {error: '找不到這個 API'});
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Bad request'); }
    if (rel.startsWith('/data/')) {
      rel = rel.slice('/data/'.length);
      // 正規化後要完全一樣（擋 //、..、%2f）且在白名單裡
      if (path.posix.normalize(rel) !== rel || !DATA_OK.test(rel)) return send(res, 403, 'Forbidden');
      if (rel === 'programs.json') return servePrograms(req, res);
      return await serveStatic(req, res, DATA_DIR, rel);
    }
    return await serveStatic(req, res, PUBLIC_DIR, rel);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) sendJson(req, res, status, {error: status === 500 ? '伺服器發生錯誤' : e.message});
  }
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`連接埠 ${PORT} 已經被其他程式使用。請換一個，例如：PORT=5181 node server.js`);
  else console.error(e);
  process.exit(1);
});

async function main() {
  // logic.js 載入失敗就停在這裡，任何寫入之前
  try { L = await import(pathToFileURL(path.join(PUBLIC_DIR, 'js/logic.js')).href); }
  catch (e) { console.error('無法載入 public/js/logic.js：', e); process.exit(1); }
  loadProgramData();
  records = loadRecords();
  await prepareRecords();
  setInterval(() => notifyTick().catch(e => console.warn('提醒排程錯誤：', e.message)), 60 * 1000).unref();
  server.listen(PORT, HOST, () => {
    const port = server.address().port;
    console.log(`我的特選紀錄已啟動：http://localhost:${port}`);
    if (HOST === '0.0.0.0') for (const a of lanAddresses()) console.log(`  內網：http://${a}:${port}`);
    console.log(`  個人紀錄：${path.relative(process.cwd(), RECORDS) || RECORDS}${example ? '（還沒有，先顯示範例）' : ''}`);
  });
}
main().catch(e => { console.error('啟動失敗：', e); process.exit(1); });
