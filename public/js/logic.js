// 事件模型：伺服器（.ics、每日提醒、總表、遷移與簡章同步）和網頁共用這一份。
// 純函式：不碰 DOM、不讀時鐘。跟時間有關的函式都要傳 now（臺灣時間），伺服器和瀏覽器才不會在半夜算出不同的結果。
// 規則來源：scratchpad/DESIGN.md §2–§3；API 說明在 docs/logic-api.md。

/* ---------- 詞彙 ---------- */
export const STATUS = ['prep', 'applied', 'interview', 'waiting', 'admitted', 'waitlist', 'rejected', 'out', 'skipped'];
export const STATUS_LABEL = {prep: '準備中', applied: '已報名', interview: '待面試', waiting: '等放榜', admitted: '正取', waitlist: '備取', rejected: '未錄取', out: '一階未通過', skipped: '沒有報名'};
export const KIND_LABEL = {reg: '報名截止', pay: '繳費截止', upload: '繳件截止', letter: '推薦函截止', stage1: '一階名單', window: '甄試期間', interview: '面試', exam: '筆試', release: '放榜', review: '成績複查', confirm: '報到截止', giveup: '放棄截止', wait: '備取遞補', score: '成績單', open: '報名開始', other: '其他'};
// 報名這件事拆成幾個「部分」，每個部分在 regSteps 有一個勾（key 相同就是同一個勾）。
export const PART_NAME = {reg: '報名', pay: '繳費', docs: '繳件', letter: '推薦函', ticket: '印准考證', intent: '填寫遞補意願'};
const PART_ORDER = {reg: 0, pay: 1, docs: 2, letter: 3, ticket: 4, intent: 5};
const TYPE_ORDER = {do: 0, go: 1, check: 2, info: 3};
const REG_KINDS = new Set(['reg', 'pay', 'upload', 'letter']);
const DEADLINE_KINDS = new Set(['reg', 'pay', 'upload', 'letter', 'confirm', 'giveup', 'review']);
const ENDED = new Set(['rejected', 'out', 'skipped']);
export const PALETTE_SIZE = 10;
// 舊版自動產生的通用備審清單；整份都是這些、又沒勾過，就換成簡章的清單。
export const DEFAULT_DOCS = ['自傳／個人陳述', '讀書計畫', '特殊表現證明文件', '推薦信', '系所指定其他資料'];
const SEP = '｜'; // date row note = 標籤｜簡章附註（標籤本身可能有「・」）

/* ---------- 時間（一律當成臺灣牆上時間，不靠主機時區） ---------- */
const pad = n => String(n).padStart(2, '0');
const WD = '日一二三四五六';
export const isKey = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
const isTime = t => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t);
// now：'2026-11-02T02:30'（臺灣時間）、帶時區的 ISO 字串、Date，或已經解析好的 {date, time}。臺灣沒有日光節約，固定 +8。
export function clock(now) {
  if (now && typeof now === 'object' && !(now instanceof Date) && isKey(now.date)) return now;
  let s = now instanceof Date ? new Date(now.getTime() + 288e5).toISOString() : String(now ?? '');
  if (!(now instanceof Date) && /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s) && /T/.test(s)) s = new Date(Date.parse(s) + 288e5).toISOString();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (!m) throw new TypeError(`logic: bad now ${now}`);
  return {date: m[1], time: m[2] ? `${m[2]}:${m[3]}` : '00:00'};
}
const utc = k => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
export const addDays = (k, n) => new Date(utc(k) + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
export const weekday = k => WD[new Date(utc(k)).getUTCDay()];
export const md = k => `${k.slice(5, 7)}/${k.slice(8, 10)}`;
export const fmtDate = k => `${md(k)}（${weekday(k)}）`;
export const whenText = (date, time) => date ? fmtDate(date) + (time ? time : '') : '';
// 過了沒：沒有時間（或只看日期）的到當天結束才算過。
const passed = (date, time, c, dayEnd) => date < c.date || (date === c.date && !dayEnd && isTime(time) && time < c.time);
// 到了沒：沒有時間的從當天一開始就算到了。
const reached = (date, time, c) => date < c.date || (date === c.date && (!isTime(time) || time <= c.time));

export function dayLabel(date, now) {
  const c = clock(now), n = daysBetween(c.date, date);
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  if (n === 2) return '後天';
  if (n > 2 && n < 7) return `週${weekday(date)} ${md(date)}`;
  return fmtDate(date);
}
// 列上要顯示的時間：沒有時間就是空字串（學校頁才寫「時間未公布」）。
// 郵戳類：沒有鐘點的寫「郵戳 11/16」「今天郵戳」（到當天結束）；有鐘點的那個鐘點就是期限：「03/03 12:00 前郵戳」。
export function timeText(x, now) {
  if (!x || !x.date) return '';
  const c = clock(now);
  if (x.mail === 'postmark') return x.time ? `${x.date === c.date ? '今天' : md(x.date)} ${x.time} 前郵戳` : x.date === c.date ? '今天郵戳' : `郵戳 ${md(x.date)}`;
  if (x.mail === 'arrive') return `${md(x.date)}${x.time ? ' ' + x.time : ''} 前寄達`;
  return x.time || '';
}

/* ---------- 名稱 ---------- */
// 學校簡稱：大家平常的叫法，就是 search-terms 裡這間學校寫在最前面的那一個（北市大、中興、陽明交大）；
// 後面的（市北、興大、交大）只用來搜尋。沒有寫的就去掉「國立」「大學」。
export function shortSchool(name, aliases = {}) {
  name = String(name || '');
  if (!name) return '';
  const own = Object.keys(aliases || {}).find(a => aliases[a] === name);
  if (own) return own;
  const s = name.replace(/^(國立|私立|市立)/, '').replace(/大學$/, '');
  return s.length >= 2 ? s : name;
}
const DEPT_SHORT = [[/^資訊工程/, '資工'], [/^資訊管理/, '資管'], [/^資訊科學/, '資科'], [/^資訊傳播/, '資傳'], [/^電機工程/, '電機'], [/^電子工程/, '電子'], [/^醫學資訊/, '醫資'], [/^軟體工程/, '軟工'], [/^資訊安全/, '資安'], [/^電腦科學/, '電腦科學'], [/^人工智慧與資訊安全/, 'AI資安'], [/^數學/, '數學'], [/^應用數學/, '應數']];
// 「資安外加 資訊工程學系」→ 主系名「資訊工程學系」＋組別「資安外加」
export function splitDept(n) {
  const quals = [];
  let main = '';
  for (const tok of String(n || '').split(/\s+/).filter(Boolean)) {
    if (/(系|學程|學士班|學院|學群)/.test(tok) && tok.length > main.length) { if (main) quals.push(main); main = tok; } else quals.push(tok);
  }
  if (!main) main = String(n || '');
  const paren = /[(（]([^)）]+)[)）]$/.exec(main);
  if (paren) { quals.push(paren[1]); main = main.slice(0, paren.index); }
  const letter = /([A-Z甲乙丙丁]組)$/.exec(main);
  if (letter && main.length > letter[1].length + 2) { quals.unshift(letter[1]); main = main.slice(0, -letter[1].length); }
  return {main, quals: quals.filter(Boolean)};
}
export function shortDept(dept) {
  const {main, quals} = splitDept(dept);
  const hit = DEPT_SHORT.find(([re]) => re.test(main));
  // 「資訊工程學全英語學士班」不能也縮成「資工」（淡江兩個都有）：留下全英語／英語／國際。
  const m = hit ? hit[1] + ((/全英語|英語|國際/.exec(main) || [''])[0]) : main.replace(/(學士學位學程|學士班|學程|學系|系)$/, '') || main;
  // 一般組是預設，不寫；「資安外加組」寫成「資安外加」。
  const q = quals.filter(x => !/^一般(生)?(組)?$/.test(x)).map(x => x.replace(/外加組$/, '外加'));
  return [m, ...q].join('・');
}
// 畫面上的學校名字：簡稱；同一間學校加了兩個系組才在後面加系（「宜大 資工・資安組」「宜大 資工」），不然「同天：宜大、宜大」分不出來。
export function appName(app, apps = [], aliases = {}) {
  if (!app) return '';
  const s = shortSchool(app.school, aliases);
  return (apps || []).some(a => a && a.id !== app.id && shortSchool(a.school, aliases) === s) ? `${s} ${shortDept(app.dept || '')}`.trim() : s;
}
const nz = s => String(s || '').normalize('NFKC').replace(/\s+/g, '').replace(/…$/, '');
// 舊版 shortDoc（政大等已經是簡章名稱的清單，要用它比對才不會重複）
function shortDocV2(t) {
  t = String(t || '');
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
// 顯示寬度：中文 1、英數 0.5，空白不算
const width = s => [...String(s)].reduce((n, ch) => n + (/\s/.test(ch) ? 0 : ch.charCodeAt(0) < 0x2e80 ? 0.5 : 1), 0);
// 備審項目的短名稱（12 字寬內）：「自傳(含學習歷程描述…)」→「自傳」。完整文字另存在 full。
const DOC_WORD_END = /(資料|證明|文件|影本|正本|成果|成績單|成績|資格|紀錄|報告|作品|表現|能力|計畫|」)$/;
export function shortDoc(full) {
  // 簡章 PDF 抽出來的字有些是相容字（U+F9xx 的「力」「歷」），先換回一般字
  // 小型標點（﹙﹚﹐﹕﹔﹑，PDF 抽出來的）也換回一般的，下面的括號、逗號規則才切得到
  let t = String(full || '').replace(/[\uF900-\uFAFF\uFE50-\uFE6B]/g, c => c.normalize('NFKC')).replace(/^\s*(【[^】]*】|\[[^\]]*\]|[（(]?\d+[)）.、]|[一二三四五六七八九十]+、)\s*/, '').trim();
  t = t.replace(/[（(](選繳|必繳|非必繳|無則免[交繳]?|\s*\d+\s*[%％分]\s*)[)）]/g, '');
  // 在第一個括號、冒號、逗號前切；很短的括號（職）或緊接在短開頭後的括號（高中（或同等學力）…）整段拿掉再找
  let n = t;
  for (let from = 2, guard = 0; guard < 20; guard++) {
    const re = /[（(：:︰，,；;]/g; re.lastIndex = from;
    const m = re.exec(n);
    if (!m) break;
    if (/[（(]/.test(m[0])) {
      const close = n.slice(m.index + 1).search(/[）)]/);
      if (close >= 0 && (close <= 3 || m.index < 4)) { n = n.slice(0, m.index) + n.slice(m.index + close + 2); from = m.index; continue; }
    }
    n = n.slice(0, m.index); break;
  }
  n = n.replace(/^(現為|依|本系|本校)/, '').replace(/等$/, '').trim();
  const fit = s => s.replace(/\s+/g, ' ').trim();
  if (width(n) > 12) n = n.replace(/[（(][^）)]{1,3}[)）]/g, '');
  if (width(n) > 12) n = n.replace(/本系|本校|之/g, '');
  if (width(n) > 12) { const m = /^(.{4,12}?)(、|或|及|與|和|並|暨|\/)/.exec(n); if (m) n = m[1]; }
  // 還是太長：先切到 12 字寬，再往前退到最近一個完整的詞尾（資料、證明、影本…，最多退 4 字），不要停在詞的中間（「…資料影」）
  if (width(n) > 12) {
    let cut = n;
    while (width(cut) > 12) cut = cut.slice(0, -1);
    for (let k = cut.length; k >= 2 && width(cut) - width(cut.slice(0, k)) <= 4; k--) if (DOC_WORD_END.test(cut.slice(0, k).trimEnd())) { cut = cut.slice(0, k); break; }
    n = cut;
  }
  return fit(n) || fit(t).slice(0, 12);
}
const OPT_RE = /選繳|非必繳|無則免|非必要/;
const docRef = full => 'doc|' + nz(full).slice(0, 40);
export const rowLabel = d => { const n = String((d && d.note) || ''), i = n.indexOf(SEP); return (i >= 0 ? n.slice(0, i) : n).replace(/（(\d{4}\/)?\d{1,2}\/\d{1,2}( \d{2}:\d{2})? 起）$/, '').trim(); };
export const rowNote = d => { const n = String((d && d.note) || ''), i = n.indexOf(SEP); return i >= 0 ? n.slice(i + 1).trim() : ''; };
const withLabel = (d, label) => label + (rowNote(d) ? SEP + rowNote(d) : '');

