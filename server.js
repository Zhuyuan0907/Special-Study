// 我的特選紀錄 — 本機伺服器（不需要安裝任何套件）
//   node server.js            → http://localhost:5180
//   PORT=3000 HOST=127.0.0.1 node server.js
//
// 個人紀錄存在 data/records.json；科系與簡章資料在 data/programs.json。

'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const RECORDS = path.join(DATA_DIR, 'records.json');
const RECORDS_EXAMPLE = path.join(DATA_DIR, 'records.example.json');
const PORT = Number(process.env.PORT) || 5180;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_.~:@+-]{1,120}$/;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

/* ---------- records store ---------- */
let records = null;
let writeChain = Promise.resolve();

function loadRecords() {
  for (const file of [RECORDS, RECORDS_EXAMPLE]) {
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {version: 1, apps: Array.isArray(d.apps) ? d.apps : [], profile: d.profile && typeof d.profile === 'object' ? d.profile : {}, updatedAt: d.updatedAt || null};
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn(`無法讀取 ${path.basename(file)}：${e.message}`);
    }
  }
  return {version: 1, apps: [], profile: {}, updatedAt: null};
}

function saveRecords() {
  records.updatedAt = new Date().toISOString();
  const body = JSON.stringify(records, null, 2) + '\n';
  writeChain = writeChain.then(async () => {
    const tmp = RECORDS + '.tmp';
    await fsp.writeFile(tmp, body, 'utf8');
    await fsp.rename(tmp, RECORDS);
  }).catch(e => console.error('儲存 records.json 失敗：', e));
  return writeChain;
}

/* ---------- 科系資料與簡章全文搜尋 ---------- */
const TERMS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'search-terms.json'), 'utf8'));
const SYN = TERMS.synonyms;
const ALIAS = TERMS.aliases;

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

