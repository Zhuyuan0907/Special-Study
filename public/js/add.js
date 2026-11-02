// ＋ 加學校（#dlg-add）：一個搜尋框（學校、簡稱、系名、同義詞、簡章全文），左邊結果，右邊選到的系組（programDetail）。
// 加入就直接建一筆 v3 紀錄（logic.newApp：簡章的日期與備審），提示「已加入 中教大 資工　打開」。
// 找不到的學校：底下「手動新增」，三個欄位（學校、系組、報名截止）。
import {S, P, $, esc, now, request, onChange, addApp, deptName, shortName, colourOf, composing, debounce, COND_BY_ID, ls} from './core.js';
import {openDialog, md, feeText as fee, methodText} from './ui.js';
import {go} from './router.js';
import * as L from './logic.js';

const REGION = {北: '北部', 中: '中部', 南: '南部', 東: '東部・離島'};
const PAGE = 60;
// q：搜尋字；res：伺服器的結果（res.q 是哪一次的）；sel：右邊顯示的系組；limit：左邊先畫幾個
const A = {q: '', region: '', open: false, match: false, res: null, busy: false, err: '', sel: '', keep: false, limit: PAGE, qualOpen: '', detail: false, manual: false, draft: {school: '', dept: '', date: ''}, mErr: ''};
const dlg = () => $('#dlg-add');

/* ---------- 簡章資料的小工具 ---------- */
const norm = s => String(s || '').replace(/台/g, '臺').replace(/\s+/g, '').toLowerCase();
const pdfOf = (p, page) => p && P.pdf.has(p.code) ? `/data/brochures/pdf/${p.code}.pdf${page ? '#page=' + page : ''}` : '';
const pgLink = (p, page, label) => { const u = page ? pdfOf(p, page) : ''; return u ? `<a class="pg" href="${esc(u)}" target="_blank" rel="noopener">${esc(label || 'p.' + page)}</a>` : ''; };
const extLink = (u, label) => /^https?:\/\//.test(u || '') ? `<a class="link ext" href="${esc(u)}" target="_blank" rel="noopener">${esc(label)}</a>` : '';
const schoolShort = p => L.shortSchool(p.school, P.aliases);
const mine = pid => S.apps.find(a => a.programId === pid) || null;
// 報名截止：簡章的 reg 列（有起訖就是訖），沒有時間的到當天結束才算截止。
const regCache = new Map();
function regOf(p) {
  if (regCache.has(p.i)) return regCache.get(p.i);
  const e = (p.ev || []).find(x => x[0] === 'reg');
  const r = e && L.isKey(e[2] || e[1]) ? {date: e[2] || e[1], time: (e[2] ? e[4] : e[3]) || '', from: e[2] ? e[1] : ''} : null;
  regCache.set(p.i, r);
  return r;
}
function closed(p, c) {
  const r = regOf(p);
  return !!r && (r.date < c.date || (r.date === c.date && /^\d{2}:\d{2}$/.test(r.time) && r.time < c.time));
}
// 我的條件：報名資格等文字提到勾選的經歷（設定 › 我的條件）
const condCache = new Map();
function matchedConds(p) {
  const tags = (S.profile.tags || []).map(id => COND_BY_ID.get(id)).filter(Boolean);
  if (!tags.length) return [];
  if (!condCache.has(p.i)) condCache.set(p.i, norm([p.qx, p.tgt, p.deb, p.deo, p.nt, p.pr].filter(Boolean).join(' ')));
  const t = condCache.get(p.i);
  return tags.filter(c => c.kw.some(k => t.includes(norm(k))));
}
// 同校限報：mx 是數字（1、2、3）或文字（overrides 可以寫「一般組、資安組擇一」）；無限制、X 不算。
function limitOf(p) {
  const m = String(p.mx ?? '').trim();
  if (!m || m === 'X' || m === '無限制') return null;
  const n = /^\d+$/.test(m) ? Number(m) : 0;
  return {n, text: n ? `同校限報 ${n} 系` : `同校限報：${m}`};
}
const feeText = f => { const t = fee(f); return t ? `報名費 ${t}` : ''; };
const snip = s => s ? `${esc(s.before)}<mark>${esc(s.match)}</mark>${esc(s.after)}` : '';
function rlText(p) {
  const rl = String(p.rl || '');
  if (!rl || rl === 'N') return '';
  const how = rl[0] === '明' ? '明推' : rl[0] === '暗' ? '暗推' : '';
  return `${/選繳|非必繳/.test(rl) ? '選繳' : '要'}${how ? `（${how}）` : ''}${L.isKey(p.rld) ? `，${md(p.rld)} 前` : ''}`;
}
function itemsHtml(p) {
  const its = (p.it || []).filter(i => i && i[0]);
  if (!its.length) return '';
  if (!its.some(i => i[2] || i[3])) return esc(methodText(p));
  return its.map(([n, w, st, desc]) => `<div>${esc(n)}${w != null ? ` ${w}%` : ''}${st ? `<span class="muted">（${esc(st)}）</span>` : ''}${desc ? ` <span class="muted">${esc(desc)}</span>` : ''}</div>`).join('');
}
function docsHtml(p) {
  const docs = (p.docs || []).filter(Boolean);
  if (!docs.length) return '<span class="muted">簡章資料沒有列出</span>';
  return `<ol class="pd-docs">${docs.map(full => {
    const short = L.shortDoc(full);
    const rest = full.startsWith(short) ? full.slice(short.length).replace(/^[\s：:，,、]+/, '') : full;
    return `<li><span>${esc(short)}</span>${rest && rest !== short ? ` <span class="muted">${esc(rest)}</span>` : ''}</li>`;
  }).join('')}</ol>`;
}
// 時程：用 logic 對一筆暫時的紀錄算（和學校頁同一套標籤：報名・繳費・繳件、公布面試名單、面試、放榜、報到）
function milestones(p) {
  let n = 0;
  const tmp = L.newApp(p, {apps: [], uid: () => 'pd' + (n++), nowMs: 0});
  try { return L.timeline(tmp, p, now(), {}).filter(r => r.milestone); } catch (e) { console.error(e); return []; }
}

