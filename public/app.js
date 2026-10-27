'use strict';
(() => {

/* ---------- vocabulary ---------- */
const STATUS = {
  prep: {label: '準備中', tone: ''},
  applied: {label: '已報名', tone: 'info'},
  interview: {label: '通過一階・待面試', tone: 'info'},
  waiting: {label: '已面試・等放榜', tone: 'info'},
  admitted: {label: '正取', tone: 'ok'},
  waitlist: {label: '備取', tone: 'warn'},
  rejected: {label: '未錄取', tone: 'muted'},
  out: {label: '一階未通過', tone: 'muted'},
  skipped: {label: '沒有報名', tone: 'muted'},
};
const KINDS = {
  reg: {label: '報名截止', cat: 'k-due'},
  pay: {label: '繳費截止', cat: 'k-due'},
  upload: {label: '資料上傳截止', cat: 'k-due'},
  letter: {label: '推薦函截止', cat: 'k-due'},
  stage1: {label: '面試名單公布', cat: 'k-result'},
  window: {label: '甄試期間', cat: 'k-test'},
  interview: {label: '面試', cat: 'k-test'},
  exam: {label: '筆試／術科', cat: 'k-test'},
  release: {label: '放榜', cat: 'k-result'},
  review: {label: '成績複查', cat: 'k-other'},
  confirm: {label: '報到截止', cat: 'k-due'},
  giveup: {label: '放棄截止', cat: 'k-due'},
  wait: {label: '備取遞補', cat: 'k-result'},
  other: {label: '其他', cat: 'k-other'},
};
const DEADLINE_KINDS = new Set(['reg', 'pay', 'upload', 'letter', 'confirm', 'giveup', 'review']);
const METHODS = ['資料審查', '面試', '筆試', '實作／術科'];
const DEFAULT_DOCS = ['自傳／個人陳述', '讀書計畫', '特殊表現證明文件', '推薦信', '系所指定其他資料'];
const SUGGEST = ['資工', '資安', 'AIS3', 'APCS', '奧林匹亞', '科展', '電機', '資管', '醫學', '生科', '數學', '物理', '化學', '設計', '外文', '法律', '心理', '教育'];
const REGION_NAME = {北: '北部', 中: '中部', 南: '南部', 東: '東部・離島'};
// 「依我的條件找科系」：勾選的經歷，對照簡章的報名資格文字。關鍵字比對前會先正規化（小寫、台→臺）。
const CONDITIONS = [
  {group: '資訊', items: [
    {id: 'apcs', label: 'APCS 程式設計先修檢測', kw: ['apcs', '程式設計先修']},
    {id: 'ais3', label: 'AIS3 資安暑期課程', kw: ['ais3', '新型態資安']},
    {id: 'jindun', label: '金盾獎', kw: ['金盾']},
    {id: 'ctf', label: 'CTF 資安競賽', kw: ['ctf']},
    {id: 'infocomp', label: '資訊學科能力競賽', kw: ['資訊學科', '學科能力競賽(資訊', '資訊科)複賽', '資訊科)決賽']},
    {id: 'progcomp', label: '程式設計競賽（NPSC、ICPC…）', kw: ['程式設計競賽', '程式競賽', 'npsc', 'icpc', 'toi', 'yti', 'apcs 程式']},
    {id: 'cpe', label: 'CPE 程式能力檢定', kw: ['cpe', '程式能力檢定']},
    {id: 'project', label: '自己做過程式專案／作品', kw: ['程式作品', 'github', '專案', '軟體', 'app']},
    {id: 'cert', label: '資訊相關證照', kw: ['證照', 'ipas', '乙級', '丙級']},
  ]},
  {group: '科學・數理', items: [
    {id: 'olympiad', label: '奧林匹亞（選訓營、決賽）', kw: ['奧林匹亞', '奧林匹克', '選訓']},
    {id: 'sciencefair', label: '科展', kw: ['科展', '科學展覽']},
    {id: 'mathcomp', label: '數學競賽（AMC、TRML…）', kw: ['數學競賽', 'amc', 'trml', '數學能力競賽', '數學科']},
    {id: 'research', label: '專題研究／小論文', kw: ['專題研究', '小論文', '研究成果', '科學研究', '研究報告']},
    {id: 'invention', label: '發明展／專利／創客', kw: ['發明', '專利', '創客', 'maker']},
  ]},
  {group: '語文・人文', items: [
    {id: 'english', label: '英語檢定（多益、托福、雅思…）', kw: ['toeic', 'toefl', 'ielts', '英檢', '多益', '英語能力', '英文能力', '英語檢定']},
    {id: 'otherlang', label: '其他外語檢定（日檢、德檢…）', kw: ['日檢', 'jlpt', '德語', '法語', '西班牙語', '韓語', '外語能力', '語言能力檢定']},
    {id: 'writing', label: '文學獎／寫作／創作', kw: ['文學獎', '徵文', '寫作', '作文', '文學創作']},
    {id: 'speech', label: '演說／辯論／朗讀', kw: ['演說', '辯論', '朗讀', '演講']},
  ]},
  {group: '藝術・體育', items: [
    {id: 'art', label: '美術／設計作品', kw: ['美術', '設計', '繪畫', '作品集', '視覺']},
    {id: 'music', label: '音樂／表演／舞蹈', kw: ['音樂', '演奏', '表演', '舞蹈', '戲劇']},
    {id: 'sports', label: '體育選手／運動成績', kw: ['運動', '體育', '選手', '全中運', '全國運動會', '競技']},
    {id: 'esports', label: '電競', kw: ['電競', '電子競技']},
  ]},
  {group: '社會參與・技能', items: [
    {id: 'leadership', label: '社團幹部／領導經驗', kw: ['社團', '幹部', '領導', '班聯會', '學生會']},
    {id: 'service', label: '志工／服務學習', kw: ['志工', '服務學習', '公益']},
    {id: 'business', label: '創業／商業競賽', kw: ['創業', '商業', '企劃', '行銷']},
    {id: 'skills', label: '技藝／技能競賽', kw: ['技藝競賽', '技能競賽', '工科技藝', '商科技藝', '技藝']},
  ]},
  {group: '身分（不同教育資歷）', items: [
    {id: 'experimental', label: '實驗教育／自學生', kw: ['實驗教育', '自學']},
    {id: 'newimmigrant', label: '新住民或其子女', kw: ['新住民']},
    {id: 'disadvantaged', label: '低收入／中低收入／特殊境遇', kw: ['低收入', '中低收入', '特殊境遇', '經濟弱勢', '弱勢']},
    {id: 'overseas', label: '境外臺生／僑生', kw: ['境外', '僑生', '海外']},
    {id: 'local', label: '在地／偏鄉／離島／原住民', kw: ['在地', '偏鄉', '離島', '原住民', '花東']},
    {id: 'vocational', label: '高職／技術型高中', kw: ['高職', '技術型高中', '技高']},
  ]},
];
const COND_BY_ID = new Map(CONDITIONS.flatMap(g => g.items).map(c => [c.id, c]));
const condText = p => p._cond !== undefined ? p._cond : (p._cond = normName([p.qx, p.tgt, p.deb, p.deo, p.nt, p.pr].filter(Boolean).join(' ')));
// 這個系的報名資格提到了我勾選的哪些條件
function matchedConds(p) {
  const tags = (S.profile.tags || []).map(id => COND_BY_ID.get(id)).filter(Boolean);
  if (!tags.length) return [];
  const text = condText(p);
  return tags.filter(c => c.kw.some(k => text.includes(normName(k))));
}
const REGION_ORDER = {北: 0, 中: 1, 南: 2, 東: 3};

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const pad = n => String(n).padStart(2, '0');
const toKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => toKey(new Date());
const isKey = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
const diffDays = k => Math.round((parseKey(k) - parseKey(todayKey())) / 864e5);
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return toKey(d); };
const md = k => { const d = parseKey(k); return `${d.getMonth() + 1}/${pad(d.getDate())}`; };
const fmtDate = k => { const d = parseKey(k); return d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}` : md(k); };
const wd = k => '週' + '日一二三四五六'[parseKey(k).getDay()];
const cdText = n => n === 0 ? '今天' : n === 1 ? '明天' : n === 2 ? '後天' : n > 0 ? `${n} 天後` : `${-n} 天前`;
const cdClass = n => n < 0 ? '' : n <= 1 ? 'now' : n <= 5 ? 'soon' : '';
const numOrNull = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const appName = a => a.school + (a.dept ? ' ' + a.dept : '');
const normName = s => String(s || '').replace(/台/g, '臺').replace(/\s+/g, '').toLowerCase();
// 注音、倉頡等輸入法還在選字時，Enter 與輸入事件都不能當成「完成輸入」。
const composing = e => e.isComposing || e.keyCode === 229;
// flush() runs the call now, but only if one is waiting.
const debounce = (fn, ms) => {
  let t = null;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  f.flush = (...a) => { if (t === null) return; clearTimeout(t); t = null; fn(...a); };
  return f;
};

async function request(method, url, body) {
  const res = await fetch(url, {method, headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------- state ---------- */
const S = {apps: [], profile: {}};
const P = {schools: [], programs: [], byId: new Map(), groups: [], fetched: '', year: null, pdf: new Set(), terms: {synonyms: {}, aliases: {}}, links: {}};
const t0 = new Date();
const ui = {cal: {y: t0.getFullYear(), m: t0.getMonth()}, day: null, q: '', region: '', open: false, nopf: false, norl: false, sort: 'smart', all: false, limit: 40, search: null, searching: false, match: false};

/* ---------- saving ---------- */
const inflight = {}, latest = {};
function persist(app) {
  latest[app.id] = app;
  if (inflight[app.id]) return inflight[app.id];
  setSaveState(app.id, 'saving');
  inflight[app.id] = (async () => {
    try {
      while (latest[app.id]) {
        const body = latest[app.id];
        delete latest[app.id];
        await request('PUT', `/api/apps/${encodeURIComponent(body.id)}`, body);
      }
      setSaveState(app.id, 'saved');
    } catch (e) {
      delete latest[app.id];
      setSaveState(app.id, 'error');
      toast('儲存失敗：' + e.message);
    } finally {
      delete inflight[app.id];
    }
  })();
  return inflight[app.id];
}
function upsertApp(app) {
  const i = S.apps.findIndex(a => a.id === app.id);
  if (i >= 0) S.apps[i] = app; else S.apps.push(app);
  renderMain();
  return persist(clone(app));
}
async function removeApp(id) {
  S.apps = S.apps.filter(a => a.id !== id);
  renderMain();
  delete latest[id];
  try { await inflight[id]; } catch { /* reported already */ }
  try { await request('DELETE', `/api/apps/${encodeURIComponent(id)}`); } catch (e) { toast('刪除失敗：' + e.message); }
}

/* ---------- derived ---------- */
function allEvents() {
  const out = [];
  for (const a of S.apps) for (const e of a.dates || []) {
    if (!isKey(e.date) || !KINDS[e.kind]) continue;
    const end = isKey(e.end) && e.end > e.date ? e.end : '';
    out.push({...e, end, last: end || e.date, app: a});
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || (x.time || '99').localeCompare(y.time || '99'));
}
const focusDate = ev => ev.date >= todayKey() ? ev.date : ev.last;
function upcoming(list = allEvents()) {
  const t = todayKey();
  return list.filter(ev => ev.last >= t).sort((a, b) => focusDate(a).localeCompare(focusDate(b)) || (a.time || '99').localeCompare(b.time || '99'));
}
function firstDate(app, kinds) {
  const t = todayKey();
  const ds = (app.dates || []).filter(d => kinds.includes(d.kind) && isKey(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  return ds.find(d => (d.end || d.date) >= t) || ds[ds.length - 1] || null;
}
function clashes() {
  const t = todayKey(), map = {};
  for (const ev of allEvents()) if ((ev.kind === 'interview' || ev.kind === 'exam') && ev.date >= t) (map[ev.date] ||= []).push(ev);
  return Object.entries(map).filter(([, evs]) => new Set(evs.map(e => e.app.id)).size > 1).map(([date, evs]) => ({date, evs}));
}
function alerts() {
  const out = [], t = todayKey();
  for (const c of clashes()) out.push({crit: true, text: `${fmtDate(c.date)} 面試撞期：${c.evs.map(e => appName(e.app)).join('、')}`});
  for (const a of S.apps) {
    const reg = firstDate(a, ['reg']);
    if (a.status === 'prep' && reg && reg.date >= t && diffDays(reg.date) <= 5) out.push({crit: diffDays(reg.date) <= 1, text: `${appName(a)} 報名${diffDays(reg.date) === 0 ? '今天' : ' ' + cdText(diffDays(reg.date))}${reg.time ? ' ' + reg.time : ''} 截止，還沒報名`});
    if (a.status === 'prep' && reg && reg.date < t && diffDays(reg.date) >= -14) out.push({text: `${appName(a)} 報名已在 ${fmtDate(reg.date)} 截止，還是「準備中」。點進去確認有沒有報名`});
    const left = (a.docs || []).filter(d => !d.done).length;
    const due = firstDate(a, ['upload', 'letter']) || reg;
    if (left && due && due.date >= t && diffDays(due.date) <= 7 && ['prep', 'applied'].includes(a.status)) out.push({text: `${appName(a)} 還有 ${left} 項備審沒完成，${fmtDate(due.date)} 截止`});
    if ((a.status === 'admitted' || a.status === 'waitlist') && !a.choice) {
      const cf = firstDate(a, ['confirm']);
      if (cf && cf.date >= t && diffDays(cf.date) <= 14) out.push({crit: diffDays(cf.date) <= 3, text: `${appName(a)} 要在 ${fmtDate(cf.date)} 前決定是否就讀`});
    }
    if (a.status === 'admitted' && a.choice === 'decline' && !a.giveupDone) {
      const g = firstDate(a, ['giveup']);
      out.push({crit: true, text: `${appName(a)} 記得${g ? `在 ${fmtDate(g.date)} 前` : ''}辦理放棄，否則不能參加其他管道`});
    }
  }
  return out;
}

/* ---------- program helpers ---------- */
const progReg = p => { const r = (p.ev || []).find(e => e[0] === 'reg'); return r ? {start: r[1], end: r[2] || r[1], time: r[4] || (!r[2] ? r[3] : '') || ''} : null; };
// 各校招生網與報名系統（data/school-links.json），用學校名稱找。
function schoolLinks(name) {
  const s = P.schools.find(x => x.name === name);
  return s && P.links[s.code] ? P.links[s.code] : null;
}
const extLink = (href, label) => `<a class="btn sm ext" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
// 簡章 PDF 只有執行過 build-data 的伺服器才有；沒有就不顯示 PDF 連結。
const pdfUrl = (code, page) => P.pdf.has(code) ? `/data/brochures/pdf/${code}.pdf${page ? '#page=' + page : ''}` : null;
const pev = (p, kinds) => (p.ev || []).find(e => kinds.includes(e[0])) || null;
const needsLetter = p => !!p.rl && /^[暗明]/.test(p.rl) && !/非必繳|選繳/.test(p.rl);
const isTest = n => /筆試|術科|實作|測驗|展演|專長/.test(n);
const itemClass = n => isTest(n) ? 'test' : /面試|口試/.test(n) ? 'iv' : /審查|書面|書審|資料/.test(n) ? 'doc' : 'other';
const rlText = rl => rl === 'N' ? '不需要' : rl.replace(/^暗/, '暗推').replace(/^明/, '明推');
// 簡章的繳交資料說明很長，清單只留名稱：「自傳(含學習歷程描述…)」→「自傳」。
function shortDoc(t) {
  let cut = -1;
  for (const m of t.matchAll(/[（(：:，,]/g)) {
    if (m.index < 2) continue;
    if (/[（(]/.test(m[0])) { const close = t.slice(m.index + 1).search(/[）)]/); if (close >= 0 && close <= 3) continue; }
    cut = m.index; break;
  }
  let n = cut > 0 ? t.slice(0, cut) : t;
  n = n.replace(/^(現為|依|本系|本校)/, '').trim();
  if (n.length > 28) n = n.slice(0, 28) + '…';
  return n || t.slice(0, 28);
}
const docListHtml = p => (p.docs || []).length ? `<div class="p-section"><h3>簡章要求繳交的資料<span class="src">自動節錄，請對照簡章</span></h3><ol class="doc-req">${p.docs.map(d => `<li>${esc(d)}</li>`).join('')}</ol></div>` : '';
const mine = pid => S.apps.find(a => a.programId === pid);
const regKey = p => { const t = todayKey(); return !p._reg ? '9' : p._reg.end >= t ? '0' + p._reg.end : '1' + p.i; };
// 「資安外加 資訊工程學系」→ 學系名稱「資訊工程學系」＋ 招生組別「資安外加」
function splitName(n) {
  const quals = [];
  let main = '';
  for (const tok of n.split(' ')) {
    if (/(系|學程|學士班|學院|學群)/.test(tok) && tok.length > main.length) { if (main) quals.push(main); main = tok; } else quals.push(tok);
  }
  if (!main) main = n;
  const paren = /[(（]([^)）]+)[)）]$/.exec(main);
  if (paren) { quals.push(paren[1]); main = main.slice(0, paren.index); }
  const letter = /([A-Z甲乙丙丁]組)$/.exec(main);
  if (letter && main.length > letter[1].length + 2) { quals.unshift(letter[1]); main = main.slice(0, -letter[1].length); }
  return {main, quals: quals.filter(Boolean)};
}
const qualPills = quals => quals.map(q => `<span class="pill">${esc(q)}</span>`).join('');
// Same department offered under several admission groups becomes one row.
function mergeRows(list) {
  const rows = [], byKey = new Map();
  for (const p of list) {
    const key = p.s + '|' + p._main;
    let r = byKey.get(key);
    if (!r) { r = {key, main: p._main, school: p.school, s: p.s, items: []}; byKey.set(key, r); rows.push(r); }
    r.items.push(p);
  }
  return rows;
}
function bySchool(rows) {
  const groups = [], byS = new Map();
  for (const r of rows) {
    let g = byS.get(r.s);
    if (!g) { g = {school: r.school, s: r.s, rows: []}; byS.set(r.s, g); groups.push(g); }
    g.rows.push(r);
  }
  return groups;
}
function regText(p) {
  const r = p._reg, t = todayKey();
  if (!r) return '';
  if (t < r.start) return `<span class="st-soon">報名 ${fmtDate(r.start)} 開始</span>`;
  if (t <= r.end) { const n = diffDays(r.end); return `<span class="st-open">報名中，${n === 0 ? '今天' : `剩 ${n} 天`}（${fmtDate(r.end)}${r.time ? ' ' + r.time : ''} 截止）</span>`; }
  return `<span>報名已截止（${fmtDate(r.end)}${r.time ? ' ' + r.time : ''}）</span>`;
}
function weightText(p) {
  const its = (p.it || []).filter(i => i[0]);
  const short = n => n.length <= 5 ? n : ({doc: '書審', iv: '面試', test: '考試', other: '其他'})[itemClass(n)];
  return its.map(([n, w]) => short(n) + (w != null ? ` ${w}%` : '')).join('・');
}
function progMeta(p, withQuota = true) {
  const iv = pev(p, ['interview', 'exam']), rel = pev(p, ['release']);
  return [withQuota && p.q != null && `名額 ${p.q}`, regText(p), iv && `${iv[0] === 'exam' ? '筆試' : '面試'} ${fmtDate(iv[1])}`, rel && `放榜 ${fmtDate(rel[1])}`, weightText(p)].filter(Boolean);
}
function programDates(p) {
  return (p.ev || []).filter(e => e[0] !== 'other').map(([kind, sd, ed, st, et, name, note]) => {
    const extra = note ? `・${note}` : '';
    if (DEADLINE_KINDS.has(kind) && ed) return {id: uid(), kind, date: ed, end: '', time: et || '', note: `${name}（${fmtDate(sd)}${st ? ' ' + st : ''} 起）${extra}`};
    return {id: uid(), kind, date: sd, end: ed || '', time: st || '', note: name + extra};
  });
}
function appFromProgram(p) {
  const m = new Set();
  for (const [n] of p.it || []) {
    if (/審查|書面|書審|資料/.test(n)) m.add('資料審查');
    if (/面試|口試/.test(n)) m.add('面試');
    if (/筆試|測驗/.test(n)) m.add('筆試');
    if (/術科|實作|展演|專長/.test(n)) m.add('實作／術科');
  }
  // 簡章有列「指定繳交資料」就用簡章的清單，否則用通用清單。
  const docs = (p.docs || []).length ? p.docs.map(shortDoc) : ['自傳／個人陳述', '讀書計畫', '特殊表現證明文件', '系所指定其他資料'];
  if (p.pf === 'Y' && !docs.some(x => /作品/.test(x))) docs.push('作品集' + (p.pfd ? `（${fmtDate(p.pfd)} 前）` : ''));
  if (p.rl && /^[暗明]/.test(p.rl) && !docs.some(x => /推薦/.test(x))) docs.push(`推薦信（${rlText(p.rl)}）`);
  const its = (p.it || []).map(([n, w]) => n + (w != null ? ` ${w}%` : '')).join('、');
  return {
    id: uid(), school: p.school, dept: p.n, programId: p.i, status: 'prep', methods: METHODS.filter(x => m.has(x)),
    fee: parseInt(p.fee, 10) || null, quota: p.q ?? null, url: /^https?:\/\//.test(p.u || '') ? p.u : '',
    dates: programDates(p), docs: docs.map(n => ({id: uid(), name: n, done: false})),
    notes: [p.ph && `諮詢電話：${p.ph}`, its && `甄選：${its}`].filter(Boolean).join('\n'),
    prep: '', asked: '', choice: '', waitNo: null, confirmDone: false, giveupDone: false, createdAt: Date.now(),
  };
}

/* ---------- top bar ---------- */
function renderTop() {
  const next = upcoming()[0];
  const el = $('#next');
  if (!next) {
    el.innerHTML = `<span class="next-label">下一個重要日期</span><span class="next-what">${S.apps.length ? '目前沒有未來的日期' : '按左邊「新增學校」加入學校後，這裡會倒數下一個日期'}</span>`;
  } else {
    const f = focusDate(next), n = diffDays(f), ongoing = next.date < todayKey();
    el.innerHTML = `<span class="next-label">下一個重要日期</span>
      <span class="next-days ${n <= 1 ? 'hot' : ''}">${n === 0 ? '今天' : n === 1 ? '明天' : `${n}<small>天後</small>`}</span>
      <span class="next-what"><span class="tag ${KINDS[next.kind].cat}">${KINDS[next.kind].label}${ongoing ? '（進行中）' : ''}</span><b>${esc(appName(next.app))}</b><span>${fmtDate(f)}（${wd(f)}）${next.time ? ' ' + esc(next.time) : ''}</span></span>`;
  }
  const c = k => S.apps.filter(a => a.status === k).length;
  const items = [['學校', S.apps.length, ''], ['已報名', S.apps.filter(a => !['prep', 'skipped'].includes(a.status)).length, ''], ['待面試', c('applied') + c('interview'), ''], ['正取', c('admitted'), 'ok'], ['備取', c('waitlist'), 'warn']];
  $('#stats').innerHTML = items.map(([k, v, cls]) => `<div class="stat ${cls}"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

/* ---------- my schools ---------- */
let clearArmed = false;
function renderSchools() {
  $('#school-count').textContent = S.apps.length || '';
  const ex = S.apps.filter(a => a.example).length;
  $('#example-note').innerHTML = ex ? `<div class="example-note"><span>有 ${ex} 筆是示範用的範例</span><button class="link ${clearArmed ? 'armed' : ''}" type="button" id="clear-ex">${clearArmed ? '再按一次確認清除' : '清除範例'}</button></div>` : '';
  const list = $('#school-list');
  if (!S.apps.length) {
    list.innerHTML = `<li class="empty"><b>還沒有學校</b><span>按上面的「新增學校」，<br>選學校和科系，簡章日期會自動帶入。</span></li>`;
    return;
  }
  const order = {admitted: 0, waitlist: 1, interview: 2, waiting: 3, applied: 4, prep: 5, rejected: 6, out: 7, skipped: 8};
  const nextOf = a => upcoming(allEvents().filter(ev => ev.app.id === a.id))[0];
  const apps = [...S.apps].sort((a, b) => {
    const na = nextOf(a), nb = nextOf(b);
    return (order[a.status] ?? 9) - (order[b.status] ?? 9) || (na ? focusDate(na) : '9').localeCompare(nb ? focusDate(nb) : '9');
  });
  list.innerHTML = apps.map(a => {
    const st = STATUS[a.status] || STATUS.prep, nx = nextOf(a);
    const docs = a.docs || [], done = docs.filter(d => d.done).length;
    const label = a.status === 'waitlist' && a.waitNo ? `備取 ${a.waitNo}` : st.label;
    let nextHtml = '<span>沒有未來的日期</span>';
    if (nx) {
      const f = focusDate(nx), n = diffDays(f);
      nextHtml = `<span class="tag ${KINDS[nx.kind].cat}">${KINDS[nx.kind].label}</span><span>${fmtDate(f)}${nx.time ? ' ' + esc(nx.time) : ''}</span><span class="cd ${cdClass(n)}">${nx.date < todayKey() ? '進行中' : cdText(n)}</span>`;
    }
    return `<li><button class="school" type="button" data-app="${esc(a.id)}">
      <span class="school-top"><span class="school-name">${esc(a.school)}</span><span class="pill ${st.tone}">${label}</span></span>
      <span class="school-dept">${esc(a.dept || '（還沒填學系）')}${a.example ? ' <span class="pill example">範例</span>' : ''}</span>
      <span class="school-meta"><span class="school-next">${nextHtml}</span>${docs.length ? `<span class="school-docs">備審 ${done}/${docs.length}</span>` : ''}</span>
    </button></li>`;
  }).join('');
}
function flashSchool(id) {
  const b = $(`#school-list [data-app="${CSS.escape(id)}"]`);
  if (!b) return;
  b.scrollIntoView({block: 'nearest'});
  b.classList.remove('flash');
  void b.offsetWidth;
  b.classList.add('flash');
}

/* ---------- timeline ---------- */
function renderTimeline() {
  const al = alerts().slice(0, 3);
  $('#alerts').innerHTML = al.map(a => `<div class="alert ${a.crit ? 'crit' : ''}" title="${esc(a.text)}"><span class="alert-icon" aria-hidden="true">!</span><span class="alert-text">${esc(a.text)}</span></div>`).join('');

  const {y, m} = ui.cal, t = todayKey();
  $('#cal-title').textContent = `${y} 年 ${m + 1} 月`;
  const evs = allEvents(), byDay = {};
  for (const ev of evs) { (byDay[ev.date] ||= []).push(ev); if (ev.end) (byDay[ev.end] ||= []).push(ev); }
  const clash = new Set(clashes().map(c => c.date));
  const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
  let html = '日一二三四五六'.split('').map(c => `<span class="cal-wd">${c}</span>`).join('');
  for (let i = 0; i < first.getDay(); i++) html += '<span class="day pad"></span>';
  for (let d = 1; d <= days; d++) {
    const k = `${y}-${pad(m + 1)}-${pad(d)}`, list = byDay[k] || [];
    const cats = [...new Set(list.map(e => KINDS[e.kind].cat))].slice(0, 3);
    const cls = ['day', k === t && 'today', k < t && 'past', ui.day === k && 'sel', clash.has(k) && 'clash'].filter(Boolean).join(' ');
    html += `<button class="${cls}" type="button" data-day="${k}" aria-label="${m + 1} 月 ${d} 日${list.length ? `，${list.length} 個日期` : ''}${clash.has(k) ? '，面試撞期' : ''}"><span class="n">${d}</span><span class="dots">${cats.map(c => `<i class="dot ${c}"></i>`).join('')}</span></button>`;
  }
  $('#calendar').innerHTML = html;

  let list;
  if (ui.day) {
    list = evs.filter(ev => ev.date === ui.day || ev.end === ui.day);
    $('#ev-title').textContent = `${fmtDate(ui.day)}（${wd(ui.day)}）的日期`;
  } else {
    list = upcoming(evs);
    $('#ev-title').textContent = '接下來的日期';
  }
  $('#ev-clear').hidden = !ui.day;
  const ol = $('#events');
  if (!list.length) {
    ol.innerHTML = `<li class="empty">${ui.day ? '這天沒有排定的日期。' : S.apps.length ? '接下來沒有排定的日期。' : '加入學校後，報名、面試、放榜日期會依序列在這裡。'}</li>`;
    return;
  }
  ol.innerHTML = list.map(ev => {
    const ongoing = ev.date < t && ev.last >= t, f = ui.day || focusDate(ev), n = diffDays(f);
    const tip = [KINDS[ev.kind].label, appName(ev.app), ev.end ? `${fmtDate(ev.date)}–${fmtDate(ev.end)}` : fmtDate(ev.date), ev.time, ev.note].filter(Boolean).join('｜');
    const deadline = DEADLINE_KINDS.has(ev.kind);
    const rowCls = !ongoing && deadline && n >= 0 && n <= 1 ? 'now-row' : !ongoing && deadline && n <= 3 && n >= 0 ? 'soon-row' : '';
    return `<li class="ev ${ongoing ? 'ongoing' : ''} ${rowCls}" data-app="${esc(ev.app.id)}" title="${esc(tip)}" tabindex="0">
      ${evDateHtml(ev, ongoing)}
      <span class="tag ${KINDS[ev.kind].cat}">${KINDS[ev.kind].label}</span>
      <span class="ev-title">${esc(ev.app.school)} <span>${esc(splitName(ev.app.dept || '').main)}</span></span>
      ${countdownHtml(ev, n, ongoing)}
    </li>`;
  }).join('');
}
// 日期欄：跨年先標年份；截止類的日期把時間放大，因為每間學校的截止時間不一樣。
function evDateHtml(ev, ongoing) {
  const d = parseKey(ev.date), yr = d.getFullYear() !== new Date().getFullYear() ? `<span class="yr">${d.getFullYear()} 年</span>` : '';
  const deadline = DEADLINE_KINDS.has(ev.kind);
  const time = ev.time ? `<span class="${deadline ? 'tm' : ''}">${esc(ev.time)}${deadline ? ' 截止' : ''}</span>` : deadline ? '<span>時間請看簡章</span>' : '';
  return `<span class="ev-date">${yr}<b>${md(ev.date)}${ongoing ? ' 起' : ''}（${wd(ev.date).slice(1)}）</b>${time}</span>`;
}
function countdownHtml(ev, n, ongoing) {
  if (ongoing) return `<span class="cd">到 ${fmtDate(ev.last)}</span>`;
  if (n === 0 && /^\d{2}:\d{2}$/.test(ev.time || '')) {
    const [h, m] = ev.time.split(':').map(Number), left = (new Date(new Date().setHours(h, m, 0, 0)) - Date.now()) / 36e5;
    if (left < 0) return `<span class="cd">今天<small>${DEADLINE_KINDS.has(ev.kind) ? '已截止' : '已過'}</small></span>`;
    return `<span class="cd now">今天<small>還有 ${left < 1 ? `${Math.max(1, Math.round(left * 60))} 分鐘` : `${Math.ceil(left)} 小時`}</small></span>`;
  }
  return `<span class="cd ${cdClass(n)}">${cdText(n)}</span>`;
}
function gcalUrl(ev) {
  const ymd = k => k.replace(/-/g, '');
  let dates, tz = '';
  if (/^\d{2}:\d{2}$/.test(ev.time || '')) {
    const [h, mi] = ev.time.split(':').map(Number);
    dates = `${ymd(ev.date)}T${pad(h)}${pad(mi)}00/${ymd(ev.date)}T${pad(Math.min(h + 1, 23))}${pad(mi)}00`;
    tz = '&ctz=Asia/Taipei';
  } else dates = `${ymd(ev.date)}/${ymd(addDays(ev.end || ev.date, 1))}`;
  const text = `${appName(ev.app)}｜${KINDS[ev.kind].label}`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(text)}&dates=${dates}${tz}&details=${encodeURIComponent(ev.note || '')}`;
}

/* ---------- finder ---------- */
function passesFilters(p) {
  const t = todayKey(), r = p._reg;
  if (ui.region && p._region !== ui.region) return false;
  if (ui.open && !(r && r.end >= t)) return false;
  if (ui.nopf && p.pf === 'Y') return false;
  if (ui.norl && needsLetter(p)) return false;
  return true;
}
const matchOn = () => ui.match && (S.profile.tags || []).length > 0;
function currentResults() {
  const byMatch = (a, b) => matchedConds(b).length - matchedConds(a).length;
  if (ui.q.trim() && ui.search && !ui.search.error) {
    const score = new Map(ui.search.programs.map(r => [r.id, r]));
    let list = ui.search.programs.map(r => P.byId.get(r.id)).filter(Boolean).filter(passesFilters);
    if (matchOn()) list = list.filter(p => matchedConds(p).length);
    const cmp = {
      smart: (a, b) => score.get(b.i).score - score.get(a.i).score || regKey(a).localeCompare(regKey(b)),
      match: (a, b) => byMatch(a, b) || score.get(b.i).score - score.get(a.i).score || regKey(a).localeCompare(regKey(b)),
      deadline: (a, b) => regKey(a).localeCompare(regKey(b)),
      quota: (a, b) => (b.q || 0) - (a.q || 0),
    }[ui.sort] || ((a, b) => regKey(a).localeCompare(regKey(b)));
    return {list: list.sort(cmp), hits: score};
  }
  if (matchOn()) {
    const list = P.programs.filter(passesFilters).filter(p => matchedConds(p).length);
    const cmp = {quota: (a, b) => (b.q || 0) - (a.q || 0), deadline: (a, b) => regKey(a).localeCompare(regKey(b))}[ui.sort] || ((a, b) => byMatch(a, b) || regKey(a).localeCompare(regKey(b)));
    return {list: list.sort(cmp), hits: new Map()};
  }
  if (ui.all) return {list: P.programs.filter(passesFilters).sort(ui.sort === 'quota' ? (a, b) => (b.q || 0) - (a.q || 0) : (a, b) => regKey(a).localeCompare(regKey(b))), hits: new Map()};
  return null;
}
const matchPills = items => {
  if (!matchOn()) return '';
  const labels = [...new Set(items.flatMap(p => matchedConds(p).map(c => c.label.split('（')[0])))];
  return labels.length ? `<span class="pill ok">符合：${labels.map(esc).join('・')}</span>` : '';
};
const snippetHtml = s => s ? `${esc(s.before)}<mark>${esc(s.match)}</mark>${esc(s.after)}` : '';
const snippetKey = s => s ? normName(s.before + s.match + s.after) : '';
function rowSnippet(items, hits, seen) {
  const p = items.find(x => hits.get(x.i) && hits.get(x.i).snippet);
  if (!p) return '';
  const h = hits.get(p.i), key = snippetKey(h.snippet);
  if (seen.has(key)) return `<span class="r-snip same">簡章 p.${h.page}：這段條件和上面的「${esc(seen.get(key))}」相同</span>`;
  seen.set(key, p._main);
  return `<span class="r-snip"><span class="clamp"><span class="pg">簡章 p.${h.page}</span>${snippetHtml(h.snippet)}</span></span>`;
}
function rowHtml(r, hits, seen) {
  if (r.items.length === 1) {
    const p = r.items[0];
    return `<button class="result" type="button" data-prog="${esc(p.i)}">
      <span class="r-top"><span class="r-dept">${esc(r.main)}</span>${qualPills(p._quals)}${matchPills([p])}${mine(p.i) ? '<span class="pill info">已加入</span>' : ''}</span>
      <span class="r-meta">${progMeta(p).map(b => `<span>${b}</span>`).join('')}</span>
      ${rowSnippet(r.items, hits, seen)}
    </button>`;
  }
  const first = r.items[0];
  return `<div class="result multi">
    <span class="r-top"><span class="r-dept">${esc(r.main)}</span>${matchPills(r.items)}<span class="hint">${r.items.length} 個招生組別</span></span>
    <span class="r-meta">${progMeta(first, false).map(b => `<span>${b}</span>`).join('')}</span>
    <span class="r-groups">${r.items.map(p => `<button class="grp" type="button" data-prog="${esc(p.i)}">${esc(p._quals.join('・') || '一般')}<small>名額 ${p.q ?? '—'}</small>${mine(p.i) ? '<span class="pill info">已加入</span>' : ''}</button>`).join('')}</span>
    ${rowSnippet(r.items, hits, seen)}
  </div>`;
}
function renderCondBar() {
  const tags = (S.profile.tags || []).map(id => COND_BY_ID.get(id)).filter(Boolean);
  const bar = $('#cond-bar');
  if (!tags.length) { bar.innerHTML = `<button class="btn sm" type="button" id="btn-cond">依我的條件找科系</button><span class="hint">勾選你有的經歷或身分，列出簡章報名資格提到的系</span>`; return; }
  bar.innerHTML = `<label class="toggle"><input type="checkbox" id="f-match" ${ui.match ? 'checked' : ''}>符合我的條件</label>
    <span class="cond-chips">${tags.map(c => `<button class="cond-chip" type="button" data-edit-cond title="修改條件">${esc(c.label.split('（')[0])}</button>`).join('')}</span>
    <button class="link" type="button" id="btn-cond">修改</button>`;
}
function renderFinder() {
  const box = $('#results'), meta = $('#result-meta');
  renderCondBar();
  if (!P.programs.length) { meta.innerHTML = ''; box.innerHTML = '<div class="empty">正在載入科系資料…</div>'; return; }
  if (ui.searching) { meta.innerHTML = '<span>搜尋中…</span>'; return; }
  const res = currentResults();
  if (!res) {
    meta.innerHTML = `<span>共 ${P.programs.length} 個系組、${P.schools.length} 間學校</span>`;
    box.innerHTML = `<div class="sugg">
      <div><h3>常用關鍵字（也會搜尋簡章全文）</h3><div class="chips">${SUGGEST.map(s => `<button class="chip" type="button" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>
      <div><h3>依學群</h3><div class="chips">${P.groups.slice(0, 18).map(([g, n]) => `<button class="chip" type="button" data-q="${esc(g)}">${esc(g)}<small>${n}</small></button>`).join('')}</div></div>
      <div class="chips"><button class="btn sm" type="button" id="show-all">列出全部系組</button>${(S.profile.tags || []).length ? '' : '<button class="btn sm primary" type="button" id="btn-cond2">依我的條件找科系</button>'}</div>
    </div>`;
    return;
  }
  if (ui.search && ui.search.error) { meta.innerHTML = ''; box.innerHTML = '<div class="empty">搜尋失敗，請確認伺服器還在執行。</div>'; return; }
  const {list, hits} = res;
  if (!ui.q.trim() && ui.sort === 'smart') ui.sort = matchOn() ? 'match' : 'deadline';
  if (ui.sort === 'match' && !matchOn()) ui.sort = ui.q.trim() ? 'smart' : 'deadline';
  const open = list.filter(p => p._reg && p._reg.end >= todayKey()).length;
  const sorts = [['match', '最符合我的條件'], ['smart', '最相關'], ['deadline', '報名截止最近'], ['quota', '名額最多']].filter(([v]) => (v !== 'smart' || ui.q.trim()) && (v !== 'match' || matchOn()));
  meta.innerHTML = `<span>${list.length} 個系組・${new Set(list.map(p => p.s)).size} 校・還能報名 ${open} 個${matchOn() ? '・只列簡章提到你條件的系' : ''}</span>
    <select id="sort" aria-label="排序">${sorts.map(([v, l]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const rows = mergeRows(list);
  const shown = rows.slice(0, ui.limit);
  let html = bySchool(shown).map(g => {
    const seen = new Map();
    const n = g.rows.reduce((s, r) => s + r.items.length, 0);
    return `<section class="r-group"><div class="r-group-head"><b>${esc(g.school)}</b><span>${n} 個系組</span></div>${g.rows.map(r => rowHtml(r, hits, seen)).join('')}</section>`;
  }).join('');
  if (rows.length > shown.length) html += `<div class="more-row"><button class="btn sm" type="button" id="show-more">再顯示 ${Math.min(40, rows.length - shown.length)} 個（還有 ${rows.length - shown.length} 個）</button></div>`;
  if (!list.length) html = `<div class="empty">${ui.q.trim() ? `找不到符合「${esc(ui.q.trim())}」的系組。` : '沒有符合條件的系組。'}<br>試試更短的關鍵字，或取消上面的篩選${matchOn() ? '、或關掉「符合我的條件」' : ''}。</div>`;
  const general = ui.q.trim() && ui.search ? ui.search.general.filter(g => !ui.region || (P.schools.find(s => s.code === g.code) || {}).region === ui.region) : [];
  if (general.length) {
    html += `<div class="general-hits"><h3>簡章其他頁面也提到（總則、名額表等）</h3>${general.slice(0, 12).map(g => { const u = pdfUrl(g.code, g.page); const inner = `<b>${esc(g.school)} 第 ${g.page} 頁</b>${snippetHtml(g.snippet)}`; return u ? `<a class="general-hit" href="${u}" target="_blank" rel="noopener">${inner}</a>` : `<div class="general-hit">${inner}</div>`; }).join('')}</div>`;
  }
  box.innerHTML = html;
}
let searchCtl = null;
async function runSearch() {
  const q = ui.q.trim();
  ui.limit = 40;
  if (!q) { ui.search = null; ui.searching = false; renderFinder(); return; }
  if (searchCtl) searchCtl.abort();
  searchCtl = new AbortController();
  ui.searching = true;
  renderFinder();
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(q), {signal: searchCtl.signal});
    ui.search = await res.json();
    if (!ui.sortChosen) ui.sort = 'smart';
  } catch (e) {
    if (e.name === 'AbortError') return;
    ui.search = {error: true};
  }
  ui.searching = false;
  $('#results').scrollTop = 0;
  renderFinder();
}
const runSearchSoon = debounce(runSearch, 200);

/* ---------- program detail ---------- */
const dlgProg = $('#dlg-prog');
function highlightRe() {
  const toks = ui.q.trim().split(/\s+/).filter(t => t.length >= 2 || /[A-Za-z0-9]/.test(t));
  if (!toks.length) return null;
  const part = t => [...t].map(ch => ch === '台' || ch === '臺' ? '[台臺]' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  return new RegExp(toks.map(part).join('|'), 'gi');
}
function markText(text, re) {
  if (!re) return esc(text);
  let out = '', last = 0;
  text.replace(re, (m, at) => { out += esc(text.slice(last, at)) + `<mark>${esc(m)}</mark>`; last = at + m.length; return m; });
  return out + esc(text.slice(last));
}
const siblings = p => P.programs.filter(x => x.s === p.s && x._main === p._main);
function qualHtml(p, re) {
  return p.qx
    ? `<h3>報名資格<span class="src">節錄自簡章第 ${p.qxp} 頁</span></h3><p class="qual">${markText(p.qx, re)}</p>`
    : p.tgt ? `<h3>報名資格</h3><p class="qual">${markText(p.tgt, re)}</p>` : '<h3>報名資格</h3><p class="hint">沒有找到，請看簡章原文。</p>';
}
function weightHtml(p) {
  const its = (p.it || []).filter(i => i[0]);
  if (!its.length) return '<p class="hint">簡章資料沒有列出甄選項目。</p>';
  const hasW = its.some(i => i[1] != null), total = hasW ? its.reduce((s, i) => s + (i[1] || 0), 0) || 1 : its.length;
  return `<div class="weight"><div class="wbar">${its.map(([n, w]) => `<i class="w-${itemClass(n)}" style="width:${((hasW ? (w || 0) : 1) / total * 100).toFixed(1)}%"></i>`).join('')}</div>
    <div class="witems">${its.map(([n, w, st]) => `<span><i class="w-${itemClass(n)}"></i>${esc(n)}${w != null ? ` ${w}%` : ''}${st ? `（${esc(st)}）` : ''}</span>`).join('')}</div></div>`;
}
function factsHtml(p) {
  const facts = [
    ['報名費', p.fee], ['報名費減免', p.fr],
    ['推薦信', p.rl ? rlText(p.rl) + (p.rld && p.rl !== 'N' ? `（${fmtDate(p.rld)} 前）` : '') : ''],
    ['作品集', p.pf === 'Y' ? '需要' + (p.pfd ? `（${fmtDate(p.pfd)} 前）` : '') : p.pf === 'N' ? '不需要' : ''],
    ['同校可報系組', p.mx && p.mx !== 'X' ? p.mx : ''], ['優先錄取', p.pr && p.pr !== 'N' ? p.pr.replace(/^Y\//, '') : ''],
    ['考試地點', p.loc], ['諮詢電話', p.ph], ['諮詢信箱', p.em], ['聯絡人', p.ct],
  ].filter(([, v]) => v);
  return facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '';
}
async function openProgram(pid) {
  const p = P.byId.get(pid);
  if (!p) return;
  const re = highlightRe();
  $('#p-title').innerHTML = `${esc(p.school)} ${esc(p._main)} ${qualPills(p._quals)}`;
  const sib = siblings(p);
  $('#p-sub').innerHTML = [p.q != null && `招生名額 ${p.q} 名`, p.g && esc(p.g), REGION_NAME[p._region]].filter(Boolean).join('・')
    + (sib.length > 1 ? `<span class="grp-switch">招生組別：${sib.map(x => `<button class="chip ${x.i === p.i ? 'on' : ''}" type="button" data-switch="${esc(x.i)}">${esc(x._quals.join('・') || '一般')}</button>`).join('')}</span>` : '');
  renderProgActions(p);
  const t = todayKey();
  const events = (p.ev || []).map(([k, sd, ed, st, et, name]) => `<li class="${(ed || sd) < t ? 'past' : ''}"><span><span class="tag ${(KINDS[k] || KINDS.other).cat}">${esc(name)}</span></span><span class="when">${fmtDate(sd)}${st ? ' ' + st : ''}${ed ? ` – ${fmtDate(ed)}${et ? ' ' + et : ''}` : ''}</span></li>`).join('');
  const L = schoolLinks(p.school) || {};
  const links = [L.apply && [L.apply, '網路報名系統'], L.adm && [L.adm, '學校招生網'], p.u && [p.u, '系所網站／簡章連結'], p.du && [p.du, '學系網站'], [`https://sta-tw.org/bochures/program/${encodeURIComponent(p.i)}/`, '特殊選才網']].filter(Boolean).filter(([u]) => /^https?:\/\//.test(u));
  $('#p-facts').innerHTML = `
    <div class="p-section">${qualHtml(p, re)}</div>
    ${p.deb || p.deo ? `<div class="p-section"><h3>不同教育資歷</h3><p>${esc([p.deb, p.deo].filter(Boolean).join(' '))}</p></div>` : ''}
    <div class="p-section"><h3>甄選方式</h3>${weightHtml(p)}</div>
    ${docListHtml(p)}
    ${factsHtml(p)}
    ${events ? `<div class="p-section"><h3>這個系的時程</h3><ul class="p-events">${events}</ul></div>` : ''}
    ${p.cw ? `<div class="p-section"><h3>報到與遞補</h3><p>${esc(p.cw)}</p></div>` : ''}
    <div class="p-section"><h3>連結</h3><div class="links">${links.map(([u, l]) => `<a class="btn sm" href="${esc(u)}" target="_blank" rel="noopener">${l}</a>`).join('')}${pdfUrl(p.code) ? `<a class="btn sm" href="${pdfUrl(p.code)}" target="_blank" rel="noopener">整份簡章 PDF</a>` : ''}</div></div>`;
  $('#p-facts').scrollTop = 0;
  const pages = p.pg || [];
  const hit = ui.q.trim() && ui.search && ui.search.programs ? ui.search.programs.find(r => r.id === pid) : null;
  const firstHit = hit && hit.page ? hit.page : null;
  dlgProg._scrollToMark = !!firstHit;
  $('#p-tabs').innerHTML = pages.map(n => `<button class="page-tab" type="button" role="tab" data-page="${n}" aria-selected="false">第 ${n} 頁</button>`).join('');
  $('#p-text').innerHTML = pages.length ? '<p class="hint">載入簡章中…</p>' : `<p>這個系組沒有對應到簡章的特定頁面。</p><p>${pdfUrl(p.code) ? `<a href="${pdfUrl(p.code)}" target="_blank" rel="noopener">開啟整份簡章 PDF</a>` : '可以到上面的「特殊選才網」連結查看簡章。'}</p>`;
  if (!dlgProg.open) dlgProg.showModal();
  dlgProg._pages = null;
  if (!pages.length) return;
  try {
    const data = await request('GET', `/api/brochure/${encodeURIComponent(p.code)}?pages=${pages.join(',')}`);
    dlgProg._pages = {code: p.code, list: data.pages};
    showPage(pages.includes(firstHit) ? firstHit : pages[0]);
  } catch (e) {
    $('#p-text').innerHTML = `<p>簡章全文載入失敗：${esc(e.message)}</p>`;
  }
}
function showPage(n) {
  const data = dlgProg._pages;
  if (!data) return;
  const pg = data.list.find(x => x.page === n);
  $$('#p-tabs .page-tab').forEach(b => b.setAttribute('aria-selected', String(Number(b.dataset.page) === n)));
  const box = $('#p-text');
  box.innerHTML = `${markText(pg ? pg.text : '', highlightRe())}${pdfUrl(data.code, n) ? `\n\n<a href="${pdfUrl(data.code, n)}" target="_blank" rel="noopener">在 PDF 開啟第 ${n} 頁 →</a>` : ''}`;
  box.scrollTop = 0;
  const mk = dlgProg._scrollToMark && box.querySelector('mark');
  if (mk) box.scrollTop = Math.max(0, mk.offsetTop - box.offsetTop - 80);
}
function renderProgActions(p) {
  const m = mine(p.i);
  $('#p-actions').innerHTML = m
    ? `<span class="pill info">已在我的學校</span><button class="btn" type="button" data-open-app="${esc(m.id)}">打開我的紀錄</button>`
    : `<button class="btn primary" type="button" data-add-prog="${esc(p.i)}">＋ 加入我的學校</button>`;
}

/* ---------- 新增學校：選學校 → 選系組 → 確認 → 完成 ---------- */
const dlgAdd = $('#dlg-add');
const wiz = {step: 1, school: null, pid: null, q: '', open: false, active: 0, choices: [], applied: false, addedId: null};
function openWizard(opts = {}) {
  Object.assign(wiz, {step: 1, school: null, pid: null, q: '', open: false, active: 0, applied: false, addedId: null}, opts);
  if (opts.pid) { const p = P.byId.get(opts.pid); wiz.school = p.school; wiz.step = 3; }
  renderWizard();
  if (!dlgAdd.open) dlgAdd.showModal();
  focusWizard();
}
function focusWizard() {
  const el = $('#add-q') || $('#add-confirm') || $('#add-finish');
  if (el) el.focus();
}
function setWizStep(step, extra = {}) {
  Object.assign(wiz, {step, q: '', active: 0}, extra);
  renderWizard();
  focusWizard();
}
function schoolMatches(s, q) {
  const n = normName(s.name), k = normName(q);
  if (!k) return true;
  if (n.includes(k)) return true;
  return P.terms.aliases[k] === s.name;
}
function renderWizard() {
  $$('#add-steps li').forEach(li => {
    const n = Number(li.dataset.step);
    li.className = wiz.step > 3 || n < wiz.step ? 'done' : n === wiz.step ? 'now' : '';
  });
  const body = $('#add-body');
  if (wiz.step === 1) {
    body.innerHTML = `<div class="add-step">
      <p class="add-lead">你要報名哪一間學校？</p>
      <div class="add-search"><input type="search" id="add-q" placeholder="輸入學校名稱或簡稱，例如：輔仁、清大" autocomplete="off" aria-label="搜尋學校" aria-controls="add-list"></div>
      <ul class="pick-list scroll" id="add-list" role="listbox" aria-label="學校"></ul>
      <div class="add-foot"><span class="hint">清單裡沒有你的學校或科系？</span><button class="btn sm" type="button" id="add-manual">手動新增</button></div>
    </div>`;
  } else if (wiz.step === 2) {
    const progs = P.programs.filter(p => p.school === wiz.school);
    const open = progs.filter(p => p._reg && p._reg.end >= todayKey()).length;
    body.innerHTML = `<div class="add-step">
      <div class="add-lead"><button class="back" type="button" data-back="1">‹ 換學校</button></div>
      <p class="add-lead">${esc(wiz.school)}：要報名哪個系？<span class="hint">共 ${progs.length} 個系組，還能報名 ${open} 個</span></p>
      <div class="add-search">
        <input type="search" id="add-q" placeholder="篩選系組，例如：資工、醫資" autocomplete="off" aria-label="篩選系組" aria-controls="add-list">
        <label class="toggle"><input type="checkbox" id="add-open" ${wiz.open ? 'checked' : ''}>只看還能報名</label>
      </div>
      <ul class="pick-list scroll" id="add-list" role="listbox" aria-label="系組"></ul>
    </div>`;
  } else if (wiz.step === 3) {
    body.innerHTML = confirmHtml(P.byId.get(wiz.pid));
  } else {
    body.innerHTML = doneHtml();
  }
  if (wiz.step <= 2) renderWizardList();
}
function renderWizardList() {
  const list = $('#add-list');
  if (!list) return;
  const t = todayKey();
  if (wiz.step === 1) {
    const schools = P.schools.filter(s => schoolMatches(s, wiz.q)).sort((a, b) => (REGION_ORDER[a.region] ?? 9) - (REGION_ORDER[b.region] ?? 9));
    wiz.choices = schools.map(s => ({type: 'school', value: s.name}));
    list.innerHTML = schools.length ? schools.map((s, i) => {
      const progs = P.programs.filter(p => p.school === s.name);
      const open = progs.filter(p => p._reg && p._reg.end >= t).length;
      const added = S.apps.filter(a => a.school === s.name).length;
      return `<li class="pick ${i === wiz.active ? 'active' : ''}" role="option" aria-selected="${i === wiz.active}" data-choice="${i}">
        <span class="pick-main"><span class="pick-title">${esc(s.name)}${added ? `<span class="pill info">已加入 ${added} 個系</span>` : ''}</span>
        <span class="pick-sub">${REGION_NAME[s.region] || ''}・${progs.length} 個系組・${open ? `<span class="st-open">還能報名 ${open} 個</span>` : '報名都已截止'}</span></span>
        <span class="pick-go" aria-hidden="true">›</span>
      </li>`;
    }).join('') : `<li class="pick-empty">找不到「${esc(wiz.q)}」。<br>可以按下面的「手動新增」自己填。</li>`;
  } else {
    let progs = P.programs.filter(p => p.school === wiz.school && deptMatches(p, wiz.q) && (!wiz.open || (p._reg && p._reg.end >= t)));
    progs.sort((a, b) => regKey(a).localeCompare(regKey(b)));
    const rows = mergeRows(progs);
    wiz.choices = [];
    const html = rows.map(r => {
      if (r.items.length === 1) {
        const p = r.items[0], i = wiz.choices.push({type: 'prog', value: p.i}) - 1, m = mine(p.i);
        return `<li class="pick ${m ? 'taken' : ''} ${i === wiz.active ? 'active' : ''}" role="option" aria-selected="${i === wiz.active}" data-choice="${i}">
          <span class="pick-main"><span class="pick-title">${esc(r.main)}${qualPills(p._quals)}${m ? '<span class="pill info">已加入</span>' : ''}</span>
          <span class="pick-sub">${progMeta(p).join('・')}</span></span>
          <span class="pick-go" aria-hidden="true">›</span>
        </li>`;
      }
      return `<li class="pick-multi">
        <span class="pick-main"><span class="pick-title">${esc(r.main)}<span class="hint">有 ${r.items.length} 個招生組別，選一個：</span></span>
        <span class="pick-sub">${progMeta(r.items[0], false).join('・')}</span></span>
        <span class="pick-groups">${r.items.map(p => {
          const i = wiz.choices.push({type: 'prog', value: p.i}) - 1, m = mine(p.i);
          return `<button class="grp ${i === wiz.active ? 'active' : ''}" type="button" data-choice="${i}" role="option" aria-selected="${i === wiz.active}">${esc(p._quals.join('・') || '一般')}<small>名額 ${p.q ?? '—'}</small>${m ? '<span class="pill info">已加入</span>' : ''}</button>`;
        }).join('')}</span>
      </li>`;
    }).join('');
    list.innerHTML = html || `<li class="pick-empty">${esc(wiz.school)} 沒有符合「${esc(wiz.q)}」的系組。<br>試試別的關鍵字，或取消「只看還能報名」。</li>`;
  }
  const act = list.querySelector('.active');
  if (act) act.scrollIntoView({block: 'nearest'});
}
function deptMatches(p, q) {
  const k = normName(q);
  if (!k) return true;
  const n = normName(p.n);
  if (n.includes(k)) return true;
  const syn = P.terms.synonyms[k];
  if (syn) return syn.some(s => n.includes(normName(s)));
  if (k.length < 2) return false;
  let best = Infinity;
  for (let i = n.indexOf(k[0]); i !== -1; i = n.indexOf(k[0], i + 1)) {
    let j = i, c = 1;
    for (; c < k.length; c++) { j = n.indexOf(k[c], j + 1); if (j === -1) break; }
    if (c === k.length) best = Math.min(best, j - i + 1);
  }
  return best <= k.length * 3;
}
function chooseWizard(i) {
  const c = wiz.choices[i];
  if (!c) return;
  if (c.type === 'school') { setWizStep(2, {school: c.value, open: false}); return; }
  const m = mine(c.value);
  if (m) { dlgAdd.close(); openApp(m.id); return; }
  setWizStep(3, {pid: c.value, applied: false});
}
function confirmHtml(p) {
  const t = todayKey(), src = appFromProgram(p), r = p._reg;
  const closed = r && r.end < t;
  const key = src.dates.filter(d => ['reg', 'letter', 'upload', 'stage1', 'interview', 'exam', 'release', 'confirm'].includes(d.kind)).slice(0, 6);
  const endText = `${fmtDate(r ? r.end : '')}${r && r.time ? ' ' + r.time : ''}`;
  const statusText = !r ? '' : t < r.start ? `<span class="pill info">${fmtDate(r.start)} 開始報名</span>` : !closed ? `<span class="pill ok">報名中，${diffDays(r.end) === 0 ? '今天' : `剩 ${diffDays(r.end)} 天`}，${endText} 截止</span>` : `<span class="pill">報名已在 ${endText} 截止</span>`;
  const sameSchool = S.apps.filter(a => a.school === p.school && a.status !== 'skipped');
  const mx = parseInt(p.mx, 10);
  const warns = [];
  if (Number.isFinite(mx) && sameSchool.length >= mx) warns.push(`<b>${esc(p.school)}規定同校最多報 ${mx} 個系組</b>，你已經加了 ${sameSchool.length} 個（${sameSchool.map(a => esc(splitName(a.dept || '').main)).join('、')}）。再加這個就超過了，請確認簡章。`);
  if (closed) warns.push(`這個系的報名已在 <b>${endText}</b> 截止。已經報名的話，請勾下面的「我已經報名這個系了」；沒報名的話，加進來只能當參考。`);
  return `<div class="add-step">
    <div class="add-lead"><button class="back" type="button" data-back="2">‹ 換系組</button></div>
    <div class="confirm-scroll scroll">
      <div class="confirm-card">
        <div class="pick-main"><span class="pick-title">${esc(p.school)} ${esc(p._main)}${qualPills(p._quals)}</span><span class="pick-sub">${[p.q != null && `招生名額 ${p.q} 名`, p.fee && `報名費 ${esc(p.fee)}`].filter(Boolean).join('・')}</span></div>
        ${statusText}
      </div>
      ${warns.map(w => `<div class="warn-box">${w}</div>`).join('')}
      <div class="confirm-grid">
        <section class="confirm-box">
          <h3>按「加入」之後，會幫你建立</h3>
          <ul class="will">
            <li><span><b>${src.dates.length} 個日期</b>，排進主畫面的時程和月曆：
              <ul class="mini-dates">${key.map(d => `<li><span class="d">${fmtDate(d.date)}</span><span class="tag ${KINDS[d.kind].cat}">${KINDS[d.kind].label}</span></li>`).join('')}</ul></span></li>
            <li><span><b>${src.docs.length} 項備審清單</b>：${src.docs.map(d => esc(d.name)).join('、')}</span></li>
            <li><span><b>甄選方式</b>：${esc(weightText(p) || '簡章未列')}</span></li>
          </ul>
        </section>
        <section class="confirm-box">
          <h3>報名資格${p.qxp ? `<span class="hint">（簡章第 ${p.qxp} 頁）</span>` : ''}</h3>
          <p class="qual-short">${esc(p.qx || p.tgt || '整理資料沒有列出，請看簡章原文。')}</p>
          <button class="link" type="button" data-view-prog="${esc(p.i)}">看完整簡章</button>
        </section>
      </div>
    </div>
    <div class="add-actions">
      <label class="check ${closed ? 'attn' : ''}"><input type="checkbox" id="add-applied" ${wiz.applied ? 'checked' : ''}>我已經報名這個系了${closed ? '（報名已截止，報過名的話請勾）' : ''}</label>
      <span class="spacer"></span>
      <button class="btn" type="button" data-back="2">上一步</button>
      <button class="btn primary" type="button" id="add-confirm">加入我的學校</button>
    </div>
  </div>`;
}
function nextStepText(a) {
  const n = nextStep(a);
  return n.text;
}
function doneHtml() {
  const a = S.apps.find(x => x.id === wiz.addedId);
  if (!a) return '<div class="add-step add-done"><p>已加入。</p></div>';
  const n = upcoming(allEvents().filter(ev => ev.app.id === a.id))[0];
  return `<div class="add-step add-done">
    <div class="done-icon" aria-hidden="true">✓</div>
    <h3>已加入 ${esc(appName(a))}</h3>
    <p class="summary">${a.dates.length} 個日期已排進時程${n ? `，最近的是 ${fmtDate(focusDate(n))} ${KINDS[n.kind].label}（${cdText(diffDays(focusDate(n)))}）` : ''}。<br>左邊「我的學校」也多了這一筆，之後點它就能更新進度、勾備審、寫面試筆記。</p>
    <div class="next-step"><span class="next-label">下一步</span><span class="next-text">${esc(nextStepText(a))}</span></div>
    <div class="add-actions">
      <button class="btn" type="button" id="add-same">同一間再加一個系</button>
      <button class="btn" type="button" id="add-other">加別間學校</button>
      <button class="btn primary" type="button" id="add-finish">完成</button>
    </div>
  </div>`;
}
function confirmAdd() {
  const p = P.byId.get(wiz.pid);
  if (!p) return;
  const existing = mine(p.i);
  if (existing) { dlgAdd.close(); openApp(existing.id); return; }
  const app = appFromProgram(p);
  if (wiz.applied) app.status = 'applied';
  upsertApp(app);
  wiz.addedId = app.id;
  wiz.step = 4;
  renderWizard();
  focusWizard();
}

/* ---------- 一間學校的紀錄（自動儲存） ---------- */
const dlgApp = $('#dlg-app');
let cur = null, curTab = 'dates', pickResult = false;
let delArmed = false, delTimer = null;
function blankApp() {
  return {id: uid(), school: '', dept: '', status: 'prep', methods: ['資料審查', '面試'], fee: null, quota: null, url: '', dates: [], docs: DEFAULT_DOCS.map(n => ({id: uid(), name: n, done: false})), notes: '', prep: '', asked: '', choice: '', waitNo: null, confirmDone: false, giveupDone: false, createdAt: Date.now()};
}
function openApp(id, tab) {
  const a = id ? S.apps.find(x => x.id === id) : null;
  cur = a ? clone(a) : blankApp();
  cur.dates = (cur.dates || []).map(d => ({id: d.id || uid(), kind: KINDS[d.kind] ? d.kind : 'other', date: d.date || '', end: d.end || '', time: d.time || '', note: d.note || ''}))
    .sort((x, y) => (x.date || '9').localeCompare(y.date || '9'));
  cur.docs = (cur.docs || []).map(d => ({id: d.id || uid(), name: d.name || '', done: !!d.done}));
  pickResult = false;
  disarmDelete();
  fillInfo();
  renderAppHead(); renderStepper(); renderNextStep(); renderDates(); renderDocs(); renderBrochureTab(); renderTabCounts();
  $('#a-prep').value = cur.prep || '';
  $('#a-asked').value = cur.asked || '';
  setSaveState(cur.id, a ? (a.example ? 'example' : '') : 'new');
  showTab(tab || (a ? 'dates' : 'info'));
  if (!dlgApp.open) dlgApp.showModal();
  if (a) dlgApp.focus(); else $('#a-school').focus();
}
function fillInfo() {
  $('#a-school').value = cur.school || '';
  $('#a-dept').value = cur.dept || '';
  $('#a-fee').value = cur.fee ?? '';
  $('#a-quota').value = cur.quota ?? '';
  $('#a-url').value = cur.url || '';
  $('#a-notes').value = cur.notes || '';
  $$('#a-methods input').forEach(i => { i.checked = (cur.methods || []).includes(i.value); });
  $('#a-delete').closest('.danger-zone').hidden = !S.apps.some(a => a.id === cur.id);
}
function renderAppHead() {
  $('#a-title').textContent = cur.school || '手動新增學校';
  $('#a-sub').textContent = cur.dept || (cur.school ? '' : '先在「基本資料」填學校和學系，填好就會自動儲存');
  const L = schoolLinks(cur.school) || {}, p = cur.programId && P.byId.get(cur.programId);
  $('#a-links').innerHTML = [L.apply && extLink(L.apply, '網路報名系統'), L.adm && extLink(L.adm, '學校招生網'), p && pdfUrl(p.code) && extLink(pdfUrl(p.code), '簡章 PDF'), /^https?:\/\//.test(cur.url || '') && extLink(cur.url, '系所網站')].filter(Boolean).join('');
}
function setSaveState(id, state) {
  if (!cur || cur.id !== id) return;
  const el = $('#a-save');
  el.classList.toggle('err', state === 'error');
  el.textContent = {saving: '儲存中…', saved: '已自動儲存', error: '儲存失敗', new: '', example: '範例資料，修改後會變成你的紀錄', '': ''}[state] ?? '';
}
const commitSoon = debounce(() => commit(), 450);
function commit() {
  if (!cur) return;
  if (!cur.school.trim()) return;
  delete cur.example;
  const body = clone(cur);
  body.school = body.school.trim();
  body.dept = (body.dept || '').trim();
  upsertApp(body);
  $('#a-delete').closest('.danger-zone').hidden = false;
}
function showTab(tab) {
  curTab = tab;
  $$('#a-tabs [data-tab]').forEach(b => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  $$('#dlg-app .tab-panel').forEach(p => { p.hidden = p.dataset.panel !== tab; });
}
function renderTabCounts() {
  const done = cur.docs.filter(d => d.done).length;
  const set = (tab, label, count) => { $(`#tab-${tab}`).innerHTML = `${label}${count ? ` <span class="tab-count">${count}</span>` : ''}`; };
  set('dates', '日期', cur.dates.length || '');
  set('docs', '備審資料', cur.docs.length ? `${done}/${cur.docs.length}` : '');
  set('notes', '面試筆記', '');
  set('brochure', '簡章重點', '');
  set('info', '基本資料', '');
}

const STEPS = [['prep', '準備中'], ['applied', '已報名'], ['interview', '通過一階'], ['waiting', '已面試'], ['result', '放榜結果']];
function stepIndex(st) { return {prep: 0, skipped: 0, applied: 1, interview: 2, waiting: 3, admitted: 4, waitlist: 4, rejected: 4, out: 2}[st] ?? 0; }
function renderStepper() {
  const idx = stepIndex(cur.status);
  const resultLabel = {admitted: '正取', waitlist: cur.waitNo ? `備取 ${cur.waitNo}` : '備取', rejected: '未錄取'}[cur.status];
  $('#a-stepper').innerHTML = STEPS.map(([key, label], i) => {
    let cls = i < idx ? 'done' : i === idx ? 'now' : '';
    let text = label;
    if (i === 0 && cur.status === 'skipped') { cls = 'now bad'; text = '沒有報名'; }
    if (i === 2 && cur.status === 'out') { cls = 'now bad'; text = '一階未通過'; }
    if (i === 4 && resultLabel) { text = resultLabel; cls += cur.status === 'admitted' ? ' ok' : cur.status === 'waitlist' ? ' warn' : ' bad'; }
    return `<li class="${cls}"><button type="button" data-step="${key}" aria-current="${i === idx ? 'step' : 'false'}">${text}</button></li>`;
  }).join('');
}
// 依照目前進度，告訴使用者下一步要做什麼，並給一個可以直接按的按鈕。
function nextStep(a) {
  const d = kinds => firstDate(a, kinds);
  const t = todayKey();
  const when = x => `${fmtDate(x.date)}${x.time ? ' ' + x.time : ''}（${cdText(diffDays(x.date))}）`;
  const left = (a.docs || []).filter(x => !x.done).length;
  const L = schoolLinks(a.school) || {};
  switch (a.status) {
    case 'prep': {
      const reg = d(['reg']);
      const go = L.apply ? [{label: '前往報名系統', href: L.apply}] : L.adm ? [{label: '學校招生網', href: L.adm}] : [];
      const act = [...go, {label: '我報名了', set: {status: 'applied'}, primary: true}];
      if (reg && reg.date >= t) return {text: `在 ${when(reg)} 前完成網路報名${left ? `，還有 ${left} 項備審要準備` : ''}。報名完按「我報名了」。`, actions: act};
      if (reg) return {text: `這個系的報名已在 ${when(reg).replace(/（.*）/, '')} 截止。報了就按「我報名了」；沒報就按「沒有報名」，這筆會留著但不再提醒。`, actions: [{label: '我報名了', set: {status: 'applied'}, primary: true}, {label: '沒有報名', set: {status: 'skipped'}}]};
      return {text: '確認簡章的報名日期，報名完按「我報名了」。', actions: act};
    }
    case 'skipped':
      return {tone: 'calm', text: '這間沒有報名，不會再提醒。要留著當紀錄也可以，或到「基本資料」刪除。', actions: [{label: '其實有報名', set: {status: 'applied'}}]};
    case 'applied': {
      const up = d(['upload', 'letter']), s1 = d(['stage1']), iv = d(['interview', 'exam', 'window']);
      if (left && up && up.date >= t) return {text: `還有 ${left} 項備審沒完成，${when(up)} 截止。到「備審資料」打勾追蹤。`, actions: [{label: '打開備審資料', tab: 'docs', primary: true}]};
      if (s1 && s1.date >= t) return {text: `${when(s1)} 公布面試名單。通過就按「通過一階」。`, actions: [{label: '通過一階', set: {status: 'interview'}, primary: true}, {label: '沒通過', set: {status: 'out'}}]};
      if (iv && (iv.end || iv.date) >= t) return {text: `面試在 ${when(iv)}。可以先到「面試筆記」準備。`, actions: [{label: '要面試了', set: {status: 'interview'}, primary: true}]};
      return {text: '等學校公布一階結果。', actions: [{label: '通過一階', set: {status: 'interview'}, primary: true}, {label: '沒通過', set: {status: 'out'}}]};
    }
    case 'interview': {
      const iv = d(['interview', 'exam', 'window']);
      return {text: iv ? `面試在 ${when(iv)}${iv.time ? ' ' + iv.time : ''}。到「面試筆記」寫下準備重點，面試完按「面試完了」。` : '把面試日期加到「日期」，面試完按「面試完了」。', actions: [{label: '寫面試筆記', tab: 'notes'}, {label: '面試完了', set: {status: 'waiting'}, primary: true}]};
    }
    case 'waiting': {
      const rel = d(['release']);
      return {text: rel ? `${when(rel)} 放榜。放榜後選結果：` : '放榜後選結果：', actions: [{label: '正取', set: {status: 'admitted'}}, {label: '備取', set: {status: 'waitlist'}}, {label: '未錄取', set: {status: 'rejected'}}]};
    }
    case 'admitted':
    case 'waitlist': {
      const cf = d(['confirm']), g = d(['giveup']);
      const head = a.status === 'admitted' ? '恭喜正取！' : `備取${a.waitNo ? `第 ${a.waitNo} 名` : ''}。`;
      if (!a.choice) return {text: `${head}${cf ? `在 ${when(cf)} 前決定要不要讀。` : '決定要不要讀。'}`, actions: [{label: '要去讀', set: {choice: 'attend'}, primary: true}, {label: '放棄', set: {choice: 'decline'}}], wait: a.status === 'waitlist'};
      if (a.choice === 'attend') return {tone: 'calm', text: a.confirmDone ? '已完成報到，恭喜！' : `記得${cf ? `在 ${when(cf)} 前` : ''}完成聲明就讀或報到。`, check: ['confirmDone', '已完成報到'], actions: [{label: '改變決定', set: {choice: ''}}], wait: a.status === 'waitlist'};
      return {tone: 'danger', text: `放棄要在${g ? ` ${when(g)} 前` : '學校規定期限內'}辦理，否則不能參加繁星、申請入學和分發入學。`, check: ['giveupDone', '已交出放棄聲明'], actions: [{label: '改變決定', set: {choice: ''}}]};
    }
    case 'rejected':
    case 'out':
      return {tone: 'calm', text: '這間沒有錄取。下一間會更好！', actions: []};
  }
  return {text: '', actions: []};
}
function renderNextStep() {
  const box = $('#a-next');
  const n = pickResult
    ? {text: '放榜了嗎？選擇結果：', actions: [{label: '正取', set: {status: 'admitted'}}, {label: '備取', set: {status: 'waitlist'}}, {label: '未錄取', set: {status: 'rejected'}}, {label: '一階未通過', set: {status: 'out'}}, {label: '還沒放榜', cancel: true}]}
    : nextStep(cur);
  box.className = 'next-step' + (n.tone ? ' ' + n.tone : '');
  box._actions = n.actions;
  box.innerHTML = `<span class="next-label">${pickResult ? '放榜結果' : '下一步'}</span>
    <span class="next-text">${esc(n.text)}</span>
    <span class="next-actions">
      ${n.wait ? `<label class="check">備取第 <input type="number" min="1" id="a-wait" value="${esc(cur.waitNo ?? '')}" aria-label="備取名次"> 名</label>` : ''}
      ${n.check ? `<label class="check"><input type="checkbox" data-check="${n.check[0]}" ${cur[n.check[0]] ? 'checked' : ''}>${n.check[1]}</label>` : ''}
      ${n.actions.map((x, i) => x.href ? extLink(x.href, x.label) : `<button class="btn sm ${x.primary ? 'primary' : ''}" type="button" data-act="${i}">${x.label}</button>`).join('')}
    </span>`;
}
function applyStatus(patch) {
  Object.assign(cur, patch);
  if (patch.status && !['admitted', 'waitlist'].includes(patch.status)) cur.choice = '';
  pickResult = false;
  renderStepper(); renderNextStep();
  commit();
  if (patch.status) setSaveState(cur.id, 'saving');
}
function renderDates() {
  const t = todayKey();
  const kindOpts = sel => Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v.label}</option>`).join('');
  $('#a-dates').innerHTML = cur.dates.length ? cur.dates.map(d => {
    const past = isKey(d.date) && (d.end || d.date) < t;
    const ev = isKey(d.date) ? {...d, app: cur} : null;
    return `<div class="date-row ${past ? 'past' : ''}" data-id="${esc(d.id)}">
      <select data-f="kind" aria-label="類型">${kindOpts(d.kind)}</select>
      <input type="date" data-f="date" value="${esc(d.date)}" aria-label="日期">
      <input type="time" data-f="time" value="${esc(d.time)}" aria-label="時間">
      <input type="text" data-f="note" value="${esc(d.note)}" placeholder="備註" aria-label="備註">
      <span class="row-sub">${ev && !past ? `<a href="${gcalUrl(ev)}" target="_blank" rel="noopener" title="加到 Google 日曆">日曆</a>` : ''}</span>
      <button class="icon-btn" type="button" data-del-date="${esc(d.id)}" aria-label="刪除這個日期">✕</button>
    </div>`;
  }).join('') : '<div class="empty">還沒有日期。按右上角「新增日期」。</div>';
}
function renderDocs() {
  $('#a-docs').innerHTML = cur.docs.length ? cur.docs.map(d => `<li class="doc-row ${d.done ? 'done' : ''}" data-id="${esc(d.id)}">
    <input type="checkbox" data-f="done" ${d.done ? 'checked' : ''} aria-label="完成">
    <input type="text" data-f="name" value="${esc(d.name)}" aria-label="項目名稱" placeholder="項目名稱">
    <button class="icon-btn" type="button" data-del-doc="${esc(d.id)}" aria-label="刪除這個項目">✕</button>
  </li>`).join('') : '<li class="empty">沒有備審項目。</li>';
}
function renderBrochureTab() {
  const p = cur.programId && P.byId.get(cur.programId);
  $('#a-brochure').innerHTML = p
    ? `<div class="brochure-summary">
        <div class="p-section">${qualHtml(p, null)}</div>
        <div class="p-section"><h3>甄選方式</h3>${weightHtml(p)}</div>
        ${docListHtml(p)}
        ${factsHtml(p)}
        <div><button class="btn" type="button" data-view-prog="${esc(p.i)}">看簡章原文</button></div>
      </div>`
    : '<div class="empty">這筆紀錄沒有連結到簡章資料。<br>用「新增學校」從清單選學校和系，就會自動連結。</div>';
}
function disarmDelete() { delArmed = false; clearTimeout(delTimer); const b = $('#a-delete'); b.classList.remove('armed'); b.textContent = '刪除'; }

/* ---------- wiring: school dialog ---------- */
$('#a-methods').innerHTML = METHODS.map((m, i) => `<label class="check"><input type="checkbox" id="am-${i}" value="${esc(m)}">${esc(m)}</label>`).join('');
for (const [sel, key] of [['#a-school', 'school'], ['#a-dept', 'dept'], ['#a-url', 'url'], ['#a-notes', 'notes'], ['#a-prep', 'prep'], ['#a-asked', 'asked']]) {
  $(sel).addEventListener('input', e => {
    cur[key] = e.target.value;
    if (key === 'school' || key === 'dept') renderAppHead();
    if (!composing(e)) commitSoon();
  });
  $(sel).addEventListener('compositionend', () => commitSoon());
}
for (const [sel, key] of [['#a-fee', 'fee'], ['#a-quota', 'quota']]) $(sel).addEventListener('input', e => { cur[key] = numOrNull(e.target.value); commitSoon(); });
$('#a-methods').addEventListener('change', () => { cur.methods = $$('#a-methods input:checked').map(i => i.value); commit(); });
$('#a-tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
$('#a-tabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const tabs = $$('#a-tabs [data-tab]'), i = tabs.findIndex(b => b.dataset.tab === curTab);
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  showTab(next.dataset.tab); next.focus();
});
$('#a-stepper').addEventListener('click', e => {
  const b = e.target.closest('[data-step]');
  if (!b || !cur) return;
  if (b.dataset.step === 'result') { pickResult = true; renderNextStep(); return; }
  applyStatus({status: b.dataset.step});
});
$('#a-next').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || !cur) return;
  const act = $('#a-next')._actions[Number(b.dataset.act)];
  if (!act) return;
  if (act.cancel) { pickResult = false; renderNextStep(); return; }
  if (act.tab) { showTab(act.tab); return; }
  applyStatus(act.set);
});
$('#a-next').addEventListener('change', e => {
  if (e.target.dataset.check) { cur[e.target.dataset.check] = e.target.checked; renderNextStep(); commit(); }
});
$('#a-next').addEventListener('input', e => {
  if (e.target.id === 'a-wait') { cur.waitNo = numOrNull(e.target.value); renderStepper(); commitSoon(); }
});
$('#a-add-date').addEventListener('click', () => {
  cur.dates.push({id: uid(), kind: 'interview', date: '', end: '', time: '', note: ''});
  renderDates(); renderTabCounts();
  const rows = $$('#a-dates .date-row'), last = rows[rows.length - 1];
  last.scrollIntoView({block: 'nearest'});
  $('input[type="date"]', last).focus();
});
$('#a-dates').addEventListener('input', e => {
  const row = e.target.closest('.date-row'); if (!row) return;
  const d = cur.dates.find(x => x.id === row.dataset.id); if (!d) return;
  d[e.target.dataset.f] = e.target.value;
  if (!composing(e)) commitSoon();
});
$('#a-dates').addEventListener('change', e => { if (['kind', 'date', 'time'].includes(e.target.dataset.f)) { commitSoon.flush(); renderNextStep(); } });
$('#a-dates').addEventListener('click', e => {
  const b = e.target.closest('[data-del-date]'); if (!b) return;
  cur.dates = cur.dates.filter(d => d.id !== b.dataset.delDate);
  renderDates(); renderTabCounts(); renderNextStep(); commit();
});
$('#a-add-doc').addEventListener('click', () => {
  cur.docs.push({id: uid(), name: '', done: false});
  renderDocs(); renderTabCounts();
  const rows = $$('#a-docs .doc-row');
  $('input[type="text"]', rows[rows.length - 1]).focus();
});
$('#a-docs').addEventListener('input', e => {
  const row = e.target.closest('.doc-row'); if (!row) return;
  const d = cur.docs.find(x => x.id === row.dataset.id); if (!d) return;
  if (e.target.dataset.f === 'name') { d.name = e.target.value; if (!composing(e)) commitSoon(); }
});
$('#a-docs').addEventListener('change', e => {
  const row = e.target.closest('.doc-row'); if (!row || e.target.dataset.f !== 'done') return;
  const d = cur.docs.find(x => x.id === row.dataset.id); if (!d) return;
  d.done = e.target.checked;
  row.classList.toggle('done', d.done);
  renderTabCounts(); renderNextStep();
  commit();
});
$('#a-docs').addEventListener('click', e => {
  const b = e.target.closest('[data-del-doc]'); if (!b) return;
  cur.docs = cur.docs.filter(d => d.id !== b.dataset.delDoc);
  renderDocs(); renderTabCounts(); commit();
});
$('#a-delete').addEventListener('click', () => {
  if (!delArmed) { delArmed = true; const b = $('#a-delete'); b.classList.add('armed'); b.textContent = '確定刪除？'; delTimer = setTimeout(disarmDelete, 4000); return; }
  const id = cur.id;
  disarmDelete();
  cur = null;
  dlgApp.close();
  removeApp(id);
  toast('已刪除');
});
dlgApp.addEventListener('click', e => { const v = e.target.closest('[data-view-prog]'); if (v) openProgram(v.dataset.viewProg); });
dlgApp.addEventListener('close', () => {
  const id = cur && cur.id;
  if (cur) commitSoon.flush();
  cur = null;
  if (id && S.apps.some(a => a.id === id)) flashSchool(id);
});

/* ---------- wiring: add wizard ---------- */
const refreshWizList = debounce(() => { wiz.active = 0; renderWizardList(); }, 80);
dlgAdd.addEventListener('input', e => {
  if (e.target.id !== 'add-q') return;
  wiz.q = e.target.value;
  if (!composing(e)) refreshWizList();
});
dlgAdd.addEventListener('compositionend', e => { if (e.target.id === 'add-q') { wiz.q = e.target.value; refreshWizList(); } });
dlgAdd.addEventListener('keydown', e => {
  if (e.target.id !== 'add-q' || composing(e)) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!wiz.choices.length) return;
    const step = e.key === 'ArrowDown' ? 1 : -1;
    wiz.active = (wiz.active + step + wiz.choices.length) % wiz.choices.length;
    renderWizardList();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    refreshWizList.flush();
    if (wiz.choices.length) chooseWizard(Math.min(wiz.active, wiz.choices.length - 1));
  }
});
dlgAdd.addEventListener('change', e => {
  if (e.target.id === 'add-open') { wiz.open = e.target.checked; wiz.active = 0; renderWizardList(); }
  if (e.target.id === 'add-applied') wiz.applied = e.target.checked;
});
dlgAdd.addEventListener('click', e => {
  const c = e.target.closest('[data-choice]');
  if (c) { chooseWizard(Number(c.dataset.choice)); return; }
  const back = e.target.closest('[data-back]');
  if (back) { setWizStep(Number(back.dataset.back)); return; }
  const v = e.target.closest('[data-view-prog]');
  if (v) { openProgram(v.dataset.viewProg); return; }
  if (e.target.closest('#add-manual')) { dlgAdd.close(); openApp(null, 'info'); return; }
  if (e.target.closest('#add-confirm')) { confirmAdd(); return; }
  if (e.target.closest('#add-same')) { setWizStep(2, {pid: null, open: false}); return; }
  if (e.target.closest('#add-other')) { setWizStep(1, {school: null, pid: null}); return; }
  if (e.target.closest('#add-finish')) dlgAdd.close();
});
dlgAdd.addEventListener('close', () => { if (wiz.addedId) flashSchool(wiz.addedId); wiz.addedId = null; });

/* ---------- wiring: main ---------- */
$('#btn-add').addEventListener('click', () => openWizard());
$('#btn-guide').addEventListener('click', () => $('#dlg-guide').showModal());
$('#btn-backup').addEventListener('click', () => { $('#ics-url').textContent = `webcal://${location.host}/api/calendar.ics`; $('#dlg-backup').showModal(); });
$('#ics-copy').addEventListener('click', async () => {
  const url = $('#ics-url').textContent;
  try { await navigator.clipboard.writeText(url); toast('已複製，到行事曆 App 貼上就能訂閱'); }
  catch { const r = document.createRange(); r.selectNodeContents($('#ics-url')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('請按 ⌘C 複製反白的網址'); }
});
$$('dialog').forEach(d => {
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
  $$('[data-close]', d).forEach(b => b.addEventListener('click', () => d.close()));
});
$('#school-list').addEventListener('click', e => { const b = e.target.closest('[data-app]'); if (b) openApp(b.dataset.app); });
$('#example-note').addEventListener('click', async e => {
  if (e.target.id !== 'clear-ex') return;
  if (!clearArmed) { clearArmed = true; renderSchools(); setTimeout(() => { clearArmed = false; renderSchools(); }, 4000); return; }
  clearArmed = false;
  for (const a of S.apps.filter(x => x.example)) await removeApp(a.id);
  toast('範例已清除');
});
$('#calendar').addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (!b) return; ui.day = ui.day === b.dataset.day ? null : b.dataset.day; renderTimeline(); });
$('#cal-prev').addEventListener('click', () => { const d = new Date(ui.cal.y, ui.cal.m - 1, 1); ui.cal = {y: d.getFullYear(), m: d.getMonth()}; renderTimeline(); });
$('#cal-next').addEventListener('click', () => { const d = new Date(ui.cal.y, ui.cal.m + 1, 1); ui.cal = {y: d.getFullYear(), m: d.getMonth()}; renderTimeline(); });
$('#cal-today').addEventListener('click', () => { const d = new Date(); ui.cal = {y: d.getFullYear(), m: d.getMonth()}; ui.day = null; renderTimeline(); });
$('#ev-clear').addEventListener('click', () => { ui.day = null; renderTimeline(); });
$('#events').addEventListener('click', e => { const li = e.target.closest('[data-app]'); if (li) openApp(li.dataset.app); });
$('#events').addEventListener('keydown', e => { if (e.key !== 'Enter') return; const li = e.target.closest('[data-app]'); if (li && e.target === li) openApp(li.dataset.app); });

$('#q').addEventListener('input', e => { ui.q = e.target.value; ui.all = false; if (!composing(e)) runSearchSoon(); });
$('#q').addEventListener('compositionend', e => { ui.q = e.target.value; runSearchSoon(); });
$('#q').addEventListener('keydown', e => {
  if (composing(e)) return;
  if (e.key === 'Enter') runSearchSoon.flush();
  if (e.key === 'Escape') { e.target.value = ''; ui.q = ''; runSearch(); }
});
$('#f-region').addEventListener('change', e => { ui.region = e.target.value; ui.limit = 40; renderFinder(); });
for (const [id, key] of [['#f-open', 'open'], ['#f-nopf', 'nopf'], ['#f-norl', 'norl']]) $(id).addEventListener('change', e => { ui[key] = e.target.checked; ui.limit = 40; renderFinder(); });
$('#result-meta').addEventListener('change', e => { if (e.target.id === 'sort') { ui.sort = e.target.value; ui.sortChosen = true; renderFinder(); } });
$('#results').addEventListener('click', e => {
  const chip = e.target.closest('[data-q]');
  if (chip) { ui.q = chip.dataset.q; $('#q').value = ui.q; runSearch(); return; }
  if (e.target.closest('#show-all')) { ui.all = true; ui.sort = 'deadline'; renderFinder(); return; }
  if (e.target.closest('#btn-cond2')) { openProfile(); return; }
  if (e.target.closest('#show-more')) { ui.limit += 40; renderFinder(); return; }
  const r = e.target.closest('[data-prog]');
  if (r) openProgram(r.dataset.prog);
});
$('#p-tabs').addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (b) showPage(Number(b.dataset.page)); });
$('#p-sub').addEventListener('click', e => { const b = e.target.closest('[data-switch]'); if (b) openProgram(b.dataset.switch); });
$('#p-actions').addEventListener('click', e => {
  const add = e.target.closest('[data-add-prog]');
  if (add) { dlgProg.close(); openWizard({pid: add.dataset.addProg}); return; }
  const open = e.target.closest('[data-open-app]');
  if (open) { dlgProg.close(); openApp(open.dataset.openApp); }
});
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || composing(e)) return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return;
  if (document.querySelector('dialog[open]')) return;
  e.preventDefault();
  $('#q').focus();
  $('#q').select();
});