const DB = {programs: [], schools: [], byId: new Map(), pages: new Map(), general: [], meta: {year: null, fetched: '', pdfSchools: []}};
function loadProgramData() {
  const file = path.join(DATA_DIR, 'programs.json');
  if (!fs.existsSync(file)) { console.warn('找不到 data/programs.json，請先執行 npm run build-data'); return; }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  DB.schools = d.schools;
  const pdfDir = path.join(DATA_DIR, 'brochures/pdf');
  DB.meta = {year: d.year || null, fetched: d.fetched || '', source: d.source || '', pdfSchools: d.schools.filter(s => fs.existsSync(path.join(pdfDir, `${s.code}.pdf`))).map(s => s.code)};
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

/* ---------- 行事曆訂閱（iCalendar） ---------- */
const KIND_LABEL = {reg: '報名截止', pay: '繳費截止', upload: '資料上傳截止', letter: '推薦函截止', stage1: '面試名單公布', window: '甄試期間', interview: '面試', exam: '筆試／術科', release: '放榜', review: '成績複查', confirm: '報到截止', giveup: '放棄截止', wait: '備取遞補', other: '其他'};
const DEADLINE_KINDS = new Set(['reg', 'pay', 'upload', 'letter', 'confirm', 'giveup', 'review']);
const icsText = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = k => k.replace(/-/g, '');
const icsFold = line => { const out = []; let s = line; while (Buffer.byteLength(s) > 70) { let cut = 70; while (Buffer.byteLength(s.slice(0, cut)) > 70) cut--; out.push(s.slice(0, cut)); s = ' ' + s.slice(cut); } out.push(s); return out.join('\r\n'); };
function addDaysKey(k, n) { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function buildIcs() {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//special-study//我的特選紀錄//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:我的特選紀錄', 'X-WR-TIMEZONE:Asia/Taipei',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Taipei', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0800', 'TZOFFSETTO:+0800', 'TZNAME:CST', 'END:STANDARD', 'END:VTIMEZONE'];
  for (const a of records.apps) {
    for (const d of a.dates || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) continue;
      const label = KIND_LABEL[d.kind] || KIND_LABEL.other;
      const title = `${a.school}${a.dept ? ' ' + a.dept : ''}｜${label}`;
      const timed = /^\d{2}:\d{2}$/.test(d.time || '');
      const last = /^\d{4}-\d{2}-\d{2}$/.test(d.end || '') && d.end > d.date ? d.end : d.date;
      lines.push('BEGIN:VEVENT', `UID:${a.id}-${d.id || icsDate(d.date)}@special-study`, `DTSTAMP:${now}`, `SUMMARY:${icsText(title)}`);
      if (timed) {
        const [h, m] = d.time.split(':').map(Number);
        const hh = String(h).padStart(2, '0'), mm = String(m).padStart(2, '0');
        lines.push(`DTSTART;TZID=Asia/Taipei:${icsDate(d.date)}T${hh}${mm}00`, `DTEND;TZID=Asia/Taipei:${icsDate(d.date)}T${String(Math.min(h + 1, 23)).padStart(2, '0')}${mm}00`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${icsDate(d.date)}`, `DTEND;VALUE=DATE:${icsDate(addDaysKey(last, 1))}`);
      }
      if (d.note) lines.push(`DESCRIPTION:${icsText(d.note)}`);
      // 截止類的日期：前一天提醒一次；有時間的再於三小時前提醒一次。
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(title)}`, 'TRIGGER:-P1D', 'END:VALARM');
      if (timed && DEADLINE_KINDS.has(d.kind)) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(title)}`, 'TRIGGER:-PT3H', 'END:VALARM');
      lines.push('END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
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
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/* ---------- static files ---------- */
const gzCache = new Map();
async function serveStatic(req, res, baseDir, relPath) {
  const file = path.normalize(path.join(baseDir, relPath));
  if (!file.startsWith(baseDir + path.sep) && file !== baseDir) return send(res, 403, 'Forbidden');
  let stat;
  try { stat = await fsp.stat(file); } catch { return send(res, 404, 'Not found'); }
  if (stat.isDirectory()) return serveStatic(req, res, baseDir, path.join(relPath, 'index.html'));
  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';
  const headers = {'Content-Type': type, 'Cache-Control': ext === '.pdf' ? 'max-age=86400' : 'no-cache'};
  const compressible = ['.html', '.css', '.js', '.json', '.svg'].includes(ext);
  if (compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const key = file + ':' + stat.mtimeMs;
    let gz = gzCache.get(key);
    if (!gz) { gz = zlib.gzipSync(await fsp.readFile(file)); gzCache.set(key, gz); }
    return send(res, 200, req.method === 'HEAD' ? '' : gz, {...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding'});
  }
  res.writeHead(200, {...headers, 'Content-Length': stat.size});
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/* ---------- API ---------- */
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const [resource, id] = parts;

  if (resource === 'records' && req.method === 'GET' && !id) return sendJson(req, res, 200, records);

  if (resource === 'meta' && req.method === 'GET') return sendJson(req, res, 200, DB.meta);

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
      const app = {...body, id, updatedAt: new Date().toISOString()};
      const i = records.apps.findIndex(a => a.id === id);
      if (i >= 0) records.apps[i] = app; else records.apps.push(app);
      await saveRecords();
      return sendJson(req, res, 200, app);
    }
    if (req.method === 'DELETE') {
      records.apps = records.apps.filter(a => a.id !== id);
      await saveRecords();
      return send(res, 204, '');
    }
  }

  if (resource === 'profile' && req.method === 'PUT') {
    const body = await readBody(req);
    if (!isPlainObject(body)) return sendJson(req, res, 400, {error: '格式不正確'});
    records.profile = body;
    await saveRecords();
    return sendJson(req, res, 200, records.profile);
  }

  if (resource === 'import' && req.method === 'POST') {
    const body = await readBody(req);
    if (!isPlainObject(body) || !Array.isArray(body.apps)) return sendJson(req, res, 400, {error: '這不是有效的備份檔'});
    let n = 0;
    for (const a of body.apps) {
      if (!isPlainObject(a) || typeof a.school !== 'string' || !ID_RE.test(String(a.id || ''))) continue;
      const i = records.apps.findIndex(x => x.id === a.id);
      if (i >= 0) records.apps[i] = a; else records.apps.push(a);
      n++;
    }
    if (isPlainObject(body.profile)) records.profile = body.profile;
    await saveRecords();
    return sendJson(req, res, 200, {imported: n});
  }

  if (resource === 'calendar.ics' && req.method === 'GET') {
    return send(res, 200, buildIcs(), {'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="special-study.ics"'});
  }

  if (resource === 'export' && req.method === 'GET') {
    const name = `special-study-backup-${new Date().toISOString().slice(0, 10)}.json`;
    return send(res, 200, JSON.stringify(records, null, 2), {'Content-Type': TYPES['.json'], 'Content-Disposition': `attachment; filename="${name}"`});
  }

  return sendJson(req, res, 404, {error: '找不到這個 API'});
}

/* ---------- server ---------- */
records = loadRecords();
loadProgramData();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    if (url.pathname.startsWith('/data/')) {
      const rel = decodeURIComponent(url.pathname.slice('/data/'.length));
      if (rel === 'records.json' || rel.startsWith('records')) return send(res, 403, 'Forbidden');
      return await serveStatic(req, res, DATA_DIR, rel);
    }
    return await serveStatic(req, res, PUBLIC_DIR, decodeURIComponent(url.pathname));
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
server.listen(PORT, HOST, () => {
  const nets = Object.values(require('node:os').networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal);
  console.log(`我的特選紀錄已啟動：http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') for (const n of nets) console.log(`  內網：http://${n.address}:${PORT}`);
  console.log(`  個人紀錄：${path.relative(process.cwd(), RECORDS) || RECORDS}`);
});
