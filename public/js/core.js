// 共用：詞彙、工具函式、狀態、儲存、由紀錄推導出的日期與提醒、簡章資料的處理。
// 各個畫面（今天、行事曆、學校、找科系、學校紀錄）都從這裡 import。

/* ---------- 詞彙 ---------- */
export const STATUS = {
  prep: {label: '準備中', tone: ''},
  applied: {label: '已報名', tone: 'info'},
  interview: {label: '待面試', tone: 'info'},
  waiting: {label: '等放榜', tone: 'info'},
  admitted: {label: '正取', tone: 'ok'},
  waitlist: {label: '備取', tone: 'warn'},
  rejected: {label: '未錄取', tone: 'muted'},
  out: {label: '一階未通過', tone: 'muted'},
  skipped: {label: '沒有報名', tone: 'muted'},
};
export const STAGE_ORDER = {admitted: 0, waitlist: 1, interview: 2, waiting: 3, applied: 4, prep: 5, rejected: 6, out: 7, skipped: 8};
export const KINDS = {
  reg: {label: '報名截止', cat: 'due'},
  pay: {label: '繳費截止', cat: 'due'},
  upload: {label: '繳件截止', cat: 'due'},
  letter: {label: '推薦函截止', cat: 'due'},
  stage1: {label: '一階名單', cat: 'result'},
  window: {label: '甄試期間', cat: 'test'},
  interview: {label: '面試', cat: 'test'},
  exam: {label: '筆試／術科', cat: 'test'},
  release: {label: '放榜', cat: 'result'},
  review: {label: '成績複查', cat: 'other'},
  confirm: {label: '報到截止', cat: 'due'},
  giveup: {label: '放棄截止', cat: 'due'},
  wait: {label: '備取遞補', cat: 'result'},
  score: {label: '成績單', cat: 'result'},
  open: {label: '報名開始', cat: 'other'},
  other: {label: '其他', cat: 'other'},
};
export const DEADLINE_KINDS = new Set(['reg', 'pay', 'upload', 'letter', 'confirm', 'giveup', 'review']);
export const METHODS = ['資料審查', '面試', '筆試', '實作／術科'];
export const DEFAULT_DOCS = ['自傳／個人陳述', '讀書計畫', '特殊表現證明文件', '推薦信', '系所指定其他資料'];
export const SUGGEST = ['資工', '資安', 'AIS3', 'APCS', '奧林匹亞', '科展', '電機', '資管', '醫學', '生科', '數學', '物理', '化學', '設計', '外文', '法律', '心理', '教育'];
export const REGION_NAME = {北: '北部', 中: '中部', 南: '南部', 東: '東部・離島'};
export const REGION_ORDER = {北: 0, 中: 1, 南: 2, 東: 3};
export const PALETTE_SIZE = 10;
// 面試當天通常要帶的東西；每間學校可以自己增減。
export const DEFAULT_KIT = ['身分證', '准考證／應試通知', '作品集或成果（紙本或平板）', '自傳、讀書計畫各一份', '交通方式與路線查好', '服裝整理'];
// 常見面試問題，寫面試筆記時的提示。
export const COMMON_QUESTIONS = ['請用一分鐘自我介紹。', '為什麼選我們系？為什麼走特殊選才？', '高中最有成就感的一件事是什麼？遇到什麼困難？', '你的作品／專題裡，哪部分是你自己做的？', '如果沒有錄取，你的計畫是什麼？', '你對這個領域未來四年的規劃？', '有沒有想問我們的問題？'];