/* ---------- 我的條件 ---------- */
const dlgProfile = $('#dlg-profile');
function openProfile() {
  const have = new Set(S.profile.tags || []);
  $('#cond-groups').innerHTML = CONDITIONS.map(g => `<section class="cond-group"><h3>${esc(g.group)}</h3><div class="cond-list">${g.items.map(c => `<label class="check"><input type="checkbox" value="${c.id}" ${have.has(c.id) ? 'checked' : ''}>${esc(c.label)}</label>`).join('')}</div></section>`).join('');
  dlgProfile.showModal();
}
async function saveProfile(patch) {
  S.profile = {...S.profile, ...patch};
  try { await request('PUT', '/api/profile', S.profile); } catch (e) { toast('儲存失敗：' + e.message); }
}
$('#cond-save').addEventListener('click', async () => {
  const tags = $$('#cond-groups input:checked').map(i => i.value);
  await saveProfile({tags});
  ui.match = tags.length > 0;
  ui.sort = ui.match ? 'match' : (ui.q.trim() ? 'smart' : 'deadline');
  ui.limit = 40;
  dlgProfile.close();
  renderFinder();
  if (tags.length) toast(`已依 ${tags.length} 個條件篩選科系`);
});
$('#cond-clear').addEventListener('click', () => { $$('#cond-groups input').forEach(i => { i.checked = false; }); });
$('#cond-bar').addEventListener('click', e => { if (e.target.closest('#btn-cond') || e.target.closest('[data-edit-cond]')) openProfile(); });
$('#cond-bar').addEventListener('change', e => { if (e.target.id === 'f-match') { ui.match = e.target.checked; ui.sort = ui.match ? 'match' : (ui.q.trim() ? 'smart' : 'deadline'); ui.limit = 40; renderFinder(); } });