/* ---------- 一個系組的簡章重點（右邊；學校頁要的話也可以用） ---------- */
// programDetail(p, {hit, add:true})：hit 是搜尋結果（有 page、snippet 就顯示那段原文）；add:false 不畫加入鈕。
export function programDetail(p, {hit = null, add = true, qualOpen = false} = {}) {
  if (!p) return '';
  const c = L.clock(now()), m = mine(p.i), lim = limitOf(p), links = P.links[p.code] || {};
  const same = S.apps.filter(a => a.school === p.school && a.programId !== p.i && a.status !== 'skipped');
  const warn = lim && same.length && (!lim.n || same.length >= lim.n) ? `${lim.text}，已加入 ${same.map(deptName).join('、')}` : '';
  const facts = [REGION[p.region], p.q != null && `名額 ${p.q}`, feeText(p.fee), !warn && lim && lim.text].filter(Boolean);
  const act = !add ? '' : m
    ? `<span class="muted">已加入</span><a class="link" href="#schools/${esc(m.id)}">打開 ${esc(shortName(m))} →</a>`
    : `<button class="btn lg" type="button" data-add="${esc(p.i)}">加入我的學校</button>`;
  const ms = milestones(p);
  const qual = String(p.qx || p.tgt || '').trim();
  // 報名資格先給前 4 行（最多約 160 字），其餘按「展開」
  const qLines = qual.split('\n').filter(s => s.trim());
  let qShort = qLines, qCut = false;
  if (!qualOpen) {
    qShort = [];
    for (const l of qLines) {
      const used = qShort.join('').length;
      if (qShort.length >= 4 || used >= 160) { qCut = true; break; }
      if (used + l.length > 180) { qShort.push(l.slice(0, Math.max(40, 160 - used)) + '…'); qCut = true; break; }
      qShort.push(l);
    }
  }
  const rl = rlText(p);
  const rows = [
    ['甄選方式', itemsHtml(p), ''],
    ['備審', docsHtml(p), ''],
    rl && ['推薦函', esc(rl), ''],
    p.pf === 'Y' && ['作品集', `要${L.isKey(p.pfd) ? `，${md(p.pfd)} 前` : ''}`, ''],
    qual && ['報名資格', `<div class="pd-qual">${qShort.map(s => `<div>${esc(s)}</div>`).join('')}</div>${qCut || qualOpen ? `<button class="link" type="button" data-qual="${esc(p.i)}">${qualOpen ? '收起' : '展開'}</button>` : ''}`, pgLink(p, p.qxp)],
  ].filter(r => r && r[1]);
  return `<article class="pd" data-pd="${esc(p.i)}">
    <header class="pd-head">
      <div class="pd-title"><h3>${esc(p.school)}</h3><div class="pd-dept">${esc(p.n)}</div></div>
      ${act ? `<div class="pd-act">${act}</div>` : ''}
    </header>
    <p class="pd-facts">${facts.map(esc).join('・')}</p>
    <p class="pd-links">${[pgLink(p, (p.pg || [])[0], (p.pg || [])[0] ? `簡章 p.${p.pg[0]}` : '') || (pdfOf(p) ? `<a class="pg" href="${esc(pdfOf(p))}" target="_blank" rel="noopener">簡章</a>` : ''), extLink(links.apply, '報名系統'), extLink(links.adm, '招生網'), extLink(p.u, '系網')].filter(Boolean).join('')}</p>
    ${warn ? `<p class="pd-warn">${esc(warn)}</p>` : ''}
    ${hit && hit.snippet ? `<p class="pd-hit ref">${pgLink(p, hit.page)} ${snip(hit.snippet)}</p>` : ''}
    ${ms.length ? `<section class="pd-sec"><div class="col-h">時程</div><div class="pd-tl">${ms.map(r => {
      const t = L.timeText(r, c), day = L.dayLabel(r.date, c);
      return `<div class="pd-tr${r.past ? ' past' : ''}"><span class="when${day === '今天' ? ' hot' : ''}">${esc(day)}</span><span class="pd-time">${esc(t)}</span><span class="pd-what">${esc(r.label)}${r.from && r.from < r.date ? ` <span class="muted">${esc(md(r.from))} 起</span>` : ''}${r.end ? ` <span class="muted">到 ${esc(md(r.end))}</span>` : ''}</span></div>`;
    }).join('')}</div></section>` : ''}
    <section class="pd-sec pd-facts-sec">${rows.map(([k, v, pgl]) => `<div class="grid-row pd-kv"><span class="pd-k">${k}</span><div class="pd-v">${v}</div><span class="pd-pg">${pgl}</span></div>`).join('')}</section>
  </article>`;
}