// 「依我的條件找科系」：勾選的經歷，對照簡章的報名資格文字。關鍵字比對前會先正規化（小寫、台→臺）。
export const CONDITIONS = [
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
export const COND_BY_ID = new Map(CONDITIONS.flatMap(g => g.items).map(c => [c.id, c]));

/* ---------- 工具 ---------- */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const clone = o => JSON.parse(JSON.stringify(o));
export const uid = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
export const pad = n => String(n).padStart(2, '0');
export const toKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const todayKey = () => toKey(new Date());
export const isKey = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
export const diffDays = k => Math.round((parseKey(k) - parseKey(todayKey())) / 864e5);
export const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return toKey(d); };
export const md = k => { const d = parseKey(k); return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`; };
export const fmtDate = k => { const d = parseKey(k); return d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}` : md(k); };
export const wd = k => '週' + '日一二三四五六'[parseKey(k).getDay()];
export const wdShort = k => '日一二三四五六'[parseKey(k).getDay()];
export const cdText = n => n === 0 ? '今天' : n === 1 ? '明天' : n === 2 ? '後天' : n > 0 ? `${n} 天後` : `${-n} 天前`;
export const cdClass = n => n < 0 ? '' : n <= 1 ? 'now' : n <= 5 ? 'soon' : '';
export const numOrNull = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
export const appName = a => a.school + (a.dept ? ' ' + a.dept : '');
export const normName = s => String(s || '').replace(/台/g, '臺').replace(/\s+/g, '').toLowerCase();
export const fmtMoney = n => Number(n || 0).toLocaleString('zh-TW');
// 注音、倉頡等輸入法還在選字時，Enter 與輸入事件都不能當成「完成輸入」。
export const composing = e => e.isComposing || e.keyCode === 229;
// flush() 立刻執行還在等的那一次。
export const debounce = (fn, ms) => {
  let t = null;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  f.flush = (...a) => { if (t === null) return; clearTimeout(t); t = null; fn(...a); };
  return f;
};
export async function request(method, url, body) {
  const res = await fetch(url, {method, headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}
let toastTimer;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
// 內網的 http 網址沒有 navigator.clipboard，退回用隱藏的 textarea 複製。
export async function copyText(text, okMsg = '已複製') {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); toast(okMsg); return true; } } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.append(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy'); ta.remove();
    toast(ok ? okMsg : '無法自動複製，請手動選取'); return ok;
  } catch { toast('無法自動複製，請手動選取'); return false; }
}
export function download(name, text, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = Object.assign(document.createElement('a'), {href: url, download: name});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- 狀態 ---------- */
export const S = {apps: [], todos: [], profile: {}};
export const P = {schools: [], programs: [], byId: new Map(), groups: [], fetched: '', year: null, pdf: new Set(), terms: {synonyms: {}, aliases: {}}, links: {}, season: []};
// 學測、分科等大考日期（data/season.json），設定裡可以關掉。
export const seasonItems = () => S.profile.hideExams ? [] : P.season.filter(e => isKey(e.date)).map(e => ({...e, end: isKey(e.end) && e.end > e.date ? e.end : '', last: isKey(e.end) && e.end > e.date ? e.end : e.date, season: true}));
const renderers = new Set();
export const onChange = fn => renderers.add(fn);
export function rerender() { for (const fn of renderers) fn(); }
// 學校紀錄的對話框打開時，「儲存中／已儲存」的顯示由它接手。
export const saveHooks = {state: null};

/* ---------- 儲存 ---------- */
const inflight = {}, latest = {};
export const saving = () => Object.keys(inflight).length > 0;
export function persist(app) {
  latest[app.id] = app;
  if (inflight[app.id]) return inflight[app.id];
  saveHooks.state && saveHooks.state(app.id, 'saving');
  inflight[app.id] = (async () => {
    try {
      while (latest[app.id]) {
        const body = latest[app.id];
        delete latest[app.id];
        await request('PUT', `/api/apps/${encodeURIComponent(body.id)}`, body);
      }
      saveHooks.state && saveHooks.state(app.id, 'saved');
    } catch (e) {
      delete latest[app.id];
      saveHooks.state && saveHooks.state(app.id, 'error');
      toast('儲存失敗：' + e.message);
    } finally {
      delete inflight[app.id];
    }
  })();
  return inflight[app.id];
}
export function upsertApp(app) {
  const i = S.apps.findIndex(a => a.id === app.id);
  if (i >= 0) S.apps[i] = app; else S.apps.push(app);
  rerender();
  return persist(clone(app));
}
export async function removeApp(id) {
  S.apps = S.apps.filter(a => a.id !== id);
  rerender();
  delete latest[id];
  try { await inflight[id]; } catch { /* reported already */ }
  try { await request('DELETE', `/api/apps/${encodeURIComponent(id)}`); } catch (e) { toast('刪除失敗：' + e.message); }
}
export async function saveProfile(patch) {
  S.profile = {...S.profile, ...patch};
  try { return await request('PUT', '/api/profile', S.profile); } catch (e) { toast('儲存失敗：' + e.message); }
}
const pushTodos = debounce(async () => { try { await request('PUT', '/api/todos', S.todos); } catch (e) { toast('待辦儲存失敗：' + e.message); } }, 300);
export function saveTodos() { rerender(); pushTodos(); }

/* ---------- 由紀錄推導 ---------- */
export const activeApp = a => !['rejected', 'out', 'skipped'].includes(a.status);
export const colorOf = a => Number.isInteger(a.color) ? ((a.color % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE : (Math.max(0, S.apps.indexOf(a)) % PALETTE_SIZE);
export function nextColor() {
  const used = S.apps.map(colorOf);
  for (let i = 0; i < PALETTE_SIZE; i++) if (!used.includes(i)) return i;
  return S.apps.length % PALETTE_SIZE;
}
// 報名截止的備註裡有「（10/14 10:00 起）」就推出一個「報名開始」的日期（只用來顯示，不存檔）。
function derivedOpen(e, a) {
  if (e.kind !== 'reg' || !isKey(e.date)) return null;
  const m = /[（(](\d{1,2})\/(\d{1,2})(?:\s+(\d{2}:\d{2}))?\s*起[）)]/.exec(e.note || '');
  if (!m) return null;
  const y = Number(e.date.slice(0, 4)), mm = Number(m[1]), dd = Number(m[2]);
  const key = `${mm > Number(e.date.slice(5, 7)) ? y - 1 : y}-${pad(mm)}-${pad(dd)}`;
  if (!isKey(key) || key > e.date) return null;
  return {id: e.id + ':open', kind: 'open', date: key, end: '', last: key, time: m[3] || '', note: '', app: a, derived: true};
}
// 已經錄取的學校不用再看「備取遞補」；沒錄取、沒報名的學校所有日期都不用再看。
function relevant(e, a) {
  if (!activeApp(a)) return false;
  if (a.status === 'admitted' && e.kind === 'wait') return false;
  if (e.kind === 'interview' && a.ivSkip) return false;
  return true;
}
export function allEvents(opts = {}) {
  const out = [];
  for (const a of S.apps) for (const e of a.dates || []) {
    if (!isKey(e.date) || !KINDS[e.kind]) continue;
    if (opts.live && !relevant(e, a)) continue;
    const end = isKey(e.end) && e.end > e.date ? e.end : '';
    out.push({...e, end, last: end || e.date, app: a});
    const op = opts.live && derivedOpen(e, a);
    if (op && op.date >= todayKey()) out.push(op);
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || (x.time || '99').localeCompare(y.time || '99'));
}
export const focusDate = ev => ev.date >= todayKey() ? ev.date : ev.last;
export function upcoming(list = allEvents()) {
  const t = todayKey();
  return list.filter(ev => ev.last >= t).sort((a, b) => focusDate(a).localeCompare(focusDate(b)) || (a.time || '99').localeCompare(b.time || '99'));
}
// 只算還要追的日期：進行中的學校、和目前狀態有關的日期、推出來的「報名開始」。
export const liveEvents = () => allEvents({live: true});
export function firstDate(app, kinds) {
  const t = todayKey();
  const ds = (app.dates || []).filter(d => kinds.includes(d.kind) && isKey(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  return ds.find(d => (d.end || d.date) >= t) || ds[ds.length - 1] || null;
}
export const nextEventOf = a => upcoming(allEvents().filter(ev => ev.app.id === a.id))[0] || null;
export function clashes() {
  const t = todayKey(), map = {};
  for (const ev of liveEvents()) if ((ev.kind === 'interview' || ev.kind === 'exam') && ev.date >= t && !ev.derived) (map[ev.date] ||= []).push(ev);
  return Object.entries(map).filter(([, evs]) => new Set(evs.map(e => e.app.id)).size > 1).map(([date, evs]) => ({date, evs}));
}
export const chosenSchool = () => S.apps.find(a => a.choice === 'attend' && ['admitted', 'waitlist'].includes(a.status)) || null;
// 需要注意的事，依嚴重程度排序。每一條都連到一間學校。
export function alerts() {
  const out = [], t = todayKey();
  for (const c of clashes()) out.push({crit: true, app: c.evs[0].app, text: `${fmtDate(c.date)} 面試撞期：${c.evs.map(e => e.app.school).join('、')}`});
  for (const a of S.apps) {
    const reg = firstDate(a, ['reg']);
    if (a.status === 'prep' && reg && reg.date >= t && diffDays(reg.date) <= 5) out.push({crit: diffDays(reg.date) <= 1, app: a, text: `${appName(a)} 報名${diffDays(reg.date) === 0 ? '今天' : ' ' + cdText(diffDays(reg.date))}${reg.time ? ' ' + reg.time : ''} 截止，還沒報名`});
    if (a.status === 'prep' && reg && reg.date < t && diffDays(reg.date) >= -14) out.push({app: a, text: `${appName(a)} 報名已在 ${fmtDate(reg.date)} 截止，還是「準備中」。點進去確認有沒有報名`});
    const left = (a.docs || []).filter(d => !d.done).length;
    const due = firstDate(a, ['upload', 'letter']) || reg;
    if (left && due && due.date >= t && diffDays(due.date) <= 7 && ['prep', 'applied'].includes(a.status)) out.push({app: a, text: `${appName(a)} 還有 ${left} 項備審沒完成，${fmtDate(due.date)} 截止`});
    if ((a.status === 'admitted' || a.status === 'waitlist') && !a.choice) {
      const cf = firstDate(a, ['confirm']);
      if (cf && cf.date >= t && diffDays(cf.date) <= 14) out.push({crit: diffDays(cf.date) <= 3, app: a, text: `${appName(a)} 要在 ${fmtDate(cf.date)} 前決定是否就讀`});
    }
    if (a.status === 'admitted' && a.choice === 'decline' && !a.giveupDone) {
      const g = firstDate(a, ['giveup']);
      out.push({crit: true, app: a, text: `${appName(a)} 記得${g ? `在 ${fmtDate(g.date)} 前` : ''}辦理放棄，否則不能參加其他管道`});
    }
  }
  // 決定要讀某一間之後，其他正取、備取的學校都要在期限內放棄。
  const going = chosenSchool();
  if (going) for (const a of S.apps) {
    if (a.id === going.id || !['admitted', 'waitlist'].includes(a.status) || a.choice === 'decline') continue;
    const g = firstDate(a, ['giveup']);
    out.push({crit: !!g && diffDays(g.date) <= 7, app: a, text: `你決定讀 ${appName(going)}，${appName(a)} 的${a.status === 'admitted' ? '正取' : '備取'}也要辦理放棄${g ? `（${fmtDate(g.date)}${g.time ? ' ' + g.time : ''} 前）` : ''}`});
  }
  return out.sort((x, y) => (y.crit ? 1 : 0) - (x.crit ? 1 : 0));
}

/* ---------- 簡章資料 ---------- */
export const progReg = p => { const r = (p.ev || []).find(e => e[0] === 'reg'); return r ? {start: r[1], end: r[2] || r[1], time: r[4] || (!r[2] ? r[3] : '') || ''} : null; };
// 各校招生網與報名系統（data/school-links.json），用學校名稱找。
export function schoolLinks(name) {
  const s = P.schools.find(x => x.name === name);
  return s && P.links[s.code] ? P.links[s.code] : null;
}
export const extLink = (href, label, cls = 'btn sm ext') => `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
// 簡章 PDF 只有執行過 build-data 的伺服器才有；沒有就不顯示 PDF 連結。
export const pdfUrl = (code, page) => P.pdf.has(code) ? `/data/brochures/pdf/${code}.pdf${page ? '#page=' + page : ''}` : null;
export const pev = (p, kinds) => (p.ev || []).find(e => kinds.includes(e[0])) || null;
export const needsLetter = p => !!p.rl && /^[暗明]/.test(p.rl) && !/非必繳|選繳/.test(p.rl);
export const isTest = n => /筆試|術科|實作|測驗|展演|專長/.test(n);
export const itemClass = n => isTest(n) ? 'test' : /面試|口試/.test(n) ? 'iv' : /審查|書面|書審|資料/.test(n) ? 'doc' : 'other';
export const rlText = rl => rl === 'N' ? '不需要' : rl.replace(/^暗/, '暗推').replace(/^明/, '明推');
// 簡章的繳交資料說明很長，清單只留名稱：「自傳(含學習歷程描述…)」→「自傳」。
export function shortDoc(t) {
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
export const docListHtml = p => (p.docs || []).length ? `<div class="p-sec"><h4>簡章要求繳交的資料<span class="src">自動節錄，請對照簡章</span></h4><ol class="doc-req">${p.docs.map(d => `<li>${esc(d)}</li>`).join('')}</ol></div>` : '';
export const mine = pid => S.apps.find(a => a.programId === pid);
export const regKey = p => { const t = todayKey(); return !p._reg ? '9' : p._reg.end >= t ? '0' + p._reg.end : '1' + p.i; };
// 「資安外加 資訊工程學系」→ 學系名稱「資訊工程學系」＋ 招生組別「資安外加」
export function splitName(n) {
  const quals = [];
  let main = '';
  for (const tok of String(n || '').split(' ')) {
    if (/(系|學程|學士班|學院|學群)/.test(tok) && tok.length > main.length) { if (main) quals.push(main); main = tok; } else quals.push(tok);
  }
  if (!main) main = n || '';
  const paren = /[(（]([^)）]+)[)）]$/.exec(main);
  if (paren) { quals.push(paren[1]); main = main.slice(0, paren.index); }
  const letter = /([A-Z甲乙丙丁]組)$/.exec(main);
  if (letter && main.length > letter[1].length + 2) { quals.unshift(letter[1]); main = main.slice(0, -letter[1].length); }
  return {main, quals: quals.filter(Boolean)};
}
export const deptMain = a => splitName(a.dept || '').main || a.dept || '';
// 學校簡稱：先用 data/search-terms.json 的簡稱（師大、政大、市北…），沒有的就去掉「國立」「大學」。
const shortCache = new Map();
export const resetShortNames = () => shortCache.clear();
export function shortSchool(name) {
  name = String(name || '');
  if (!name) return '';
  if (shortCache.has(name)) return shortCache.get(name);
  const aliases = Object.entries(P.terms.aliases || {}).filter(([, full]) => full === name).map(([a]) => a);
  const inName = aliases.filter(a => name.includes(a)).sort((x, y) => x.length - y.length);
  const byLen = [...aliases].sort((x, y) => x.length - y.length);
  let s = inName[0] || byLen[0] || name.replace(/^國立|^私立|^市立/, '').replace(/大學$/, '');
  if (s.length < 2) s = name.replace(/大學$/, '') || name;
  shortCache.set(name, s);
  return s;
}
export const qualPills = quals => quals.map(q => `<span class="tag">${esc(q)}</span>`).join('');
// 同一個系在幾個招生組別招生，列表上合成一列。
export function mergeRows(list) {
  const rows = [], byKey = new Map();
  for (const p of list) {
    const key = p.s + '|' + p._main;
    let r = byKey.get(key);
    if (!r) { r = {key, main: p._main, school: p.school, s: p.s, items: []}; byKey.set(key, r); rows.push(r); }
    r.items.push(p);
  }
  return rows;
}
export function bySchool(rows) {
  const groups = [], byS = new Map();
  for (const r of rows) {
    let g = byS.get(r.s);
    if (!g) { g = {school: r.school, s: r.s, rows: []}; byS.set(r.s, g); groups.push(g); }
    g.rows.push(r);
  }
  return groups;
}
export function regText(p) {
  const r = p._reg, t = todayKey();
  if (!r) return '';
  if (t < r.start) return `<span class="st-soon">${fmtDate(r.start)} 開始報名</span>`;
  if (t <= r.end) { const n = diffDays(r.end); return `<span class="st-open">報名到 ${fmtDate(r.end)}${r.time ? ' ' + r.time : ''}・${n === 0 ? '今天截止' : `剩 ${n} 天`}</span>`; }
  return `<span class="st-closed">已截止 ${fmtDate(r.end)}${r.time ? ' ' + r.time : ''}</span>`;
}
export function weightText(p) {
  const its = (p.it || []).filter(i => i[0]);
  const short = n => n.length <= 5 ? n : ({doc: '書審', iv: '面試', test: '考試', other: '其他'})[itemClass(n)];
  return its.map(([n, w]) => short(n) + (w != null ? ` ${w}%` : '')).join('・');
}
export function progMeta(p, withQuota = true) {
  const iv = pev(p, ['interview', 'exam']), rel = pev(p, ['release']);
  return [withQuota && p.q != null && `名額 ${p.q}`, regText(p), iv && `${iv[0] === 'exam' ? '筆試' : '面試'} ${fmtDate(iv[1])}`, rel && `放榜 ${fmtDate(rel[1])}`, weightText(p)].filter(Boolean);
}
export function programDates(p) {
  return (p.ev || []).filter(e => e[0] !== 'other').map(([kind, sd, ed, st, et, name, note]) => {
    const extra = note ? `・${note}` : '';
    if (DEADLINE_KINDS.has(kind) && ed) return {id: uid(), kind, date: ed, end: '', time: et || '', note: `${name}（${fmtDate(sd)}${st ? ' ' + st : ''} 起）${extra}`};
    return {id: uid(), kind, date: sd, end: ed || '', time: st || '', note: name + extra};
  });
}
// 「1,200元」「初試900；複試400」「$900(+$400)」都只取第一個數字。
export const feeNumber = s => { const m = /\d[\d,]*/.exec(String(s ?? '')); return m ? Number(m[0].replace(/,/g, '')) : null; };
// 報名這件事本身的步驟：報名、繳費、上傳並確認、推薦函。每一步都是一個會漏掉的坑。
export function regStepsFor(p) {
  const steps = ['網路報名完成'];
  if (!p || (p.ev || []).some(e => e[0] === 'pay') || /報名費|繳費/.test(String(p && p.fee || ''))) steps.push('繳費完成，留著收執聯');
  steps.push('備審上傳完成，並按「確認送出」');
  if (!p || (p.ev || []).some(e => e[0] === 'letter') || (p.rl && /^[暗明]/.test(p.rl))) steps.push('推薦函已送出（確認老師收到系統信）');
  return steps.map(n => ({id: uid(), name: n, done: false}));
}
export function appFromProgram(p) {
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
  return {
    id: uid(), school: p.school, dept: p.n, programId: p.i, status: 'prep', color: nextColor(), methods: METHODS.filter(x => m.has(x)),
    fee: feeNumber(p.fee), quota: p.q ?? null, url: /^https?:\/\//.test(p.u || '') ? p.u : '',
    dates: programDates(p), docs: docs.map(n => ({id: uid(), name: n, done: false})), regSteps: regStepsFor(p),
    notes: [p.ph && `諮詢電話：${p.ph}`, p.em && `諮詢信箱：${p.em}`].filter(Boolean).join('\n'),
    place: p.loc || '', kit: DEFAULT_KIT.map(n => ({id: uid(), name: n, done: false})),
    prep: '', asked: '', choice: '', waitNo: null, confirmDone: false, giveupDone: false, createdAt: Date.now(),
  };
}
export function blankApp() {
  return {id: uid(), school: '', dept: '', status: 'prep', color: nextColor(), methods: ['資料審查', '面試'], fee: null, quota: null, url: '', dates: [], docs: DEFAULT_DOCS.map(n => ({id: uid(), name: n, done: false})), regSteps: regStepsFor(null), notes: '', place: '', kit: DEFAULT_KIT.map(n => ({id: uid(), name: n, done: false})), prep: '', asked: '', choice: '', waitNo: null, confirmDone: false, giveupDone: false, createdAt: Date.now()};
}
export const condText = p => p._cond !== undefined ? p._cond : (p._cond = normName([p.qx, p.tgt, p.deb, p.deo, p.nt, p.pr].filter(Boolean).join(' ')));
// 這個系的報名資格提到了我勾選的哪些條件
export function matchedConds(p) {
  const tags = (S.profile.tags || []).map(id => COND_BY_ID.get(id)).filter(Boolean);
  if (!tags.length) return [];
  const text = condText(p);
  return tags.filter(c => c.kw.some(k => text.includes(normName(k))));
}

/* ---------- 下一步：依目前進度，告訴使用者該做什麼 ---------- */
export function nextStep(a) {
  const d = kinds => firstDate(a, kinds);
  const t = todayKey();
  const when = x => `${fmtDate(x.date)}${x.time ? ' ' + x.time : ''}（${cdText(diffDays(x.date))}）`;
  const left = (a.docs || []).filter(x => !x.done).length;
  const L = schoolLinks(a.school) || {};
  // 文案原則：日期在前、不解釋按鈕（按鈕本身就是說明）。
  switch (a.status) {
    case 'prep': {
      const reg = d(['reg']);
      const go = L.apply ? [{label: '報名系統', href: L.apply}] : L.adm ? [{label: '招生網', href: L.adm}] : [];
      const act = [...go, {label: '已報名', set: {status: 'applied'}, primary: true}];
      if (reg && reg.date >= t) return {text: `${when(reg)} 報名截止${left ? `，備審還有 ${left} 項沒做` : ''}。`, actions: act};
      if (reg) return {text: `報名已在 ${when(reg).replace(/（.*）/, '')} 截止。報了嗎？`, actions: [{label: '已報名', set: {status: 'applied'}, primary: true}, {label: '沒有報名', set: {status: 'skipped'}}]};
      return {text: '還沒有報名截止日，到「報名與日期」補上。', actions: act};
    }
    case 'skipped':
      return {tone: 'calm', text: '沒有報名，不會再提醒。', actions: [{label: '其實有報名', set: {status: 'applied'}}]};
    case 'applied': {
      const up = d(['upload', 'letter']), s1 = d(['stage1']), iv = d(['interview', 'exam', 'window']);
      if (left && up && up.date >= t) return {text: `${when(up)} 繳件截止，備審還有 ${left} 項沒完成。`, actions: [{label: '備審清單', tab: 'docs', primary: true}]};
      if (s1 && s1.date >= t) return {text: `${when(s1)} 公布一階名單。`, actions: [{label: '通過一階', set: {status: 'interview'}, primary: true}, {label: '沒通過', set: {status: 'out'}}]};
      if (iv && (iv.end || iv.date) >= t) return {text: `${when(iv)} 面試。`, actions: [{label: '準備面試', tab: 'interview'}, {label: '要面試了', set: {status: 'interview'}, primary: true}]};
      return {text: '等一階結果。', actions: [{label: '通過一階', set: {status: 'interview'}, primary: true}, {label: '沒通過', set: {status: 'out'}}]};
    }
    case 'interview': {
      const iv = d(['interview', 'exam', 'window']);
      return {text: iv ? `${when(iv)} 面試${a.place ? `・${a.place}` : ''}。` : '還沒有面試日期，到「面試」補上。', actions: [{label: '準備面試', tab: 'interview'}, {label: '面試完了', set: {status: 'waiting'}, primary: true}]};
    }
    case 'waiting': {
      const rel = d(['release']);
      return {text: rel ? `${when(rel)} 放榜。結果：` : '結果：', actions: [{label: '正取', set: {status: 'admitted'}}, {label: '備取', set: {status: 'waitlist'}}, {label: '未錄取', set: {status: 'rejected'}}]};
    }
    case 'admitted':
    case 'waitlist': {
      const cf = d(['confirm']), g = d(['giveup']);
      const head = a.status === 'admitted' ? '正取！' : `備取${a.waitNo ? `第 ${a.waitNo} 名` : ''}。`;
      const other = chosenSchool();
      if (!a.choice && other && other.id !== a.id) return {tone: 'danger', text: `你決定讀 ${appName(other)}，這間要${g ? `在 ${when(g)} 前` : '在期限內'}辦理放棄，否則會影響其他管道。`, actions: [{label: '放棄這間', set: {choice: 'decline'}, primary: true}, {label: '改讀這間', set: {choice: 'attend'}}], wait: a.status === 'waitlist'};
      if (!a.choice) return {text: `${head}${cf ? `${when(cf)} 前決定讀不讀。` : '決定讀不讀。'}`, actions: [{label: '要去讀', set: {choice: 'attend'}, primary: true}, {label: '放棄', set: {choice: 'decline'}}], wait: a.status === 'waitlist'};
      if (a.choice === 'attend') return {tone: 'calm', text: a.confirmDone ? '已報到。' : `${cf ? `${when(cf)} 前` : ''}完成聲明就讀或報到。`, check: ['confirmDone', '已完成報到'], actions: [{label: '改變決定', set: {choice: ''}}], wait: a.status === 'waitlist'};
      return {tone: 'danger', text: `放棄要在${g ? ` ${when(g)} 前` : '學校規定期限內'}辦理，否則不能參加繁星、申請入學和分發入學。`, check: ['giveupDone', '已交出放棄聲明'], actions: [{label: '改變決定', set: {choice: ''}}]};
    }
    case 'rejected':
    case 'out':
      return {tone: 'calm', text: a.status === 'out' ? '一階未通過。' : '未錄取。', actions: []};
  }
  return {text: '', actions: []};
}

/* ---------- 載入 ---------- */
export async function loadRecords() {
  const d = await request('GET', '/api/records');
  S.apps = (d.apps || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  S.todos = Array.isArray(d.todos) ? d.todos : [];
  S.profile = d.profile || {};
  rerender();
}
export async function loadPrograms() {
  const [d, terms, links, meta, season] = await Promise.all([request('GET', '/data/programs.json'), request('GET', '/data/search-terms.json').catch(() => null), request('GET', '/data/school-links.json').catch(() => null), request('GET', '/api/meta').catch(() => null), request('GET', '/data/season.json').catch(() => null)]);
  if (meta) { P.year = meta.year; P.pdf = new Set(meta.pdfSchools || []); }
  if (season && Array.isArray(season.events)) P.season = season.events;
  if (terms) P.terms = {synonyms: terms.synonyms || {}, aliases: terms.aliases || {}};
  resetShortNames();
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
  rerender();
}