/* ---------- backup ---------- */
$('#b-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch { toast('這不是有效的備份檔'); return; }
  try {
    const r = await request('POST', '/api/import', data);
    await loadRecords();
    toast(`已還原 ${r.imported} 間學校`);
    $('#dlg-backup').close();
  } catch (err) { toast('還原失敗：' + err.message); }
});
$('#b-csv').addEventListener('click', () => {
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const us = k => { const [y, m, d] = k.split('-'); return `${m}/${d}/${y}`; };
  const t12 = t => { let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${pad(h)}:${pad(m)} ${ap}`; };
  const rows = [['Subject', 'Start Date', 'Start Time', 'End Date', 'End Time', 'All Day Event', 'Description']];
  for (const ev of allEvents()) {
    const timed = /^\d{2}:\d{2}$/.test(ev.time || '');
    const endT = timed ? `${pad(Math.min(+ev.time.slice(0, 2) + 1, 23))}:${ev.time.slice(3)}` : '';
    rows.push([`${appName(ev.app)}｜${KINDS[ev.kind].label}`, us(ev.date), timed ? t12(ev.time) : '', us(ev.last), timed ? t12(endT) : '', timed ? 'False' : 'True', ev.note || '']);
  }
  const url = URL.createObjectURL(new Blob([rows.map(r => r.map(q).join(',')).join('\r\n')], {type: 'text/csv;charset=utf-8'}));
  const a = Object.assign(document.createElement('a'), {href: url, download: `特選行事曆-${todayKey()}.csv`});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

/* ---------- boot ---------- */
function renderMain() { renderTop(); renderSchools(); renderTimeline(); renderFinder(); }
async function loadRecords() {
  const d = await request('GET', '/api/records');
  S.apps = (d.apps || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  S.profile = d.profile || {};
  if ((S.profile.tags || []).length && !ui.q.trim()) ui.match = true;
  renderMain();
}
async function loadPrograms() {
  const [d, terms, links, meta] = await Promise.all([request('GET', '/data/programs.json'), request('GET', '/data/search-terms.json').catch(() => null), request('GET', '/data/school-links.json').catch(() => null), request('GET', '/api/meta').catch(() => null)]);
  if (meta) { P.year = meta.year; P.pdf = new Set(meta.pdfSchools || []); }
  if (P.year) for (const el of [$('#brand-year'), $('#g-year')]) el.textContent = `${P.year} 學年度大學特殊選才`;
  if (terms) P.terms = {synonyms: terms.synonyms || {}, aliases: terms.aliases || {}};
  if (links) P.links = links.schools || {};
  P.schools = d.schools;
  P.fetched = d.fetched;
  P.programs = d.programs.map(p => {
    const s = d.schools[p.s], {main, quals} = splitName(p.n);
    return {...p, school: s.name, code: s.code, _region: s.region, _reg: progReg(p), _main: main, _quals: quals};
  });
  P.byId = new Map(P.programs.map(p => [p.i, p]));
  const g = {};
  for (const p of P.programs) if (p.g) g[p.g] = (g[p.g] || 0) + 1;
  P.groups = Object.entries(g).sort((a, b) => b[1] - a[1]);
  $('#school-names').innerHTML = d.schools.map(s => `<option value="${esc(s.name)}"></option>`).join('');
  $('#g-fetched').textContent = (P.fetched || '').replace(/-/g, '/');
}
window.addEventListener('focus', () => {
  if (document.querySelector('dialog[open]') || Object.keys(inflight).length) return;
  loadRecords().catch(() => {});
});
renderMain();
Promise.all([loadRecords(), loadPrograms()])
  .then(renderMain)
  .catch(e => toast('無法連到伺服器：' + e.message));
})();