/* ---------- 結果 ---------- */
function results() {
  const c = L.clock(now()), q = A.q.trim();
  let list;
  if (q) {
    // 新的結果還沒回來時先留著上一次的，打字時不會一直閃「搜尋中…」
    if (!A.res || A.res.error) return {list: [], general: [], c, pending: !A.res};
    list = A.res.programs.map((r, i) => ({p: P.byId.get(r.id), hit: r, rank: i})).filter(x => x.p);
  } else list = P.programs.map((p, i) => ({p, hit: null, rank: i}));
  list = list.filter(x => (!A.region || x.p.region === A.region) && (!A.open || !closed(x.p, c)) && (!A.match || matchedConds(x.p).length));
  for (const x of list) { x.closed = closed(x.p, c); x.reg = regOf(x.p); }
  // 截止的放最後；有搜尋字就照相關程度，再照截止日；沒有就照截止日
  list.sort((a, b) => (a.closed - b.closed) || (q ? (b.hit.score - a.hit.score) : 0) || (a.reg ? 0 : 1) - (b.reg ? 0 : 1) || (a.reg && b.reg ? a.reg.date.localeCompare(b.reg.date) || (a.reg.time || '').localeCompare(b.reg.time || '') : 0) || a.p.s - b.p.s || a.rank - b.rank);
  const general = q && !A.match && A.res && Array.isArray(A.res.general) ? A.res.general.filter(g => !A.region || (P.schools.find(s => s.code === g.code) || {}).region === A.region).slice(0, 10) : [];
  return {list, general, c};
}
function deadlineText(x, c) {
  const r = x.reg;
  if (!r) return '';
  if (x.closed) return `已截止 ${md(r.date)}`;
  if (r.from && r.from > c.date) return `${md(r.from)} 開始報名，${L.fmtDate(r.date)} 截止`;
  const day = L.dayLabel(r.date, c);
  return `報名截止 <span class="when${day === '今天' ? ' hot' : ''}">${esc(day)}${r.time ? ' ' + esc(r.time) : ''}</span>`;
}
function rowHtml(x, c, sel) {
  const p = x.p, m = mine(p.i), conds = A.match ? matchedConds(p) : [];
  const hue = m ? ` style="--hue:var(--c${colourOf(m)})"` : '';
  return `<div class="add-row${sel ? ' tint' : ''}${x.closed ? ' closed' : ''}" role="option" aria-selected="${sel}" data-pid="${esc(p.i)}" id="add-opt-${esc(p.i)}">
    <div class="add-row-main">
      <div class="l1"><span class="sch"${hue}>${esc(schoolShort(p))}</span><span class="dept">${esc(p.n)}</span></div>
      <div class="l2">${esc(p.school)}${x.reg ? `・${deadlineText(x, c)}` : ''}${conds.length ? `・符合 ${esc(conds.map(k => k.label.split('（')[0]).join('、'))}` : ''}</div>
      ${x.hit && x.hit.snippet ? `<div class="l3">${pgLink(p, x.hit.page)} ${snip(x.hit.snippet)}</div>` : ''}
    </div>
    <div class="add-row-act">${m ? '<span class="muted">已加入</span>' : `<button class="btn sm" type="button" data-add="${esc(p.i)}">加入</button>`}</div>
  </div>`;
}
function renderList(R) {
  const box = $('#add-list');
  if (!box) return;
  const top = box.scrollTop, q = A.q.trim();
  let html = '';
  if (R.pending) html = '<p class="add-empty muted">搜尋中…</p>';
  else if (A.res && A.res.error && q) html = `<p class="add-empty form-err">${esc(A.res.error)}</p>`;
  else if (!R.list.length && A.busy) html = '<p class="add-empty muted">搜尋中…</p>';
  else if (!R.list.length) html = `<p class="add-empty">${q ? `找不到「${esc(q)}」。` : '沒有符合的系組。'}<button class="link" type="button" data-manual>手動新增</button></p>`;
  else {
    const shown = R.list.slice(0, A.limit);
    html = shown.map(x => rowHtml(x, R.c, x.p.i === A.sel)).join('');
    if (R.list.length > shown.length) html += `<div class="add-more"><button class="btn sm" type="button" data-more>再顯示 ${Math.min(PAGE, R.list.length - shown.length)} 個（還有 ${R.list.length - shown.length}）</button></div>`;
  }
  if (R.general.length && !R.pending) html += `<div class="add-gen"><div class="col-h">簡章其他頁面</div>${R.general.map(g => {
    const u = P.pdf.has(g.code) ? `/data/brochures/pdf/${g.code}.pdf#page=${g.page}` : '';
    return `<p class="ref"><span class="add-gen-s">${esc(L.shortSchool(g.school, P.aliases))}</span> ${u ? `<a class="pg" href="${esc(u)}" target="_blank" rel="noopener">p.${g.page}</a>` : `p.${g.page}`} ${snip(g.snippet)}</p>`;
  }).join('')}</div>`;
  box.innerHTML = html;
  box.scrollTop = top;
  const cnt = $('#add-count');
  if (cnt) cnt.textContent = R.pending || !R.list.length ? '' : `${R.list.length} 個系組・還能報名 ${R.list.filter(x => !x.closed).length}`;
}
function renderDetail(R) {
  const box = $('#add-detail');
  if (!box) return;
  const x = R.list.find(y => y.p.i === A.sel);
  const p = x ? x.p : P.byId.get(A.sel);
  if (!p || R.pending) { box.innerHTML = ''; return; }
  box.innerHTML = `<button class="link add-back" type="button" data-back>‹ 結果</button>${programDetail(p, {hit: x && x.hit, qualOpen: A.qualOpen === p.i})}`;
}
function renderFoot() {
  const f = $('#add-foot');
  if (!f) return;
  const fetched = P.fetched ? `簡章資料 ${md(P.fetched)} 更新` : '';
  if (!A.manual) { f.innerHTML = `<span>${esc(fetched)}</span><button class="link push" type="button" data-manual>手動新增</button>`; return; }
  const d = A.draft;
  f.innerHTML = `<form class="add-manual" data-manual-form novalidate autocomplete="off">
    <input type="text" name="school" value="${esc(d.school)}" placeholder="學校" aria-label="學校">
    <input type="text" name="dept" value="${esc(d.dept)}" placeholder="系組" aria-label="系組">
    <label class="add-manual-d"><span>報名截止</span><input type="date" name="date" value="${esc(d.date)}" aria-label="報名截止"></label>
    <button class="btn sm" type="submit">加入</button><button class="btn sm quiet" type="button" data-manual-cancel>取消</button>
    ${A.mErr ? `<span class="form-err">${esc(A.mErr)}</span>` : ''}
  </form>`;
}
// 只重畫結果、右邊、底下（搜尋框不動，打字不會被打斷）
function renderBody() {
  if (!$('#add-root')) return;
  const R = results();
  if (!R.pending && R.list.length && !R.list.some(x => x.p.i === A.sel)) {
    if (A.keep && P.byId.get(A.sel)) { /* 從學校頁指定的系組：結果裡沒有也照樣顯示 */ }
    else A.sel = R.list[0].p.i;
  }
  if (!R.pending && !R.list.length && !A.keep) A.sel = '';
  const i = R.list.findIndex(x => x.p.i === A.sel);
  if (i >= A.limit) A.limit = Math.ceil((i + 1) / PAGE) * PAGE;
  renderList(R);
  renderDetail(R);
  $('#add-root').classList.toggle('show-detail', A.detail && !!A.sel);
  const q = $('#add-q');
  if (q) q.setAttribute('aria-activedescendant', A.sel ? 'add-opt-' + A.sel : '');
}
function renderShell() {
  const tags = (S.profile.tags || []).filter(id => COND_BY_ID.has(id));
  if (!tags.length) A.match = false;
  $('#add-title').textContent = '加學校';
  $('#add-body').innerHTML = `<div class="add" id="add-root">
    <div class="add-top">
      <input type="search" id="add-q" value="${esc(A.q)}" placeholder="學校、系、簡章裡的字（AIS3、APCS…）" aria-label="搜尋學校、系組或簡章" autocomplete="off" role="combobox" aria-controls="add-list" aria-expanded="true">
      <div class="add-filters">
        <select id="add-region" aria-label="地區"><option value="">全部地區</option>${Object.entries(REGION).map(([k, v]) => `<option value="${k}"${A.region === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <label class="check"><input type="checkbox" id="add-open"${A.open ? ' checked' : ''}><span>還能報名</span></label>
        ${tags.length ? `<label class="check"><input type="checkbox" id="add-match"${A.match ? ' checked' : ''}><span>符合我的條件</span></label>` : ''}
        <span class="add-count" id="add-count"></span>
      </div>
    </div>
    <div class="add-main">
      <div class="add-list scroll" id="add-list" role="listbox" aria-label="系組"></div>
      <div class="add-detail scroll" id="add-detail"></div>
    </div>
    <div class="modal-foot add-foot" id="add-foot"></div>
  </div>`;
  renderFoot();
  renderBody();
}

/* ---------- 搜尋 ---------- */
let seq = 0;
async function search() {
  const q = A.q.trim(), my = ++seq;
  A.limit = PAGE;
  if (!q) { A.busy = false; renderBody(); scrollTop(); return; }
  if (A.res && A.res.q === q && !A.res.error) { renderBody(); return; }
  A.busy = true; renderBody();
  let res;
  try { res = await request('GET', '/api/search?q=' + encodeURIComponent(q)); res = {...res, q}; }
  catch (e) { res = {q, error: e.status === 0 ? '連不到伺服器' : '搜尋失敗：' + e.message, programs: [], general: []}; }
  if (my !== seq) return;
  A.res = res; A.busy = false;
  renderBody(); scrollTop();
}
const searchSoon = debounce(search, 160);
const scrollTop = () => { const b = $('#add-list'); if (b) b.scrollTop = 0; };
function setQuery(v) {
  A.q = v; A.keep = false; A.detail = false;
  searchSoon();
}

/* ---------- 加入 ---------- */
function addProgram(pid) {
  const p = P.byId.get(pid);
  if (!p) return;
  const ex = mine(pid);
  if (ex) { dlg().close(); go({view: 'schools', id: ex.id}); return; }
  const app = L.newApp(p, {apps: S.apps, nowMs: Date.now()});
  A.sel = pid;
  addApp(app, {toast: `已加入 ${shortName(app)} ${deptName(app)}`, action: {label: '打開', fn: () => { if (dlg().open) dlg().close(); go({view: 'schools', id: app.id}); }}});
  // 按下的「加入」變成「已加入」，焦點回到搜尋框（鍵盤可以接著找下一個）
  if (!dlg().contains(document.activeElement) || document.activeElement === document.body) { const q = $('#add-q'); if (q) q.focus({preventScroll: true}); }
}
function addManual(form) {
  const school = form.elements.school.value.trim(), dept = form.elements.dept.value.trim(), date = form.elements.date.value;
  A.draft = {school, dept, date};
  if (!school) { A.mErr = '學校要填'; renderFoot(); form = $('[data-manual-form]'); if (form) form.elements.school.focus(); return; }
  const app = L.blankApp({school, dept, date}, {apps: S.apps, nowMs: Date.now()});
  A.manual = false; A.mErr = ''; A.draft = {school: '', dept: '', date: ''};
  renderFoot();
  addApp(app, {toast: `已加入 ${shortName(app)}${dept ? ' ' + deptName(app) : ''}`, action: {label: '打開', fn: () => { if (dlg().open) dlg().close(); go({view: 'schools', id: app.id}); }}});
}
function openManual() {
  A.manual = true; A.mErr = '';
  // 搜尋找不到時，把打的字當成學校名稱
  if (!A.draft.school && A.q.trim() && !(A.res && A.res.programs && A.res.programs.length)) A.draft.school = A.q.trim();
  renderFoot();
  const f = $('[data-manual-form]');
  if (f) (A.draft.school ? f.elements.dept : f.elements.school).focus();
}

/* ---------- 接線 ---------- */
function move(step) {
  const R = results();
  if (!R.list.length) return;
  const i = R.list.findIndex(x => x.p.i === A.sel);
  const j = Math.max(0, Math.min(R.list.length - 1, (i < 0 ? -1 : i) + step));
  A.sel = R.list[j].p.i; A.keep = false; A.qualOpen = '';
  renderBody();
  const el = document.getElementById('add-opt-' + A.sel);
  if (el) el.scrollIntoView({block: 'nearest'});
}
export function init() {
  const d = dlg();
  d.addEventListener('input', e => {
    if (e.target.id === 'add-q') { if (!composing(e)) setQuery(e.target.value); return; }
    const f = e.target.closest('[data-manual-form]');
    if (f) {
      A.draft = {school: f.elements.school.value, dept: f.elements.dept.value, date: f.elements.date.value};
      if (A.mErr && A.draft.school.trim()) { A.mErr = ''; const er = f.querySelector('.form-err'); if (er) er.remove(); }
    }
  });
  d.addEventListener('compositionend', e => { if (e.target.id === 'add-q') setQuery(e.target.value); });
  d.addEventListener('keydown', e => {
    if (e.key === 'Enter' && composing(e)) { e.preventDefault(); return; }
    // 手動新增的欄位裡按 Esc：只收起這三個欄位，不關掉整個對話框
    if (e.key === 'Escape' && !composing(e) && e.target.closest && e.target.closest('[data-manual-form]')) {
      e.preventDefault(); A.manual = false; A.mErr = ''; renderFoot();
      const m = $('[data-manual]', d); if (m) m.focus({preventScroll: true});
      return;
    }
    if (e.target.id !== 'add-q' || composing(e)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); searchSoon.flush(); move(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter') { e.preventDefault(); searchSoon.flush(); }
  });
  d.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'add-region') A.region = t.value;
    else if (t.id === 'add-open') A.open = t.checked;
    else if (t.id === 'add-match') A.match = t.checked;
    else return;
    A.limit = PAGE; A.keep = false;
    ls.set('addFilters', {region: A.region, open: A.open});
    renderBody(); scrollTop();
  });
  d.addEventListener('click', e => {
    const t = e.target;
    const add = t.closest('[data-add]');
    if (add) { addProgram(add.dataset.add); return; }
    if (t.closest('[data-more]')) { A.limit += PAGE; renderBody(); return; }
    if (t.closest('[data-manual]')) { openManual(); return; }
    if (t.closest('[data-manual-cancel]')) { A.manual = false; A.mErr = ''; renderFoot(); return; }
    if (t.closest('[data-back]')) { A.detail = false; renderBody(); return; }
    const qo = t.closest('[data-qual]');
    if (qo) { A.qualOpen = A.qualOpen === qo.dataset.qual ? '' : qo.dataset.qual; renderBody(); return; }
    if (t.closest('a')) return;
    const row = t.closest('[data-pid]');
    if (row) { if (A.sel !== row.dataset.pid) A.qualOpen = ''; A.sel = row.dataset.pid; A.keep = false; A.detail = true; renderBody(); }
  });
  d.addEventListener('submit', e => {
    const f = e.target.closest('[data-manual-form]');
    if (!f) return;
    e.preventDefault();
    addManual(f);
  });
  d.addEventListener('close', () => { A.manual = false; A.mErr = ''; A.detail = false; });
  // 對話框開著時資料變了（加入、別的裝置改過）：已加入的狀態要跟著變
  onChange(() => { if (dlg().open && $('#add-root')) renderBody(); });
  const f = ls.get('addFilters', null);
  if (f && typeof f === 'object') { A.region = REGION[f.region] ? f.region : ''; A.open = !!f.open; }
}
export function render() { if (dlg().open) renderBody(); }
// open({pid, q})：pid 是要先選好的系組（學校頁「看簡章」、舊的 #finder/<pid>），q 是搜尋字。
export function open(opts = {}) {
  const {pid = '', q} = opts || {};
  const p = pid ? P.byId.get(pid) : null;
  if (p) { A.q = q != null ? String(q) : schoolShort(p); A.sel = p.i; A.keep = true; A.detail = true; A.qualOpen = ''; }
  else if (q != null) { A.q = String(q); A.keep = false; A.detail = false; }
  A.manual = false; A.mErr = '';
  renderShell();
  openDialog(dlg());
  search();
  const inp = $('#add-q');
  if (inp) { inp.focus({preventScroll: true}); if (!p) inp.select(); }
}