/* ---------- 簡章旗標（programs.json，data/overrides.json 由 build 併進來；沒有就用預設） ---------- */
const SCR_FALSE_RE = /順序|准考證|應試號碼|試場|時間表/;
// 要自己印的東西（准考證、應考證明、應試號碼、列印甄試資格審核通知）是「要做」的事。只看列名、不看附註：
// 宜大的附註寫了「列印」，但它只是查准考證號碼。
const isTicketLabel = t => (/准考證|應考證|應試號碼/.test(t) && /列印|下載|印/.test(t)) || /(列印|下載).{0,10}通知/.test(t);
const ticketName = t => /通知/.test(t) && /列印|下載/.test(t) ? '印審核通知' : /應考證明/.test(t) ? '印應考證明' : /應考證/.test(t) ? '印應考證' : PART_NAME.ticket;
const INTENT_RE = /意願|登記|填寫|備取生報到/;
const WAITCHECK_RE = /開始遞補|遞補名單|遞補公告/;
// 名單列是不是篩選，一列一列看：列自己的 scr → 系組 scr:false（整個系組都不篩選）→ 列名（面試順序、准考證、時間表…不是篩選）。
// 成大（11/07 上機考試名單是篩選、11/11 准考證列印不是）、逢甲（11/30 複試名單是、12/01 面試時間表不是）兩種都有。
function scrOf(d, p) {
  if (typeof d.scr === 'boolean') return d.scr;
  if (p && p.scr === false) return false;
  return !SCR_FALSE_RE.test(rowLabel(d));
}
function mailOf(d, p) {
  if (d.mail) return d.mail;
  const ov = p && p.mail && typeof p.mail === 'object' ? (p.mail[d.ref] || p.mail[d.kind]) : '';
  if (ov) return ov;
  const t = String(d.note || '');
  if (/寄達|送達|到達/.test(t)) return 'arrive';
  if (/郵戳|郵寄|寄件|寄繳|掛號/.test(t) && !/上傳/.test(t)) return 'postmark';
  if (/親送/.test(t)) return 'arrive';
  return '';
}
const howOf = (p, kind) => (p && p.how && typeof p.how === 'object' && p.how[kind]) || '';
function roleOf(d, p) {
  const k = d.kind, t = rowLabel(d);
  if (REG_KINDS.has(k)) return 'reg';
  if (k === 'interview' || k === 'exam' || k === 'window') return 'go';
  if (k === 'release') return 'release';
  if (k === 'confirm') return 'confirm';
  if (k === 'giveup') return 'giveup';
  if (k === 'stage1') return scrOf(d, p) ? 'stage1' : isTicketLabel(t) ? 'ticket' : 'notice';
  if (isTicketLabel(t)) return 'ticket';
  if (k === 'wait') return INTENT_RE.test(t) ? 'intent' : WAITCHECK_RE.test(t) ? 'waitcheck' : 'info';
  return 'info';
}
// 遷移和同步配對用：同一種、而且一樣是篩選／不是篩選（名單）、一樣是意願／遞補公告（備取）的列才可能是同一列
function matchClass(kind, label, p) {
  if (kind === 'stage1') return 'stage1:' + (scrOf({note: label}, p) ? 's' : 'n');
  if (kind === 'wait') return 'wait:' + (INTENT_RE.test(label) ? 'i' : WAITCHECK_RE.test(label) ? 'c' : 'x');
  return kind;
}
const TYPE_OF = {reg: 'do', ticket: 'do', intent: 'do', confirm: 'do', giveup: 'do', go: 'go', stage1: 'check', notice: 'check', release: 'check', waitcheck: 'check', info: 'info'};
function displayLabel(role, d, hasIv) {
  const t = rowLabel(d);
  if (d.src === 'mine' && t) return t;
  switch (role) {
    case 'go': return t.replace(/(時間|日期|期間)$/, '').replace(/^二階$/, '二階甄試') || KIND_LABEL[d.kind];
    case 'release': return '放榜';
    case 'confirm': return '報到';
    case 'giveup': return '放棄期限';
    case 'stage1': { const m = /^(.+?)名單公[布佈]/.exec(t); return m ? `公布${m[1]}名單` : t.replace(/時間$/, '') || '名單'; }
    case 'notice': return /名單公[布佈]|^面試公布/.test(t) || !t ? `公布${hasIv ? '面試' : '考試'}順序・地點` : t;
    case 'ticket': return ticketName(t);
    case 'intent': return /備取生報到/.test(t) ? '備取報到' : t.replace(/^備取生/, '').replace(/(截止|期限|時間)+$/, '') || '遞補意願';
    case 'waitcheck': return t.replace(/時間$/, '') || '遞補公告';
    default: return t.replace(/（非放榜）/, '') || KIND_LABEL[d.kind] || '其他';
  }
}
// 報名這一列的標籤拆成部分：「網路報名、繳費及繳件」→ 報名・繳費・繳件
function partsOf(d, p, mail) {
  const k = d.kind, t = rowLabel(d) + ' ' + rowNote(d), keys = [];
  if (k === 'reg') keys.push('reg');
  if (k === 'pay' || /繳費/.test(t)) keys.push('pay');
  if (k === 'upload' || (k !== 'letter' && /繳件|上傳|郵寄|寄繳|繳交資料|親送/.test(t))) keys.push('docs');
  if (k === 'letter' || /推薦/.test(t)) keys.push('letter');
  return keys.map(key => {
    const docsMail = (key === 'docs' || key === 'letter') ? mail : '';
    const name = key === 'docs' ? (docsMail ? '郵寄備審' : /上傳/.test(t) ? '上傳備審' : '繳件') : PART_NAME[key];
    const opt = key === 'letter' && (OPT_RE.test(t) || OPT_RE.test(String((p && p.rl) || '')));
    // 郵戳為憑的部分：繳件列、推薦函列自己的鐘點就是郵戳期限（12:00 前郵戳）；報名列的鐘點是網路報名的，不是郵戳的
    const ownRow = (key === 'docs' && k === 'upload') || (key === 'letter' && k === 'letter');
    return {key, name, date: d.date, time: docsMail === 'postmark' && !ownRow ? '' : d.time || '', mail: docsMail, opt, rowId: d.id, kind: d.kind};
  });
}
const VAL = r => ({date: r.date || '', time: r.time || '', from: r.from || '', fromTime: r.fromTime || '', end: r.end || ''});
const sameVal = (a, b) => { const x = VAL(a || {}), y = VAL(b || {}); return x.date === y.date && x.time === y.time && x.from === y.from && x.fromTime === y.fromTime && x.end === y.end; };
export const isEdited = d => d.src === 'brochure' && !!d.bro && !sameVal(d, d.bro);

/* ---------- 每一個日期列 → 事件 ---------- */
// 簡章已經刪掉的列（gone）預設不算：不上接下來、行事曆、.ics、提醒，也不決定階段、撞期、必繳的部分。
// 學校頁「全部日期」和匯出要看到它們：傳 opts.gone = true。
export function eventsOf(app, program, opts = {}) {
  const p = program || null;
  const done = new Map();
  for (const s of app.regSteps || []) if (s && s.key) done.set(s.key, done.get(s.key) || !!s.done);
  const rows = (Array.isArray(app.dates) ? app.dates : []).filter(d => d && isKey(d.date) && (!d.gone || (opts && opts.gone)));
  const hasIv = rows.some(d => d.kind === 'interview') || !rows.some(d => d.kind === 'exam');
  // 自己記的面試時間（紀錄）蓋過簡章的；有面試列就套在面試，否則套在筆試。
  const ivKind = rows.some(d => d.kind === 'interview') ? 'interview' : 'exam';
  const out = [];
  for (const d of rows) {
    const role = roleOf(d, p), mail = mailOf(d, p);
    let time = isTime(d.time) ? d.time : '';
    if (role === 'go' && d.kind === ivKind && isTime(app.ivTime)) time = app.ivTime;
    let parts = [];
    if (role === 'reg') parts = partsOf(d, p, mail);
    // 印准考證、填遞補意願：一列一個勾；鐘點跟著這一列（北市大 12/11 16:00 意願截止，16:00 過了才算逾期）
    else if (role === 'ticket' || role === 'intent') parts = [{key: role, name: role === 'ticket' ? ticketName(rowLabel(d)) : displayLabel(role, d, hasIv), date: d.date, time, mail: '', opt: false, rowId: d.id, kind: d.kind}];
    for (const pt of parts) pt.done = !!done.get(pt.key);
    const label = role === 'reg' ? parts.map(x => x.name).join('・') : displayLabel(role, d, hasIv);
    const ev = {appId: app.id, rowId: d.id, rowIds: [d.id], kind: d.kind, role, type: TYPE_OF[role], date: d.date, time, from: isKey(d.from) ? d.from : '', fromTime: isTime(d.fromTime) ? d.fromTime : '', end: isKey(d.end) && d.end > d.date ? d.end : '',
      label, raw: rowLabel(d), note: rowNote(d), parts, mail: role === 'reg' ? (parts.length && parts.every(x => x.mail) ? parts[0].mail : '') : (DEADLINE_KINDS.has(d.kind) ? mail : ''),
      src: d.src || 'mine', ref: d.ref || '', edited: isEdited(d), upd: d.upd || '', gone: !!d.gone, brochureNow: d.brochureNow || null};
    if (role === 'stage1' || role === 'notice' || (role === 'ticket' && d.kind === 'stage1')) ev.scr = role === 'stage1';
    out.push(ev);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
}

/* ---------- 顯示用的階段與狀態字 ---------- */
const goPassed = (e, c) => (e.end || e.date) < c.date;
function stageOf(app, evs, c) {
  const s = app.status;
  if (ENDED.has(s) || app.giveupDone || app.choice === 'decline') return 'ended';
  if (s === 'admitted') return app.confirmDone ? 'held' : 'admitted';
  if (s === 'waitlist') return 'waitlist';
  if (s === 'prep' || !STATUS_LABEL[s]) return 'prep';
  const go = evs.filter(e => e.role === 'go');
  const allGoPast = go.length > 0 && go.every(e => goPassed(e, c));
  if (app.ivSkip && (allGoPast || s === 'waiting')) return 'ended';
  if (s === 'waiting') return 'waiting';
  // 有篩選的名單（不管回答了沒）：要回答「在名單上」才變待面試；沒回答、沒通過都不會因為准考證、時間表那一列就自己變。
  const screens = evs.some(e => e.role === 'stage1');
  if (allGoPast) return s === 'interview' || !screens ? 'waiting' : 'applied';
  if (s === 'interview') return 'interview';
  // 整個系組都沒有篩選：不篩選的「名單」（面試順序、准考證）一到，已報名就等於待面試。
  if (!screens && evs.some(e => e.scr === false && reached(e.date, e.time, c))) return 'interview';
  return 'applied';
}
export const displayStage = (app, program, now) => stageOf(app, eventsOf(app, program), clock(now));
export function statusWord(app, program, now) {
  const c = clock(now), evs = eventsOf(app, program), st = stageOf(app, evs, c);
  if (app.giveupDone) return '已放棄';
  if (app.status === 'admitted' && app.confirmDone) return '已報到';
  if (app.choice === 'decline' && !ENDED.has(app.status)) return '不去';
  if (st === 'ended' && app.ivSkip && !ENDED.has(app.status)) return '沒去面試';
  if (app.status === 'waitlist') return app.waitNo ? `備取 ${app.waitNo}` : '備取';
  if (st === 'interview') return '待面試';
  if (st === 'waiting') return '等放榜';
  return STATUS_LABEL[app.status] || STATUS_LABEL.prep;
}
const isHeld = a => a.status === 'admitted' && a.confirmDone && !a.giveupDone && a.choice !== 'decline';

/* ---------- 關聯：什麼時候、什麼狀態下這個事件要出現 ---------- */
function gsatOf(season) {
  const list = Array.isArray(season) ? season : (season && season.events) || [];
  return list.find(e => e && isKey(e.date) && (e.key === 'gsatScore' || /學測成績/.test(e.label || ''))) || null;
}
function appCtx(app, program, c, opts = {}) {
  const allEvs = eventsOf(app, program, {...opts, gone: true}), evs = allEvs.filter(e => !e.gone);
  const go = evs.filter(e => e.role === 'go');
  return {app, p: program || null, evs, allEvs, c, stage: stageOf(app, evs, c), goLast: go.length ? go.map(e => e.end || e.date).sort().pop() : '',
    mineConfirm: evs.some(e => e.role === 'confirm' && e.src === 'mine'), gsat: gsatOf(opts.season), seen: new Set(app.seen || [])};
}
// 有鐘點的部分到那個鐘點就過了（郵戳、寄達有鐘點的也是）；沒鐘點的到當天結束。
const partPassed = (pt, c) => passed(pt.date, pt.time, c, !pt.time);
const giveupFrom = (ev, gsat) => { const a = addDays(ev.date, -14); const b = gsat ? addDays(gsat.date, -7) : ''; return b > a ? b : a; };
function relevantIn(x, ev) {
  const {app, c, stage} = x;
  if (ev.gone) return false;
  switch (ev.role) {
    case 'reg': {
      const open = ev.parts.filter(pt => !pt.opt && !pt.done);
      if (stage === 'prep') return open.length > 0;
      if (stage === 'applied') return open.some(pt => !partPassed(pt, c));
      return false;
    }
    // 印准考證：到最後一個面試／考試日都還要；不去面試就不用印
    case 'ticket': return (stage === 'applied' || stage === 'interview') && !ev.parts[0].done && !app.ivSkip && (x.goLast ? x.goLast >= c.date : ev.date >= c.date);
    case 'go': return (stage === 'applied' || stage === 'interview') && !app.ivSkip && !goPassed(ev, c);
    case 'stage1': return stage === 'applied';
    case 'notice': return (stage === 'applied' || stage === 'interview') && ev.date >= c.date;
    case 'release': return (stage === 'applied' || stage === 'interview' || stage === 'waiting') && !app.ivSkip;
    case 'confirm': return stage === 'admitted' && (!x.mineConfirm || ev.src === 'mine');
    case 'giveup': return stage === 'held' && app.choice !== 'keep' && c.date >= giveupFrom(ev, x.gsat);
    case 'intent': return stage === 'waitlist' && !ev.parts[0].done;
    // 遞補公告：沒回答就留著（逾期，跟放榜一樣），遞補可能很晚才打來；下一次遞補公告到了就由那一列來問，不重複問。
    case 'waitcheck': return stage === 'waitlist' && !x.seen.has(ev.rowId) && !x.evs.some(e => e.role === 'waitcheck' && e.date > ev.date && reached(e.date, e.time, c));
    default: return false;
  }
}
export function relevant(app, ev, now, apps = [], program = null, opts = {}) {
  return relevantIn(appCtx(app, program, clock(now), opts), ev);
}

/* ---------- 學校的順序（學校清單、同時間的排序） ---------- */
const progIndex = programs => {
  if (!programs) return () => null;
  if (typeof programs === 'function') return programs;
  if (programs instanceof Map) return id => programs.get(id) || null;
  const m = new Map((Array.isArray(programs) ? programs : programs.programs || []).map(p => [p.i, p]));
  return id => m.get(id) || null;
};
const firstReg = a => (Array.isArray(a.dates) ? a.dates : []).filter(d => d && d.kind === 'reg' && !d.gone && isKey(d.date)).map(d => d.date + ' ' + (d.time || '24:00')).sort()[0] || '9999';
export function orderApps(apps, programs, now) {
  const c = clock(now), get = progIndex(programs);
  const sorted = [...apps].sort((x, y) => firstReg(x).localeCompare(firstReg(y)) || (x.createdAt || 0) - (y.createdAt || 0));
  const active = [], ended = [];
  for (const a of sorted) (displayStage(a, get(a.programId), c) === 'ended' ? ended : active).push(a);
  return {active, ended};
}

/* ---------- 撞期 ---------- */
export function clashes(apps, programs, now, opts = {}) {
  const c = clock(now), get = progIndex(programs), by = new Map();
  for (const a of apps) {
    const x = appCtx(a, get(a.programId), c, opts);
    if ((x.stage !== 'applied' && x.stage !== 'interview') || a.ivSkip) continue;
    for (const e of x.evs) if (e.role === 'go' && e.date >= c.date) { const s = by.get(e.date) || new Set(); s.add(a.id); by.set(e.date, s); }
  }
  const out = new Map();
  for (const [d, s] of [...by].sort()) if (s.size > 1) out.set(d, [...s]);
  return out;
}
// 一間學校的面試日和其他學校同一天（準備中的也算，只當成事實寫在學校頁和右欄）。
export function sameDay(app, apps, programs, now) {
  const c = clock(now), get = progIndex(programs);
  const mine = eventsOf(app, get(app.programId)).filter(e => e.role === 'go' && e.date >= c.date);
  if (!mine.length || app.ivSkip) return [];
  const others = [];
  for (const a of apps) {
    if (a.id === app.id || a.ivSkip) continue;
    const x = appCtx(a, get(a.programId), c);
    if (!['prep', 'applied', 'interview'].includes(x.stage)) continue;
    others.push([a, x.evs.filter(e => e.role === 'go')]);
  }
  return mine.map(e => ({date: e.date, label: e.label, rowId: e.rowId, with: others.filter(([, g]) => g.some(o => o.date === e.date)).map(([a]) => a.id)})).filter(x => x.with.length);
}
// 還在等結果的學校數（報到列上寫「其他 N 間還沒放榜」）
export function pendingResults(apps, programs, now, exceptId) {
  const c = clock(now), get = progIndex(programs);
  return apps.filter(a => a.id !== exceptId && ['applied', 'interview', 'waiting'].includes(displayStage(a, get(a.programId), c)));
}

/* ---------- 接下來 ---------- */
const GROUP = role => role === 'go' ? 'go' : role;
function linkFor(app, p, opts, which) {
  const code = p && (p.code || (opts.schools && opts.schools[p.s] && opts.schools[p.s].code));
  const L = (code && opts.links && opts.links[code]) || {};
  const site = /^https?:\/\//.test(app.url || '') ? app.url : /^https?:\/\//.test((p && p.u) || '') ? p.u : '';
  if (which === 'apply') return L.apply || L.adm || '';
  if (which === 'notice') return site || L.adm || '';
  return L.adm || L.apply || '';
}
function partOwn(pt, rowTime, c) {
  if (pt.mail) return timeText(pt, c);
  if (!pt.time) return rowTime ? '時間未公布' : '';
  return pt.time !== rowTime ? pt.time : '';
}
function buildRow(app, p, g, evs, x, opts, all) {
  const {c, stage} = x;
  const e0 = evs[0], short = a => appName(a, all.apps, opts.aliases);
  let date = e0.date;
  let parts = [];
  if (g === 'reg' || g === 'ticket' || g === 'intent') {
    const byKey = new Map();
    for (const e of evs) for (const pt of e.parts) {
      const cur = byKey.get(pt.key);
      // 同一天同一個部分出現兩次：用專門那一列（繳件列的時間比報名列的「及繳件」準）
      if (!cur || (pt.key === 'docs' && pt.kind === 'upload') || (pt.key === 'pay' && pt.kind === 'pay') || (pt.key === 'letter' && pt.kind === 'letter')) byKey.set(pt.key, {...pt});
    }
    parts = [...byKey.values()].sort((a, b) => PART_ORDER[a.key] - PART_ORDER[b.key]);
    // 已報名：報名的部分只留還沒到期的（印准考證、意願不在這裡篩）
    if (stage === 'applied' && g === 'reg') parts = parts.filter(pt => pt.done || !partPassed(pt, c));
  }
  // 印准考證：開放列印之後到考試那天都能印，是範圍型的「要做」：from = 開放列印，date = 最後一個面試／考試日（之前不算逾期）
  let ticketFrom = null;
  if (g === 'ticket' && x.goLast > date) {
    ticketFrom = {date, time: e0.time};
    date = x.goLast;
    for (const pt of parts) { pt.date = date; pt.time = ''; }
  }
  // 這列的時間跟著還沒勾的部分走：已勾的部分不決定這列的時間（勾完繳費，北市大就只剩「今天郵戳」）
  const base = parts.some(pt => !pt.done && !pt.opt) ? parts.filter(pt => !pt.done) : parts;
  let time = '', mail = '';
  if (parts.length) {
    time = base.filter(pt => !pt.mail && pt.time && !pt.opt).map(pt => pt.time).sort()[0] || base.filter(pt => !pt.mail && pt.time).map(pt => pt.time).sort()[0] || '';
    // 只剩郵寄的部分：這列寫「今天郵戳」；郵戳有鐘點的（12:00 前郵戳）鐘點就是這列的時間
    if (!time) { const mp = base.filter(pt => pt.mail && !pt.opt).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'))[0]; if (mp) { mail = mp.mail; time = mp.time || ''; } }
  } else {
    time = ticketFrom ? '' : evs.map(e => e.time).filter(Boolean).sort()[0] || '';
    mail = e0.mail;
  }
  // 列上已經寫了「今天郵戳」，那個部分就不再寫一次
  const rowTT = timeText({date, time, mail}, c);
  for (const pt of parts) { const own = partOwn(pt, time, c); pt.own = pt.mail && own === rowTT ? '' : own; if (pt.mail === 'arrive') pt.sendBy = addDays(pt.date, -3); }
  const from = ticketFrom ? `${ticketFrom.date} ${ticketFrom.time || ''}` : evs.map(e => e.from ? e.from + ' ' + (e.fromTime || '') : '').filter(Boolean).sort()[0] || '';
  const row = {key: `${app.id}|${e0.date}|${g}`, appId: app.id, date, time, sortKey: '', type: TYPE_OF[g] || e0.type, role: g, kind: e0.kind,
    label: g === 'reg' ? parts.map(pt => pt.name).join('・') : [...new Set(evs.map(e => e.label))].join('・'),
    parts, rowIds: evs.map(e => e.rowId), from: from.slice(0, 10), fromTime: from.slice(11), mail, actions: [], overdue: false,
    note: [...new Set(evs.map(e => e.note).filter(Boolean))].join('；'), edited: evs.some(e => e.edited), upd: evs.map(e => e.upd).find(Boolean) || ''};
  const A = row.actions, ask = (id, label, kind = 'quiet', more = {}) => A.push({id, label, kind, ...more});
  const link = (label, which) => { const href = linkFor(app, p, opts, which); if (href) A.push({id: 'link', label, kind: 'link', href}); };
  const deadlinePassed = passed(date, time, c, !time);
  // 寄達為憑：右欄提醒「最晚 3 天前寄出」
  if (mail === 'arrive') row.sendBy = addDays(date, -3);
  switch (g) {
    case 'reg': {
      const open = parts.filter(pt => !pt.opt && !pt.done);
      const sd = all.sameDay(app.id);
      if (sd.length) row.sameDay = sd;
      row.overdue = stage === 'prep' && open.some(pt => partPassed(pt, c));
      link(parts.some(pt => pt.key === 'reg' || pt.key === 'pay') ? '報名系統' : parts.some(pt => /上傳/.test(pt.name)) ? '上傳' : '報名系統', 'apply');
      if (row.overdue) { row.question = 'registered'; ask('registered', '有報名', 'primary'); ask('notRegistered', '沒報'); }
      break;
    }
    case 'ticket': row.overdue = date < c.date; link('報名系統', 'apply'); break; // date 已經是考試那天（見上面 ticketFrom）
    case 'intent': row.overdue = deadlinePassed; link('招生網', 'adm'); break;
    case 'go': {
      const cl = all.clashes.get(date);
      if (cl && cl.includes(app.id)) row.clash = cl.filter(id => id !== app.id);
      // 還要等名單（篩選）才確定的面試／考試：畫淡一點，右欄寫為什麼（「11/07 名單公布後才確定」）
      if (stage === 'applied' && x.evs.some(e => e.role === 'stage1')) {
        row.tentative = true;
        const s1 = x.evs.filter(e => e.role === 'stage1' && e.date <= date).pop();
        if (s1) row.context = `${md(s1.date)} 名單公布後才確定`;
      }
      ask('skipInterview', '不去');
      break;
    }
    case 'notice': link('公告', 'notice'); break;
    case 'stage1': {
      row.overdue = date < c.date;
      link('公告', 'notice');
      const go = x.evs.find(e => e.role === 'go' && e.date >= date);
      if (go) row.context = `通過的話 ${md(go.date)} ${go.label}`;
      if (reached(date, time, c)) { row.question = 'stage1'; ask('passed', '在名單上', 'primary'); ask('notPassed', '沒有'); }
      break;
    }
    case 'release': {
      row.overdue = date < c.date;
      link('公告', 'notice');
      if (reached(date, time, c)) {
        row.question = 'release';
        ask('admitted', '正取', 'primary'); ask('waitlisted', '備取', 'quiet', {ask: {type: 'number', label: '備取幾號', optional: true}}); ask('rejected', '未錄取');
      }
      break;
    }
    case 'waitcheck': {
      row.overdue = date < c.date;
      link('公告', 'notice');
      if (reached(date, time, c)) {
        row.question = 'promoted';
        ask('promoted', '遞補上了', 'primary', {ask: {type: 'datetime', label: '報到期限'}}); ask('notYet', '還沒', 'quiet', {payload: {rowIds: row.rowIds}});
      }
      break;
    }
    case 'confirm': {
      row.overdue = deadlinePassed;
      const notYet = row.from && !reached(row.from, row.fromTime, c);
      const dis = notYet ? {disabled: true} : {};
      const n = all.pending(app.id);
      if (n) row.context = `其他 ${n} 間還沒放榜`;
      const how = howOf(p, 'confirm');
      if (how) row.note = [row.note, how].filter(Boolean).join('；');
      const held = all.held && all.held.id !== app.id ? all.held : null;
      if (held) {
        const A2 = short(held), B = short(app);
        row.label = `要換到 ${B}，要先辦 ${A2} 的放棄`;
        row.question = 'swap';
        ask('swap', `換到 ${B}`, 'primary', {...dis, ask: {type: 'confirm', text: `${A2} 的放棄已經辦好了嗎？`, ok: '辦好了'}, also: [{appId: held.id, id: 'gaveUp'}]});
        ask('stay', `留在 ${A2}`);
      } else {
        row.question = 'confirm';
        ask('confirmed', '已報到', 'primary', dis); ask('decline', '不去');
      }
      link('招生網', 'adm');
      break;
    }
    case 'giveup': {
      row.overdue = deadlinePassed;
      row.label = `決定：留在 ${short(app)}，或放棄（改走申請入學）`;
      row.question = 'giveup';
      const how = howOf(p, 'giveup');
      if (how) row.note = [row.note, how].filter(Boolean).join('；');
      if (x.gsat) row.context = `${x.gsat.label || '學測成績'} ${md(x.gsat.date)}${x.gsat.tentative ? '（暫定）' : ''}`;
      ask('keep', '留下'); ask('gaveUp', '已放棄');
      link('招生網', 'adm');
      break;
    }
  }
  return row;
}
export function agenda(apps, programs, now, opts = {}) {
  const c = clock(now), get = progIndex(programs);
  const {active, ended} = orderApps(apps, get, c);
  const rank = new Map([...active, ...ended].map((a, i) => [a.id, i]));
  const ctxs = new Map(apps.map(a => [a.id, appCtx(a, get(a.programId), c, opts)]));
  const live = a => ['prep', 'applied', 'interview'].includes(ctxs.get(a.id).stage) && !a.ivSkip;
  const goDays = a => ctxs.get(a.id).evs.filter(e => e.role === 'go' && e.date >= c.date).map(e => e.date);
  const all = {apps, held: apps.find(isHeld) || null, clashes: clashes(apps, get, c, opts),
    pending: id => apps.filter(a => a.id !== id && ['applied', 'interview', 'waiting'].includes(ctxs.get(a.id).stage)).length,
    // 報名列的右欄：這間的面試和哪些學校同一天（準備中的也算，只是事實）
    sameDay: id => { const me = apps.find(a => a.id === id); if (!live(me)) return []; return [...new Set(goDays(me))].map(date => ({date, with: apps.filter(a => a.id !== id && live(a) && goDays(a).includes(date)).map(a => a.id)})).filter(x => x.with.length); }};
  const rows = [];
  for (const app of apps) {
    const x = ctxs.get(app.id), p = x.p;
    const keep = x.evs.filter(e => relevantIn(x, e));
    // 報名列：同一天有一部分要做，就把那天所有報名部分一起列出來（已勾的也看得到）
    const regDays = new Set(keep.filter(e => e.role === 'reg').map(e => e.date));
    const use = x.evs.filter(e => keep.includes(e) || (e.role === 'reg' && regDays.has(e.date)));
    const groups = new Map();
    for (const e of use) { const k = e.date + '|' + GROUP(e.role); (groups.get(k) || groups.set(k, []).get(k)).push(e); }
    for (const [k, evs] of groups) {
      const row = buildRow(app, p, k.split('|')[1], evs, x, opts, all);
      if (row.role === 'reg' && !row.parts.some(pt => !pt.opt && !pt.done)) continue;
      row.sortKey = `${row.date}T${row.time || '--:--'}|${String(rank.get(app.id)).padStart(3, '0')}|${TYPE_ORDER[row.type] ?? 9}`;
      rows.push(row);
    }
  }
  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const focalIndex = rows.findIndex(r => !r.overdue);
  // 清單空的時候，告訴使用者下一個日期是什麼
  let upcoming = null;
  if (!rows.length) for (const a of apps) for (const e of ctxs.get(a.id).evs) {
    const x = ctxs.get(a.id);
    if (x.stage === 'ended' || e.type === 'info' || e.date < c.date) continue;
    // 只挑到了那一天真的會出現的事（已經報到了，報到日就不算「下一個日期」）
    if (!relevantIn({...x, c: clock(`${e.date}T${e.time || '00:00'}`)}, e)) continue;
    if (!upcoming || e.date + e.time < upcoming.date + upcoming.time) upcoming = {date: e.date, time: e.time, appId: a.id, label: e.label};
  }
  return {rows, focalIndex, clashes: all.clashes, upcoming};
}
// 學校頁的「下一步」：接下來裡這間的第一列。傳 opts.apps 才看得到「已經在別間報到」。
export function nextStep(app, program, now, opts = {}) {
  const apps = opts.apps && opts.apps.some(a => a.id === app.id) ? opts.apps : [app];
  const programs = opts.programs || new Map([[app.programId, program]]);
  return agenda(apps, programs, now, opts).rows.find(r => r.appId === app.id) || null;
}

/* ---------- 學校頁 ---------- */
// 時程：每一個日期列，標出里程碑（報名→名單→面試→放榜→報到[→放棄]）、過去、下一個。
export function timeline(app, program, now, opts = {}) {
  const c = clock(now), x = appCtx(app, program, c, opts);
  const clash = opts.apps ? sameDay(app, opts.apps, opts.programs || new Map([[app.programId, program]]), c) : [];
  const ms = new Set(['reg', 'stage1', 'notice', 'ticket', 'go', 'release', 'confirm']);
  if (x.stage === 'held' || app.giveupDone) ms.add('giveup');
  if (x.stage === 'waitlist') { ms.add('intent'); ms.add('waitcheck'); }
  // 簡章已刪除的列（gone）不是里程碑：只在「全部 N 個日期」裡
  // done：這一列已經處理完（必繳的部分都勾了、准考證印了、意願填了、名單／放榜回答了、報到辦了、不去面試）。
  // 和過去的一樣算「後面」，不會是下一個；和接下來、下一步看到的一致。
  const st = app.status;
  const doneOf = e => e.parts.length ? e.parts.every(pt => pt.done || pt.opt)
    : e.role === 'go' ? !!app.ivSkip
    : e.role === 'stage1' ? !['prep', 'applied', 'skipped'].includes(st)
    : e.role === 'release' ? ['admitted', 'waitlist', 'rejected'].includes(st)
    : e.role === 'confirm' ? !!app.confirmDone
    : e.role === 'giveup' ? !!app.giveupDone || app.choice === 'keep'
    : false;
  const rows = x.allEvs.map(e => {
    const past = passed(e.date, e.time, c, !e.time || e.role === 'go');
    const cl = clash.find(k => k.rowId === e.rowId);
    return {...e, milestone: ms.has(e.role) && !e.gone, past, done: doneOf(e), clash: cl ? cl.with : undefined};
  });
  const next = rows.find(r => r.milestone && !r.past && !r.done);
  if (next) next.next = true;
  return rows;
}
// 備審：準備中（或已報名但還有繳件要做）顯示清單，送出之後只顯示一行摘要。
export function docsMode(app, program, now) {
  const c = clock(now), x = appCtx(app, program, c);
  if (x.stage === 'prep') return 'list';
  if (x.stage === 'applied' && x.evs.some(e => e.role === 'reg' && e.parts.some(pt => pt.key === 'docs' && !pt.done && !partPassed(pt, c)))) return 'list';
  return 'summary';
}
// 舊版自動寫進筆記的「甄選：書面審查 50%…」不算使用者寫的筆記（資料保留，只是不顯示）。
const AUTO_NOTE = /^甄選：.*\d+%.*$/;
export const userNotes = app => String(app.notes || '').split('\n').filter(l => !AUTO_NOTE.test(l.trim())).join('\n').trim();
// 紀錄：只列這個階段用得到的欄位。value 空的就由畫面決定要不要顯示。
export function recordFields(app, program, now) {
  const c = clock(now), x = appCtx(app, program, c);
  const after = x.stage !== 'prep';
  const go = x.evs.filter(e => e.role === 'go');
  const out = [];
  if (after) out.push({key: 'regNo', label: '准考證號', value: app.regNo || ''});
  if (after && go.length) out.push({key: 'ivTime', label: '面試時間', value: app.ivTime || ''}, {key: 'place', label: '面試地點', value: app.place || ''});
  if (go.length && go.some(e => goPassed(e, c)) && !app.ivSkip) out.push({key: 'asked', label: '面試被問了什麼', value: app.asked || ''});
  out.push({key: 'notes', label: '筆記', value: userNotes(app)});
  return out;
}

// ＋新增日期只填名稱：從名稱猜種類，面試、放榜、報到才會上接下來和行事曆。順序有關係（「面試名單公布」是名單，「已報到生放棄」是放棄，
// 「寄發成績單（非放榜）」是成績單）。列印、下載（准考證、審核通知）是 other，roleOf 再看列名當成印准考證。
const KIND_GUESS = [['giveup', /放棄/], ['wait', /遞補|備取/], ['score', /非放榜|成績單|成績查詢|查詢成績/], ['stage1', /(一階|第一階段|初審|初試).*(放榜|結果|通過)/],
  ['release', /放榜|錄取/], ['open', /報名開始|開始報名|開放報名/], ['review', /複查/], ['stage1', /名單|公告|公[布佈]/], ['confirm', /報到/], ['other', /列印|下載/],
  ['interview', /面試|面談|口試|甄試|二階/], ['exam', /筆試|考試|上機|實作|測驗|術科/], ['pay', /繳費/], ['letter', /推薦/], ['upload', /上傳|繳件|郵寄|寄件|寄送|寄繳|繳交|備審/], ['reg', /報名/]];
export const guessKind = label => (KIND_GUESS.find(([, re]) => re.test(String(label || ''))) || ['other'])[0];

/* ---------- 新增學校 ---------- */
const defaultUid = () => (globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID() : 'a' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
export function nextColor(apps = []) {
  const used = apps.map(a => Number.isInteger(a.color) ? ((a.color % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE : -1);
  for (let i = 0; i < PALETTE_SIZE; i++) if (!used.includes(i)) return i;
  return apps.length % PALETTE_SIZE;
}
const feeNumber = s => { const m = /\d[\d,]*/.exec(String(s ?? '')); return m ? Number(m[0].replace(/,/g, '')) : null; };
// 從簡章建一筆 v3 紀錄。ctx.nowMs（createdAt）由呼叫端傳，這裡不讀時鐘。
export function newApp(program, ctx = {}) {
  const uid = ctx.uid || defaultUid, p = program;
  const a = {id: uid(), school: p.school || '', dept: p.n || '', programId: p.i || '', status: 'prep', color: nextColor(ctx.apps), fee: feeNumber(p.fee), quota: p.q ?? null,
    url: /^https?:\/\//.test(p.u || '') ? p.u : '', dates: [], docs: [], regSteps: [], notes: '', place: '', prep: '', asked: '', choice: '', waitNo: null,
    confirmDone: false, giveupDone: false, createdAt: ctx.nowMs || 0, v: 3, rev: 0, hidden: []};
  a.dates = brochureRows(p).map(r => ({id: uid(), kind: r.kind, ...VAL(r), note: r.note, src: 'brochure', ref: r.ref, bro: VAL(r)}));
  a.docs = (p.docs || []).length ? p.docs.map(f => mkDoc(f, uid)) : DEFAULT_DOCS.filter(n => n !== '推薦信').map(n => ({id: uid(), name: n, done: false, src: 'placeholder'}));
  return a;
}
// 手動新增（簡章裡找不到的學校）：學校、系組、報名截止。
export function blankApp({school = '', dept = '', date = '', time = ''} = {}, ctx = {}) {
  const uid = ctx.uid || defaultUid;
  return {id: uid(), school, dept, programId: '', status: 'prep', color: nextColor(ctx.apps), fee: null, quota: null, url: '',
    dates: isKey(date) ? [{id: uid(), kind: 'reg', date, time: isTime(time) ? time : '', end: '', from: '', fromTime: '', note: '報名', src: 'mine', ref: ''}] : [],
    docs: DEFAULT_DOCS.filter(n => n !== '推薦信').map(n => ({id: uid(), name: n, done: false, src: 'placeholder'})), regSteps: [], notes: '', place: '', prep: '', asked: '',
    choice: '', waitNo: null, confirmDone: false, giveupDone: false, createdAt: ctx.nowMs || 0, v: 3, rev: 0, hidden: []};
}

/* ---------- 按鈕：每個動作都是純函式，回傳改好的副本（網頁的 mutate 用；409 時會重算一次） ---------- */
const clone = o => JSON.parse(JSON.stringify(o));
function requiredKeys(app, program) {
  const keys = new Set();
  for (const e of eventsOf(app, program)) if (e.role === 'reg') for (const pt of e.parts) if (!pt.opt) keys.add(pt.key);
  return keys;
}
// 有報名：只勾已經過了的部分；還沒到期的留著，已報名時照樣出現（§3.4 政大 繳件 17:00、高師大 上傳 11/10）。沒給 now 就全勾。
function registeredKeys(app, program, now) {
  const keys = requiredKeys(app, program);
  if (!now) return keys;
  const c = clock(now);
  for (const e of eventsOf(app, program)) if (e.role === 'reg') for (const pt of e.parts) if (!pt.opt && !partPassed(pt, c)) keys.delete(pt.key);
  return keys;
}
function partName(app, program, key) {
  for (const e of eventsOf(app, program)) for (const pt of e.parts) if (pt.key === key) return pt.name;
  return PART_NAME[key] || key;
}
function setStep(a, key, done, name, uid) {
  a.regSteps = Array.isArray(a.regSteps) ? a.regSteps : [];
  let s = a.regSteps.find(x => x && x.key === key);
  if (!s) a.regSteps.push(s = {id: uid(), key, name: name || PART_NAME[key] || key, done: false});
  s.done = !!done;
}
export const ACTIONS = ['tick', 'registered', 'notRegistered', 'passed', 'notPassed', 'admitted', 'waitlisted', 'rejected', 'confirmed', 'decline', 'swap', 'stay', 'keep', 'gaveUp', 'promoted', 'notYet',
  'skipInterview', 'attendInterview', 'setStatus', 'editDate', 'restoreDate', 'addDate', 'removeDate', 'unhide', 'tickDoc', 'addDoc', 'hideDoc', 'unhideDoc', 'editRecord', 'setColor', 'editInfo', 'setFee'];
export function applyAction(app, actionId, payload = {}, ctx = {}) {
  const a = clone(app), p = ctx.program || null, uid = ctx.uid || defaultUid;
  payload = payload || {};
  const row = id => id ? (a.dates || []).find(d => d.id === id) : undefined;
  const hide = ref => { if (ref) { a.hidden = Array.isArray(a.hidden) ? a.hidden : []; if (!a.hidden.includes(ref)) a.hidden.push(ref); } };
  switch (actionId) {
    case 'tick': {
      const cur = (a.regSteps || []).find(s => s && s.key === payload.key);
      const done = payload.done ?? !(cur && cur.done);
      setStep(a, payload.key, done, partName(a, p, payload.key), uid);
      // 必要的部分都勾了 → 已報名（畫面會給「復原」）
      if (done && a.status === 'prep') { const req = requiredKeys(a, p); if (req.size && [...req].every(k => a.regSteps.some(s => s.key === k && s.done))) a.status = 'applied'; }
      break;
    }
    case 'registered': for (const k of registeredKeys(a, p, ctx.now)) setStep(a, k, true, partName(a, p, k), uid); a.status = 'applied'; break;
    case 'notRegistered': a.status = 'skipped'; break;
    case 'passed': a.status = 'interview'; break;
    case 'notPassed': a.status = 'out'; break;
    case 'admitted': a.status = 'admitted'; break;
    case 'waitlisted': { a.status = 'waitlist'; const n = parseInt(payload.no, 10); a.waitNo = Number.isFinite(n) && n > 0 ? n : null; break; }
    case 'rejected': a.status = 'rejected'; break;
    case 'confirmed': case 'swap': a.status = 'admitted'; a.confirmDone = true; a.choice = ''; break;
    case 'decline': case 'stay': a.choice = 'decline'; break;
    case 'keep': a.choice = 'keep'; break;
    case 'gaveUp': a.giveupDone = true; break;
    case 'promoted': {
      a.status = 'admitted';
      // payload.id：網頁先給好 id，409 重做時已經有這一列就不再加（不會重複）
      if (isKey(payload.date) && !row(payload.id)) a.dates.push({id: payload.id || uid(), kind: 'confirm', date: payload.date, time: isTime(payload.time) ? payload.time : '', end: '', from: '', fromTime: '', note: '報到', src: 'mine', ref: ''});
      break;
    }
    case 'notYet': a.seen = [...new Set([...(a.seen || []), ...(payload.rowIds || [payload.rowId]).filter(Boolean)])]; break;
    case 'skipInterview': a.ivSkip = true; break;
    case 'attendInterview': a.ivSkip = false; break;
    case 'setStatus': {
      // 狀態選單（修正誤按）：已報到、已放棄、不去 也在裡面
      const s = payload.status;
      if (s === 'held') Object.assign(a, {status: 'admitted', confirmDone: true, giveupDone: false, choice: ''});
      else if (s === 'gaveup') Object.assign(a, {status: 'admitted', confirmDone: true, giveupDone: true});
      else if (s === 'declined') Object.assign(a, {choice: 'decline'});
      // 一般狀態也清掉「不去面試」：按錯的不去，復原提示不見之後還改得回來
      else if (STATUS_LABEL[s]) Object.assign(a, {status: s, confirmDone: false, giveupDone: false, choice: '', ivSkip: false});
      else throw new Error(`logic: unknown status ${s}`);
      break;
    }
    case 'editDate': {
      const d = row(payload.rowId);
      if (!d) break;
      for (const k of ['date', 'from', 'end']) if (payload[k] !== undefined) d[k] = isKey(payload[k]) ? payload[k] : '';
      for (const k of ['time', 'fromTime']) if (payload[k] !== undefined) d[k] = isTime(payload[k]) ? payload[k] : '';
      if (typeof payload.label === 'string' && payload.label.trim()) d.note = withLabel(d, payload.label.trim());
      break;
    }
    // 還原：拿回 bro（衝突時 bro 已經是簡章現在的值）。brochureNow 設 null 不是刪掉：伺服器的 carryOver 才不會把舊的補回來
    case 'restoreDate': { const d = row(payload.rowId); if (d && d.bro) { Object.assign(d, VAL(d.bro)); d.brochureNow = null; } break; }
    case 'addDate': {
      if (!isKey(payload.date) || row(payload.id)) break;
      a.dates.push({id: payload.id || uid(), kind: KIND_LABEL[payload.kind] ? payload.kind : guessKind(payload.label), date: payload.date, time: isTime(payload.time) ? payload.time : '', end: '', from: '', fromTime: '', note: String(payload.label || '').trim() || KIND_LABEL[payload.kind] || '其他', src: 'mine', ref: ''});
      break;
    }
    case 'removeDate': { const d = row(payload.rowId); if (!d) break; if (d.src === 'brochure') hide(d.ref); a.dates = a.dates.filter(x => x !== d); break; }
    case 'unhide': {
      a.hidden = (a.hidden || []).filter(r => r !== payload.ref);
      const r = p && brochureRows(p).find(r => r.ref === payload.ref);
      if (r && !a.dates.some(d => d.ref === r.ref)) a.dates.push({id: uid(), kind: r.kind, ...VAL(r), note: r.note, src: 'brochure', ref: r.ref, bro: VAL(r)});
      break;
    }
    case 'tickDoc': { const d = (a.docs || []).find(x => x.id === payload.docId); if (d) d.done = payload.done ?? !d.done; break; }
    case 'addDoc': { const n = String(payload.name || '').trim(); if (n && !(payload.id && (a.docs || []).some(d => d.id === payload.id))) (a.docs = a.docs || []).push({id: payload.id || uid(), name: n, done: false, src: 'mine'}); break; }
    case 'hideDoc': { const d = (a.docs || []).find(x => x.id === payload.docId); if (!d) break; if (d.src === 'brochure') hide(d.ref); a.docs = a.docs.filter(x => x !== d); break; }
    case 'unhideDoc': {
      a.hidden = (a.hidden || []).filter(r => r !== payload.ref);
      const full = p && (p.docs || []).find(f => docRef(f) === payload.ref);
      if (full && !(a.docs || []).some(d => d.ref === payload.ref)) (a.docs = a.docs || []).push(mkDoc(full, uid));
      break;
    }
    case 'editRecord': {
      for (const k of ['regNo', 'place', 'asked', 'prep']) if (typeof payload[k] === 'string') a[k] = payload[k];
      if (payload.ivTime !== undefined) a.ivTime = isTime(payload.ivTime) ? payload.ivTime : '';
      if (typeof payload.notes === 'string') {
        // 舊的自動「甄選：…」留在資料裡（不顯示），使用者只改自己的那部分
        const auto = String(a.notes || '').split('\n').filter(l => AUTO_NOTE.test(l.trim()));
        a.notes = [...auto, payload.notes.trim()].filter(Boolean).join('\n');
      }
      break;
    }
    case 'setColor': { const n = Number(payload.color); if (Number.isInteger(n)) a.color = ((n % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE; break; }
    case 'editInfo': {
      for (const k of ['school', 'dept']) if (typeof payload[k] === 'string' && payload[k].trim()) a[k] = payload[k].trim();
      if (typeof payload.url === 'string') a.url = /^https?:\/\//.test(payload.url.trim()) ? payload.url.trim() : '';
      if (payload.fee !== undefined) a.fee = feeNumber(payload.fee);
      break;
    }
    // 花費裡改自動的報名費（減免就改成 0）、「沒繳」藏起來
    case 'setFee': {
      if (payload.fee !== undefined) { const n = parseAmount(payload.fee); if (n !== null) a.fee = n; }
      if (payload.hidden !== undefined) { if (payload.hidden) a.feeHidden = true; else delete a.feeHidden; }
      break;
    }
    default: throw new Error(`logic: unknown action ${actionId}`);
  }
  return a;
}

/* ---------- 遷移與簡章同步（伺服器端用；純函式、可重複執行） ---------- */
// 範圍型的「要做」（報名、報到、意願…）存成：date/time = 截止，from/fromTime = 開始；活動型的存 date + end。
const DO_RANGE = (kind, label) => DEADLINE_KINDS.has(kind) || (kind === 'wait' && /意願|登記|填寫|備取生報到/.test(label));
export function brochureRows(p) {
  const seen = new Map();
  return ((p && p.ev) || []).map(([kind, sd, ed, st, et, name, note]) => {
    let ref = `${kind}|${nz(name)}`;
    const n = (seen.get(ref) || 0) + 1; seen.set(ref, n); if (n > 1) ref += `#${n}`;
    const note2 = String(name || '') + (note ? SEP + note : '');
    return DO_RANGE(kind, name || '') && ed
      ? {kind, ref, date: ed, time: et || '', from: sd, fromTime: st || '', end: '', note: note2}
      : {kind, ref, date: sd, time: st || '', from: '', fromTime: '', end: ed || '', note: note2};
  }).filter(r => isKey(r.date));
}
// 日期列的 note = 標籤｜簡章附註：標籤和 ref 的列名一樣（沒自己改名）就整個跟簡章；改過名就留自己的標籤，附註還是跟簡章
const noteFrom = (d, ref, r) => nz(rowLabel(d)) === ref.slice(ref.indexOf('|') + 1).replace(/#\d+$/, '') ? r.note : withLabel(r, String(d.note || '').split(SEP)[0]);
// v2 從簡章帶進來的列名（特殊選才網的固定說法）。自己加的列（「面試」「作品集面談」、空白）不會剛好是這些。
const V2_BROCHURE_NAME = /^(網路報名.*|繳費.*|繳件.*|.*(上傳|郵寄|寄繳|寄件|親送|繳交).*(資料|時間|截止|期限).*|推薦函.*|.*名單公[布佈]|(面試|筆試|術科|二階)(時間|日期)|.*複查.*|.*成績.*(公告|公布|查詢|寄發).*|錄取放榜|放榜時間|正取生.*|備取生.*|開始遞補.*|已報到生.*|准考證.*|.*（非放榜）)$/;
// v2 把意願、登記這類範圍存成 date=開始、end=結束：轉成 v3（date/time=截止、from/fromTime=開始；v2 沒存截止的鐘點，有簡章列就用簡章的）
function v2Range(d, r) {
  const range = !DEADLINE_KINDS.has(d.kind) && DO_RANGE(d.kind, rowLabel(d)) && isKey(d.end) && d.end > d.date;
  if (range) Object.assign(d, {from: d.date, fromTime: d.time || '', date: d.end, time: r && r.from ? r.time : '', end: ''});
  else Object.assign(d, {from: d.from || '', fromTime: d.fromTime || ''});
}
const PLACEHOLDER = n => DEFAULT_DOCS.includes(n) || /^推薦信（.*）$/.test(n) || /^作品集(（.*）)?$/.test(n);
const mkDoc = (full, uid) => ({id: uid(), name: shortDoc(full), full, done: false, src: 'brochure', ref: docRef(full), ...(OPT_RE.test(full) ? {opt: true} : {})});
const docMatches = (name, full) => { const n = nz(name), f = nz(full); return n === nz(shortDocV2(full)) || n === nz(shortDoc(full)) || (n.length >= 4 && f.startsWith(n)); };
function stepKey(name) {
  if (/推薦/.test(name)) return 'letter';
  if (/繳費/.test(name)) return 'pay';
  if (/網路報名|^報名/.test(name)) return 'reg';
  if (/備審|上傳|繳件|郵寄|資料/.test(name)) return 'docs';
  return '';
}
// v2 → v3（per app：沒有 v:3 的就跑，所以匯入的、舊分頁寫回來的都會自己修好）。回傳新物件；已經是 v3 就原樣回傳。
export function migrateApp(app, program, idx = 0, opts = {}) {
  if (app.v === 3) return app;
  const a = clone(app), p = program || null, uid = opts.uid || defaultUid;
  if (!Number.isInteger(a.color)) a.color = ((idx % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  a.dates = Array.isArray(a.dates) ? a.dates.filter(d => d && typeof d === 'object') : [];
  const rows = p ? brochureRows(p) : [];
  const taken = new Set(a.dates.filter(d => d.src && d.ref).map(d => d.ref));
  const labelOf = d => rowLabel(d).replace(/・.*$/, '');
  // v2 的截止類存截止日；意願、登記這類範圍存 date=開始、end=結束
  const dueOf = d => DO_RANGE(d.kind, labelOf(d)) && d.end ? d.end : d.date;
  // 同一種、而且一樣是篩選／不是篩選的列才配（逢甲舊的「面試名單公布 12/01 14:00」不能配到同時間的「公告面試時間表」）
  const free = d => rows.filter(r => !taken.has(r.ref) && r.kind === d.kind && matchClass(r.kind, rowLabel(r), p) === matchClass(d.kind, labelOf(d), p));
  const old = a.dates.filter(d => !d.src), pairs = [];
  const pair = (d, r) => { taken.add(r.ref); pairs.push([d, r]); };
  const open = () => old.filter(d => !pairs.some(([x]) => x === d));
  // 一輪一種比法，全部的列比完才換下一種，前面比較寬的比法才不會搶走後面列名完全一樣的
  const MATCHERS = [
    (d, c) => c.find(r => r.ref.replace(/#\d+$/, '') === `${d.kind}|${nz(labelOf(d))}`),
    (d, c) => c.find(r => r.ref.startsWith(`${d.kind}|${nz(labelOf(d))}`)),
    (d, c) => c.find(r => r.date === dueOf(d) && r.time === (d.time || '')),
    // 同一天只有一列同種的：列名、鐘點都不看（成大舊的「筆試時間 11/14」就是現在的「上機考試 11/14 09:00」）
    (d, c) => { const s = c.filter(r => r.date === dueOf(d)); return s.length === 1 ? s[0] : null; },
  ];
  for (const m of MATCHERS) for (const d of open()) { const r = m(d, free(d)); if (r) pair(d, r); }
  // 標籤和日期都被新簡章改了（逢甲一階改名又改日）：同一類只剩一列對一列，就當成同一列（之後同步會更新它），不要變成兩列
  const nLeft = {}, cls = d => matchClass(d.kind, labelOf(d), p);
  for (const d of open()) nLeft[cls(d)] = (nLeft[cls(d)] || 0) + 1;
  for (const d of open()) { const cand = free(d); if (cand.length === 1 && nLeft[cls(d)] === 1) pair(d, cand[0]); }
  const left = open();
  // 配不到的：看起來是從簡章帶進來的（特殊選才網的固定列名），就是新簡章刪掉的列（成大 推薦函截止、北市大 初試成績複查），
  // 原樣留著標 gone（只在學校頁「全部日期」）；其他的是自己加的列。簡章怪怪的（配不到四成以上）就都當成自己的，不藏。
  const trust = rows.length > 0 && left.length <= old.length * 0.4;
  for (const d of left) {
    v2Range(d);
    const ref = `${d.kind}|${nz(labelOf(d))}`;
    if (trust && V2_BROCHURE_NAME.test(labelOf(d))) Object.assign(d, {src: 'brochure', ref: taken.has(ref) ? '' : ref, gone: true, bro: VAL(d)});
    else Object.assign(d, {src: 'mine', ref: d.ref || ''});
  }
  for (const [d, r] of pairs) {
    // v2 的 programDates() 會怎麼存這一列（截止類把範圍收成截止日；意願這類範圍存 date=開始、end=結束）
    const v2 = DEADLINE_KINDS.has(r.kind) ? {date: r.date, time: r.time, end: r.from ? '' : r.end} : r.from ? {date: r.from, time: r.fromTime, end: r.date} : {date: r.date, time: r.time, end: r.end};
    if (v2.date === d.date && v2.time === (d.time || '') && v2.end === (d.end || '')) Object.assign(d, VAL(r), {note: r.note, src: 'brochure', ref: r.ref, bro: VAL(r)});
    // 舊資料和簡章不同（舊的簡章或自己改過）：base 用它現在的值，同步時簡章有變就更新並記在 syncLog。
    // 列名、附註跟現在的簡章（v2 的附註是舊版自動寫的；之前第一次同步也會蓋掉）
    else { v2Range(d, r); Object.assign(d, {note: r.note, src: 'brochure', ref: r.ref}); d.bro = VAL(d); }
  }
  const docs = Array.isArray(a.docs) ? a.docs : [];
  const want = (p && p.docs) || [];
  if (docs.length && docs.every(d => !d.src && PLACEHOLDER(d.name)) && !docs.some(d => d.done)) {
    a.docs = want.length ? want.map(f => mkDoc(f, uid)) : docs.map(d => ({...d, src: 'placeholder'}));
  } else {
    const used = new Set(docs.filter(d => d.ref).map(d => d.ref));
    a.docs = docs.map(d => {
      if (d.src) return d;
      const hit = want.find(f => !used.has(docRef(f)) && docMatches(d.name, f));
      if (!hit) return {...d, src: 'mine'};
      used.add(docRef(hit));
      return {...d, name: shortDoc(hit), full: hit, src: 'brochure', ref: docRef(hit), ...(OPT_RE.test(hit) ? {opt: true} : {})};
    });
  }
  // 報名步驟加上 key（北市大的「網路報名完成 ✓」→ reg，「備審上傳完成…」→ docs）；名字不動
  if (Array.isArray(a.regSteps)) {
    const used = new Set(a.regSteps.map(s => s && s.key).filter(Boolean));
    for (const s of a.regSteps) if (s && !s.key) { const k = stepKey(s.name || ''); s.key = k && !used.has(k) ? k : 'x-' + (s.id || used.size); used.add(s.key); }
  }
  a.hidden = Array.isArray(a.hidden) ? a.hidden : [];
  a.rev = (Number(a.rev) || 0) + 1;
  a.v = 3;
  return a;
}
const changeText = d => d.date ? md(d.date) + (d.end ? '–' + md(d.end) : '') + (d.time ? ' ' + d.time : '') : '';
// 只有開始時間變了（截止一樣）：兩邊都寫「起」，才看得出改了什麼
const fullText = d => (d.from ? `${md(d.from)}${d.fromTime ? ' ' + d.fromTime : ''} 起，` : '') + changeText(d);
const changePair = (d, r) => changeText(d) === changeText(r) ? [fullText(d), fullText(r)] : [changeText(d), changeText(r)];
// syncLog 的「什麼」：報名截止、一階名單…；不是篩選的名單（面試時間表、准考證列印）寫它自己的列名
const whatOf = (r, p) => r.kind === 'stage1' && !scrOf(r, p) ? (rowLabel(r) || '名單') : ['reg', 'pay', 'upload', 'letter', 'stage1', 'release', 'confirm', 'giveup', 'interview'].includes(r.kind) ? KIND_LABEL[r.kind] : (rowLabel(r) || KIND_LABEL[r.kind] || '日期');
// 簡章更新的提示（一則）只寫最要緊的那一項：報名、繳費、繳件、推薦函的期限提早了（提早最多的）→ 報到、放棄的期限提早了
// → 其他要做的事 → 面試、名單、放榜 → 簡章刪掉的列 → 其他（複查、成績…）→ 備審；同一級的取 syncLog 裡的第一項。
// 其他的改動在學校頁那幾列寫「簡章更新」。舊的 syncLog 沒有 kind：從「報名截止」這類名稱反查。
const SYNC_DO = new Set(['reg', 'pay', 'upload', 'letter', 'confirm', 'giveup']), SYNC_KEY = new Set(['interview', 'exam', 'window', 'stage1', 'release']);
// 「11/18 23:59」「2026-11-18T23:59」→ 可以比大小的分鐘數；沒有鐘點算到當天結束；1–7 月是隔年。「11/10 09:00 起，11/18」看截止那一段。
function changeMinutes(v) {
  const t = String(v ?? '').replace(/\d{4}-(\d\d)-(\d\d)(?:T(\d\d:\d\d))?/g, (_, m, d, h) => `${m}/${d}${h ? ' ' + h : ''}`).replace(/^.*起，/, '');
  const m = /^(\d\d)\/(\d\d)(?:–\d\d\/\d\d)?(?: (\d\d):(\d\d))?/.exec(t);
  if (!m) return null;
  const mo = +m[1] < 8 ? +m[1] + 12 : +m[1];
  return (mo * 31 + +m[2]) * 1440 + (m[3] ? +m[3] * 60 + +m[4] : 1440);
}
export function syncHeadline(changes) {
  const rank = c => {
    const k = c.kind || Object.keys(KIND_LABEL).find(x => KIND_LABEL[x] === c.what) || '';
    if (c.doc) return [6, 0];
    if (SYNC_DO.has(k)) { const a = changeMinutes(c.from), b = changeMinutes(c.to); return a != null && b != null && b < a ? [REG_KINDS.has(k) ? 0 : 1, b - a] : [2, 0]; }
    if (SYNC_KEY.has(k)) return [3, 0];
    return c.removed || c.gone ? [4, 0] : [5, 0];
  };
  let best = null, br = null;
  for (const c of changes || []) { const r = rank(c); if (!best || r[0] < br[0] || (r[0] === br[0] && r[1] < br[1])) { best = c; br = r; } }
  return best;
}
// 簡章同步：每一列和它上次同步的簡章值（bro）三方比較。回傳 {app, changes, skipped}。
export function syncApp(app, program, now, opts = {}) {
  const p = program || null, uid = opts.uid || defaultUid, tag = opts.syncId || '';
  if (!p || app.v !== 3) return {app, changes: [], skipped: p ? 'not migrated' : 'no program'};
  const rows = brochureRows(p);
  const mineCount = (app.dates || []).filter(d => d && d.src === 'brochure' && !d.gone).length;
  if (rows.length === 0 || rows.length < mineCount * 0.6) return {app, changes: [], skipped: `brochure has ${rows.length} rows, app has ${mineCount}`};
  const a = clone(app), ch = [], hidden = new Set(a.hidden || []);
  a.dates = (Array.isArray(a.dates) ? a.dates : []).filter(d => d && typeof d === 'object');
  let quiet = false; // 只有備審短名稱、附註、列名之類的變動：要寫回，但不必通知
  const log = (what, from, to, more = {}) => ch.push({appId: a.id, school: a.school, what, from, to, ...more});
  const refs = new Set(rows.map(r => r.ref));
  // 列名改了（overrides 改標籤）ref 就跟著變：同一類的「消失的舊列／刪掉的 tombstone」和「新出現的列」一對一配起來
  // （先配值沒變的，再配同一類只剩一對一的，同 migrateApp），當成同一列改名；不然改過的列會多一列、刪掉的會回來。
  const labelOfRef = ref => ref.slice(ref.indexOf('|') + 1).replace(/#\d+$/, '');
  const kindOf = ref => ref.slice(0, ref.indexOf('|'));
  const clsOf = (kind, label) => matchClass(kind, label, p);
  const fresh = rows.filter(r => !hidden.has(r.ref) && !a.dates.some(d => d.ref === r.ref));
  const lost = () => a.dates.filter(d => d.src === 'brochure' && !d.gone && d.ref && !refs.has(d.ref));
  const take = r => { fresh.splice(fresh.indexOf(r), 1); quiet = true; return r.ref; };
  const fits = (r, kind, label) => r.kind === kind && clsOf(r.kind, rowLabel(r)) === clsOf(kind, label);
  for (const d of lost()) { const c = fresh.filter(r => fits(r, d.kind, labelOfRef(d.ref)) && sameVal(r, d.bro)); if (c.length === 1) { d.note = noteFrom(d, d.ref, c[0]); d.ref = take(c[0]); } }
  const dead = [...hidden].filter(h => !h.startsWith('doc|') && h.includes('|') && !refs.has(h));
  const clsOfRef = ref => clsOf(kindOf(ref), labelOfRef(ref));
  for (const k of new Set([...lost().map(d => clsOfRef(d.ref)), ...dead.map(clsOfRef)])) {
    const ld = lost().filter(d => clsOfRef(d.ref) === k), lh = dead.filter(h => clsOfRef(h) === k);
    const c = fresh.filter(r => clsOf(r.kind, rowLabel(r)) === k);
    if (ld.length + lh.length !== 1 || c.length !== 1) continue;
    if (ld.length) { ld[0].note = noteFrom(ld[0], ld[0].ref, c[0]); ld[0].ref = take(c[0]); } else hidden.add(take(c[0]));
  }
  // 簡章已經沒有的列的 tombstone 不留（配到的已換成新 ref），免得之後新加的同種列被它吃掉
  if (dead.length) { a.hidden = [...hidden].filter(h => h.startsWith('doc|') || refs.has(h)); quiet = true; }
  for (const r of rows) {
    if (hidden.has(r.ref)) continue;
    const d = a.dates.find(x => x.ref === r.ref);
    if (!d) { a.dates.push({id: uid(), kind: r.kind, ...VAL(r), note: r.note, src: 'brochure', ref: r.ref, bro: VAL(r), ...(tag ? {upd: tag} : {})}); log(whatOf(r, p), '', changeText(r), {added: true, kind: r.kind}); continue; }
    if (d.gone) { delete d.gone; quiet = true; } // 簡章又有這一列了
    // 只改附註（北市大「限時掛號，郵戳為憑」）或列名：寫回，不通知；自己改過名的留自己的列名
    const note = noteFrom(d, d.ref, r);
    if (nz(note) !== nz(d.note)) { d.note = note; quiet = true; }
    if (sameVal(d.bro, r)) continue;
    // 自己改的剛好就是簡章的新值：直接當成同步了，不算衝突
    if (sameVal(d, r)) { d.bro = VAL(r); delete d.brochureNow; quiet = true; continue; }
    if (sameVal(d, d.bro)) { log(whatOf(r, p), ...changePair(d, r), {kind: r.kind}); Object.assign(d, VAL(r), {bro: VAL(r)}); delete d.brochureNow; if (tag) d.upd = tag; }
    // 衝突：留自己的值；基準換成簡章的新值，所以「還原」回到簡章現在的值，同一份簡章再同步也不會再報一次
    else { d.brochureNow = VAL(r); d.bro = VAL(r); log(whatOf(r, p), ...changePair(d, r), {conflict: true, kind: r.kind}); }
  }
  a.dates = a.dates.filter(d => {
    // 已經標 gone 的（自己改過、或遷移時新簡章就沒有的）原樣留著
    if (d.src !== 'brochure' || refs.has(d.ref) || d.gone) return true;
    if (sameVal(d, d.bro)) { log(whatOf(d, p), changeText(d), '', {removed: true, kind: d.kind}); return false; }
    d.gone = true; log(whatOf(d, p), changeText(d), '', {gone: true, kind: d.kind});
    return true;
  });
  // 備審：照簡章順序重建；勾過的依 ref → 短名稱 → 前綴帶過去；沒勾、沒改的舊項目拿掉；勾過但簡章沒了的留著標 gone
  const want = p.docs || [];
  if (want.length) {
    const next = [], used = new Set(), docs = a.docs || [];
    for (const full of want) {
      const ref = docRef(full);
      if (hidden.has(ref)) continue;
      const old = docs.find(d => !used.has(d.id) && d.src === 'brochure' && (d.ref === ref || nz(d.name) === nz(shortDoc(full)) || (nz(d.name).length >= 4 && nz(shortDoc(full)).startsWith(nz(d.name)))));
      if (old) {
        used.add(old.id);
        const nd = {...old, full, ref, name: shortDoc(full)};
        if (OPT_RE.test(full)) nd.opt = true; else delete nd.opt;
        delete nd.gone;
        next.push(nd);
      } else { next.push(mkDoc(full, uid)); log('備審', '', shortDoc(full), {doc: true}); }
    }
    for (const d of docs) {
      if (used.has(d.id)) continue;
      if ((d.src === 'brochure' || d.src === 'placeholder') && !d.done) { log('備審', d.name, '', {doc: true}); continue; }
      next.push(d.src === 'brochure' ? {...d, gone: true} : d);
    }
    if (JSON.stringify(next) !== JSON.stringify(docs)) { a.docs = next; quiet = true; }
  }
  if (!ch.length && !quiet) return {app, changes: [], skipped: ''};
  a.rev = (Number(a.rev) || 0) + 1;
  return {app: a, changes: ch, skipped: ''};
}

/* ---------- 花費（DESIGN §12）：自己記的每一筆，加上每間報了名的學校自動一筆報名費 ---------- */
export const CATS = ['reg', 'travel', 'stay', 'mail', 'print', 'other'];
export const CAT_LABEL = {reg: '報名費', travel: '交通', stay: '住宿', mail: '郵寄', print: '影印・證件', other: '其他'};
export const AMOUNT_MAX = 1000000;
export const WHAT_MAX = 60;
const EXP_ID = /^[A-Za-z0-9_.~:@+-]{1,120}$/;
// 報名之後的狀態都繳過報名費了（沒錄取也一樣）；沒有報名的沒有
const FEE_PAID = new Set(['applied', 'interview', 'waiting', 'admitted', 'waitlist', 'rejected', 'out']);
// 順序有關係：「計程車去郵局」是交通，「寄宿」是住宿
const CAT_GUESS = [['reg', /報名費/], ['travel', /高鐵|台鐵|臺鐵|火車|自強號|區間車|客運|公車|計程車|uber|捷運|機票|飛機|船票|油錢|加油|停車|車資|車票/i],
  ['stay', /住宿|寄宿|飯店|旅館|旅店|民宿|青旅|hotel/i], ['mail', /郵|掛號|快遞|宅配|寄/], ['print', /影印|列印|照片|證件|大頭照|護貝|裝訂/]];
export const guessCat = what => (CAT_GUESS.find(([, re]) => re.test(String(what || ''))) || ['other'])[0];
const realDay = k => isKey(k) && new Date(utc(k)).toISOString().slice(0, 10) === k;
// 金額：整數元，0 到 1,000,000。「1,490」「1490 元」「NT$1490」「１４９０」都看得懂；看不懂（含空白）是 null
export function parseAmount(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= AMOUNT_MAX ? v : null;
  const s = String(v ?? '').normalize('NFKC').trim().replace(/^(NT\$|NTD|\$)\s*/i, '').replace(/\s*元$/, '').replace(/[,\s]/g, '');
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = Number(s);
  return n <= AMOUNT_MAX ? n : null;
}
// 伺服器存之前、匯入時用：只留認得的欄位；不對的回 {error}（伺服器回 400）
export function checkExpense(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return {error: '格式不正確'};
  const id = String(e.id ?? '');
  if (!EXP_ID.test(id)) return {error: 'id 格式不正確'};
  if (!realDay(e.date)) return {error: '日期要寫成 2026-11-06'};
  const amount = parseAmount(e.amount);
  if (amount === null) return {error: '金額要是 0 到 1,000,000 的整數'};
  if (e.what != null && typeof e.what !== 'string') return {error: '項目要是文字'};
  let what = String(e.what ?? '').trim();
  if ([...what].length > WHAT_MAX) return {error: `項目最多 ${WHAT_MAX} 個字`};
  const cat = e.cat == null || e.cat === '' ? guessCat(what) : e.cat;
  if (!CAT_LABEL[cat]) return {error: '類別不對'};
  // 沒寫項目（API、匯入的檔案）就用類別當項目：表單一定要有項目，空著的那一行會改不了，也不能因此丟掉金額
  if (!what) what = CAT_LABEL[cat];
  const appId = e.appId == null ? '' : String(e.appId);
  if (appId && !EXP_ID.test(appId)) return {error: '學校的 id 格式不正確'};
  const school = typeof e.school === 'string' ? [...e.school.trim()].slice(0, 40).join('') : '';
  const rev = Number.isInteger(e.rev) && e.rev > 0 ? e.rev : 0, createdAt = Number.isFinite(Number(e.createdAt)) && Number(e.createdAt) > 0 ? Number(e.createdAt) : 0;
  return {entry: {id, date: e.date, amount, what, cat, appId, school, rev, createdAt}};
}
const dayOf = v => { try { return v ? clock(typeof v === 'number' ? new Date(v) : v).date : ''; } catch { return ''; } };
// 一間學校的報名費（自動的那一筆）：報名之後的狀態，或準備中但已經勾了繳費。沒有報名、按了「沒繳」的沒有。
// 金額是 app.fee（簡章的報名費；改這一筆就是改它）；日期是繳費（沒有就報名）的截止日，都沒有就用最後一次改紀錄的那天。
export function feeLine(app, program) {
  if (!app || app.feeHidden) return null;
  const st = STATUS_LABEL[app.status] ? app.status : 'prep';
  const payTicked = (app.regSteps || []).some(s => s && s.key === 'pay' && s.done);
  if (!FEE_PAID.has(st) && !(st === 'prep' && payTicked)) return null;
  const parts = eventsOf(app, program).filter(e => e.role === 'reg').flatMap(e => e.parts);
  const at = parts.find(pt => pt.key === 'pay') || parts.find(pt => pt.key === 'reg') || parts[0];
  const amount = parseAmount(app.fee);
  return {id: 'fee:' + app.id, date: at ? at.date : dayOf(app.updatedAt) || dayOf(Number(app.createdAt)), amount: amount ?? 0, what: CAT_LABEL.reg, cat: 'reg', appId: app.id, school: '', derived: true, createdAt: Number(app.createdAt) || 0, ...(amount === null ? {unknown: true} : {})};
}
// 花費的每一行（自動的報名費＋自己記的），新的在上面：日期、再來是記下的時間。學校名用現在的簡稱；學校刪掉了就用記下時的名字。
export function expenseLines(apps = [], expenses = [], programs = null, opts = {}) {
  const get = progIndex(programs), aliases = opts.aliases || {}, list = (apps || []).filter(a => a && typeof a === 'object'), byId = new Map(list.map(a => [a.id, a]));
  const out = [];
  for (const a of list) { const f = feeLine(a, get(a.programId)); if (f) out.push({...f, school: appName(a, list, aliases)}); }
  for (const e of expenses || []) {
    if (!e || typeof e !== 'object') continue;
    const a = e.appId ? byId.get(e.appId) : null;
    out.push({id: String(e.id ?? ''), date: isKey(e.date) ? e.date : '', amount: parseAmount(e.amount) ?? 0, what: String(e.what ?? ''), cat: CAT_LABEL[e.cat] ? e.cat : 'other',
      appId: String(e.appId || ''), school: a ? appName(a, list, aliases) : String(e.school || ''), derived: false, createdAt: Number(e.createdAt) || 0, rev: Number(e.rev) || 0});
  }
  return out.sort((x, y) => y.date.localeCompare(x.date) || y.createdAt - x.createdAt || x.id.localeCompare(y.id));
}
// 合計、依類別（六類都有，0 的由畫面決定要不要寫）、依學校（多的在前；沒有指定學校的放最後）
export function expenseTotals(lines = []) {
  const byCat = Object.fromEntries(CATS.map(k => [k, 0])), by = new Map();
  let total = 0;
  for (const l of lines || []) {
    const n = Number(l.amount) || 0;
    total += n;
    byCat[CAT_LABEL[l.cat] ? l.cat : 'other'] += n;
    const k = l.appId || (l.school ? '~' + l.school : '');
    if (!by.has(k)) by.set(k, {appId: l.appId || '', school: l.school || '', amount: 0});
    by.get(k).amount += n;
  }
  const none = s => !s.appId && !s.school;
  const bySchool = [...by.values()].sort((a, b) => none(a) - none(b) || b.amount - a.amount || a.school.localeCompare(b.school));
  return {total, byCat, bySchool};
}
// 記一筆時預設的學校：那天前後一天內有面試／考試或郵寄的那一間（最近的；一樣近時面試優先）。
// 繳費不算：報名費是自動的，繳費截止那天記的多半跟那間無關。一樣近、一樣是面試的有兩間（同一天面試）就不猜。
export function guessSchool(apps = [], programs = null, date = '') {
  if (!isKey(date)) return '';
  const get = progIndex(programs), RANK = {go: 0, mail: 1};
  let best = null, tie = false;
  for (const a of apps || []) {
    if (!a || a.status === 'skipped') continue;
    for (const e of eventsOf(a, get(a.programId))) {
      const hits = e.role === 'go' && !a.ivSkip ? [['go', e.date, e.end || e.date]] : [];
      for (const pt of e.parts) if (pt.mail) hits.push(['mail', pt.date, pt.date]);
      for (const [type, from, to] of hits) {
        const d = date < from ? daysBetween(date, from) : date > to ? daysBetween(to, date) : 0;
        if (d > 1) continue;
        const score = d * 10 + RANK[type];
        if (!best || score < best.score) { best = {score, id: a.id}; tie = false; } else if (score === best.score && best.id !== a.id) tie = true;
      }
    }
  }
  return best && !tie ? best.id : '';
}
