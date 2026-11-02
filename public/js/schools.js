// 學校（#schools、#schools/<id>）：左邊一排學校，右邊是選到的那一間。
// 由上而下：學校名・狀態 → 下一步（大字，打勾和回答都在這裡）→ 兩欄：我的（時程・備審・紀錄）｜簡章（13px 灰字，只列這個階段用得到的）。
// 平常都是純文字；要改就按那一段的「改」，只有那一段變成表單（規格 §0.2、§5）。
import {$, S, esc, now, today, uid, appById, programOf, linksOf, pdfAt, colourOf, shortName, schoolName, deptName, agendaNow, orderNow, statusOf, stageOf, timelineOf, eventsFor, act, actx, mutate, mutateMany, removeApp, rerender, syncMarks, syncUnseen, ackSync, PALETTE, namesOf, actionToast, tickToast} from './core.js';
import {setUrl, href} from './router.js';
import {hueAttr, ext, pg, md, mdw, fmtVal, icon, isEditing, editKey, editForm, onEditSave, timeInput, normTime, popMenu, fromAhead, fromText, methodText, feeText} from './ui.js';
import * as L from './logic.js';
import * as add from './add.js';

// 這個畫面自己的狀態（重畫時保留）：選到哪間、展開了什麼、下一步正在問什麼、打開時的簡章更新標記。
const ST = {id: '', all: new Set(), docsOpen: new Set(), refOpen: new Set(), ask: null, marks: null, focus: ''};
// 「改」表單的草稿：時程、備審的表單會增減列，ui.js 的草稿保留不夠用，自己記。
const D = {key: '', rows: new Map(), del: new Set(), restore: new Set(), adds: [], docDel: new Set(), docAdds: ['']};
let V = null;   // 這次畫的：{app, p, next}
// 這次畫面上已經寫出簡章附註的日期列（下一步、時程）：右欄「繳件方式」就不再寫一次（規格 §0.5 每件事一個畫面只寫一次）
let notesShown = new Set();
const cur = () => V && appById(V.app.id);

/* ---------- 小工具 ---------- */
const toggle = (set, k) => { if (set.has(k)) set.delete(k); else set.add(k); };
const names = ids => namesOf(ids).join('、');
const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
const nz = s => String(s || '').normalize('NFKC').replace(/\s+/g, '').replace(/…$/, '');
const docRef = full => 'doc|' + nz(full).slice(0, 40);   // 和 logic.js 的備審 ref 一樣
// 「資安外加 醫學資訊…學程」→「醫學資訊…學程・資安外加」：系名在前
const deptFull = dept => { const {main, quals} = L.splitDept(dept); return [main, ...quals].filter(Boolean).join('・'); };

function pickDefault() {
  // 規格：#schools 沒指定時，打開接下來第一列的那間（不是清單第一間：成大十月就交了）
  const ag = agendaNow(), r = ag.rows[0], a = r && appById(r.appId);
  if (a) return a;
  const o = orderNow();
  return o.active[0] || o.ended[0] || S.apps[0];
}

/* ---------- 簡章全文：找出每一段在 PDF 的第幾頁 ---------- */
// programs.json 只記科系那一頁；格式規定、面試注意常寫在別頁，用全文找一次。找不到就用科系那頁。
const TXT = new Map();
function loadText(code) {
  if (!code || TXT.has(code)) return;
  TXT.set(code, null);
  fetch(`/data/brochures/text/${encodeURIComponent(code)}.json`).then(r => r.ok ? r.json() : null).then(d => {
    if (!d || !Array.isArray(d.pages)) return;
    TXT.set(code, d.pages.map(nz));
    if (V && V.p && V.p.code === code && !$('#view-schools').hidden) rerender();
  }).catch(() => {});
}
function findPage(p, line) {
  const pages = p && TXT.get(p.code);
  if (!pages || !line) return 0;
  const q = nz(String(line).replace(/^\s*(注意事項[:：]|[（(]?[一二三四五六七八九十\d]+[)）.、])\s*/, '')).slice(0, 14);
  if (q.length < 6) return 0;
  const own = new Set(p.pg || []);
  let first = 0;
  for (let i = 0; i < pages.length; i++) if (pages[i].includes(q)) { if (own.has(i + 1)) return i + 1; if (!first) first = i + 1; }
  return first;
}

/* ---------- 左邊：學校清單 ---------- */
function railHtml(sel, first) {
  const {active, ended} = orderNow(), t = today();
  const row = a => {
    const r = first.get(a.id), n = r ? L.daysBetween(t, r.date) : 0;
    const when = !r ? '' : n >= 0 && n < 7 ? L.dayLabel(r.date, now()) + (n === 0 && r.time ? ' ' + r.time : '') : md(r.date);
    const on = a.id === sel;
    return `<a class="s-rr${on ? ' tint' : ''}" href="${esc(href('schools', a.id))}" ${hueAttr(a)}${on ? ' aria-current="page"' : ''}>
      <span class="bar-hue"></span><span class="s-rr-n"><b>${esc(schoolName(a))}</b><span>${esc(statusOf(a))}</span></span>
      <span class="s-rr-w${r && (r.date === t || r.overdue) ? ' hot' : ''}">${esc(when)}</span><span class="s-rr-d">${esc(deptName(a))}</span></a>`;
  };
  return `<nav class="s-rail scroll" aria-label="我的學校">${active.map(row).join('')}${ended.length ? `<div class="s-end">結束</div>${ended.map(row).join('')}` : ''}</nav>`;
}

/* ---------- 頁首：校名、系組、狀態、⋯ ---------- */
function headHtml(app, p) {
  const l = linksOf(app);
  const links = [ext(l.apply, '報名系統'), l.adm !== l.apply ? ext(l.adm, '招生網') : '', l.pdf ? ext(pdfAt(app, (p && p.pg || [])[0]), '簡章') : '', l.dept && l.dept !== l.adm && l.dept !== l.apply ? ext(l.dept, '系網') : ''].filter(Boolean);
  return `<header class="s-head">
    <div class="s-id"><div class="s-title" ${hueAttr(app)}><span class="dot"></span><h1>${esc(app.school)}</h1><span class="s-dept">${esc(deptFull(app.dept))}</span></div>
      ${links.length ? `<div class="s-links">${links.join('')}</div>` : ''}</div>
    <div class="s-side"><button class="s-status" type="button" data-status aria-haspopup="menu" aria-expanded="false">${esc(statusOf(app))}</button><button class="icon-btn" type="button" data-more aria-haspopup="menu" aria-expanded="false" aria-label="更多">${icon('more')}</button></div>
  </header>`;
}

/* ---------- 下一步（焦點）：這間在接下來的第一列 ---------- */
function nextHtml(app, n) {
  if (!n) {
    const up = stageOf(app) === 'ended' ? null : timelineOf(app).find(r => !r.past && !r.done && r.type !== 'info');
    return `<section class="s-next" aria-label="下一步" tabindex="-1"><div class="s-next-h">下一步</div>
      <p class="s-nothing">這間沒有要做的事</p>${up ? `<p class="s-next-sub">${esc(L.fmtDate(up.date))}${up.time ? ' ' + esc(up.time) : ''}　${esc(up.label)}</p>` : ''}</section>`;
  }
  const day = L.dayLabel(n.date, now()), hot = n.date === today() || n.overdue, tt = L.timeText(n, now());
  const what = n.parts.length
    ? n.parts.map(pt => pt.opt
      ? `<span class="s-optp">${esc(pt.name)}（選繳）</span>`
      : `<label class="check lg task"><input type="checkbox" data-tick="${esc(pt.key)}"${pt.done ? ' checked' : ''}><span>${esc(pt.name)}${pt.own ? `<span class="s-own">${esc(pt.own)}</span>` : ''}</span></label>`).join('')
    : `<span class="s-lab">${esc(n.label)}</span>`;
  // 按鈕最多兩個：有問題就是回答；沒有就是報名系統（準備中）或「不去」。連結放最後。
  let btns = '', link = '';
  n.actions.forEach((a, i) => {
    if (a.kind === 'link') { link = (n.type === 'do' && !n.question) ? `<a class="btn lg ext" href="${esc(a.href)}" target="_blank" rel="noopener">${esc(a.label)}</a>` : ext(a.href, a.label); return; }
    const on = ST.ask && ST.ask.key === n.key && ST.ask.id === a.id;
    btns += `<button class="btn lg${on ? ' on' : ''}" type="button" data-act="${i}"${a.disabled ? ' disabled' : ''}${a.ask ? ` aria-expanded="${on}"` : ''}>${esc(a.label)}</button>`;
  });
  const sub = [];
  if (/^(今天|明天|後天)$/.test(day)) sub.push(L.fmtDate(n.date));
  if (n.from && fromAhead(n.from, n.fromTime)) sub.push(fromText(n.from, n.fromTime));
  if (n.note) sub.push(n.note);
  const send = n.sendBy || (n.parts.find(pt => pt.sendBy) || {}).sendBy;
  if (send) sub.push(`最晚 ${md(send)} 寄出`);
  if (n.context) sub.push(n.context);
  if (n.clash && n.clash.length) sub.push('同天：' + names(n.clash));
  return `<section class="s-next${n.tentative ? ' tent' : ''}" aria-label="下一步" tabindex="-1"><div class="s-next-h">下一步</div>
    <div class="s-nl"><span class="s-day${hot ? ' hot' : ''}">${esc(day)}</span>${tt ? `<span class="s-tm">${esc(tt)}</span>` : ''}<span class="s-what">${what}</span>${btns || link ? `<span class="s-acts">${btns}${link}</span>` : ''}</div>
    ${sub.length ? `<p class="s-next-sub">${sub.map(esc).join('　')}</p>` : ''}${askHtml(n)}</section>`;
}
// 按了「備取」「遞補上了」「換到 B」之後才出現的那一小塊
const askAction = () => { const k = ST.ask, n = V && V.next; return k && n && n.key === k.key ? n.actions.find(a => a.id === k.id && a.ask) || null : null; };
function askHtml(n) {
  const a = ST.ask && ST.ask.key === n.key ? askAction() : null;
  if (!a) return '';
  const q = a.ask, cancel = '<button class="link" type="button" data-ask-cancel>取消</button>';
  if (q.type === 'confirm') return `<div class="s-ask"><span>${esc(q.text)}</span><button class="btn sm" type="button" data-ask-ok>${esc(q.ok || '確定')}</button>${cancel}</div>`;
  if (q.type === 'number') return `<form class="s-ask" data-ask-form novalidate><label>${esc(q.label)} <input type="number" class="s-num" name="no" min="1" max="999" inputmode="numeric" value="${esc(ST.ask.no || '')}"></label><button class="btn sm" type="submit">確定</button>${cancel}</form>`;
  return `<form class="s-ask" data-ask-form novalidate><span>${esc(q.label)}</span><input type="date" name="date" value="${esc(ST.ask.date || '')}" aria-label="日期">${timeInput('time', ST.ask.time || '', 'aria-label="時間"')}<button class="btn sm" type="submit">確定</button>${cancel}<span class="form-err" data-ask-err></span></form>`;
}

/* ---------- 時程 ---------- */
function schedHtml(app) {
  const key = 'sched:' + app.id, rows = timelineOf(app);
  // 附註也只寫一次：下一步寫了的那幾列不寫；同一句話在時程裡只寫第一次
  const nextNote = new Set(V && V.next && V.next.note ? V.next.rowIds : []), noteText = new Set(rows.filter(r => nextNote.has(r.rowId) && r.note).map(r => r.note));
  notesShown = new Set(nextNote);
  if (isEditing(key)) return `<section class="sec s-sched"><div class="sec-h"><h3>時程</h3></div>${schedForm(app, key, rows)}</section>`;
  const unseen = (ST.marks && ST.marks.unseen) || new Set(), all = ST.all.has(app.id);
  if (stageOf(app) === 'ended') for (const r of rows) r.next = false;   // 結束了就沒有「下一個」
  // 平常只列里程碑（報名→名單→面試→放榜→報到），自己加的和剛被簡章改到的也列；其他（複查、遞補截止…）收在「全部 N 個日期」
  const shown = all ? rows : rows.filter(r => r.milestone || r.src === 'mine' || (r.upd && unseen.has(r.upd)));
  const more = all || rows.length > shown.length;
  const gone = ((ST.marks && ST.marks.list) || []).filter(c => c.removed && !c.doc);
  // 「11/02 09:00 起」每個畫面只寫一次：下一步已經寫了就不寫，同一天的報名・繳費・繳件也只寫第一列
  const said = new Set(V && V.next && V.next.from && fromAhead(V.next.from, V.next.fromTime) ? V.next.rowIds : []), saidText = new Set();
  const noteOnce = r => {
    if (!r.note || nextNote.has(r.rowId) || noteText.has(r.note)) return '';
    noteText.add(r.note); notesShown.add(r.rowId);
    return r.note;
  };
  const fromOnce = r => {
    if (!r.from || !fromAhead(r.from, r.fromTime) || said.has(r.rowId)) return '';
    const t = fromText(r.from, r.fromTime), k = r.date + t;
    if (saidText.has(k)) return '';
    saidText.add(k);
    return t;
  };
  return `<section class="sec s-sched"><div class="sec-h"><h3>時程</h3>${more ? `<button class="link" type="button" data-all aria-expanded="${all}">${all ? '收起' : `全部 ${rows.length} 個日期`}</button>` : ''}<button class="link edit" type="button" data-edit="${esc(key)}">改</button></div>
    ${shown.length ? `<div class="s-tl">${shown.map(r => schedRow(r, unseen, fromOnce(r), noteOnce(r))).join('')}</div>` : '<p class="empty">還沒有日期</p>'}
    ${gone.map(c => `<p class="s-sync">簡章已刪除：${esc(c.what)} ${esc(fmtVal(c.from))}</p>`).join('')}</section>`;
}
function schedRow(r, unseen, from, note) {
  const isToday = r.date === today() && !r.past && !r.done;
  // 郵戳類不寫鐘點；沒時間的、還沒到的寫「時間未公布」（只有學校頁這樣寫）
  const time = r.mail === 'postmark' ? '郵戳為憑' : r.mail === 'arrive' ? (r.time ? `${r.time} 前寄達` : '寄達為憑') : r.time || (r.past ? '' : '時間未公布');
  const unk = !r.time || r.mail;
  const bits = [];
  if (r.end) bits.push(`到 ${md(r.end)}`);
  if (from) bits.push(from);
  if (note) bits.push(note);
  if (r.clash && r.clash.length) bits.push('同天：' + names(r.clash));
  if (r.brochureNow) bits.push(`簡章現在是 ${md(r.brochureNow.date)}${r.brochureNow.time ? ' ' + r.brochureNow.time : ''}`);
  if (r.gone) bits.push('簡章已刪除');
  if (r.upd && unseen.has(r.upd)) bits.push('簡章更新');
  return `<div class="s-tr${r.past || r.done ? ' past' : ''}${r.next ? ' next' : ''}${isToday ? ' today' : ''}"><span class="d">${isToday ? '今天' : esc(L.fmtDate(r.date))}</span><span class="t${unk ? ' unk' : ''}">${esc(time)}</span><span class="w"><span class="l">${esc(r.label)}</span>${r.edited ? '<span class="edited">已改</span>' : ''}${bits.map(b => `<small>${esc(b)}</small>`).join('')}</span></div>`;
}
// 紀錄裡記了自己的面試時間（ivTime）：時程上那一列顯示的就是它，所以「改」也顯示、也改這個時間（存回紀錄）。
const ivRowOf = app => { const k = (app.dates || []).some(d => d.kind === 'interview') ? 'interview' : 'exam'; return d => !!normTime(app.ivTime || '') && d.kind === k; };
function draft(key) {
  if (D.key === key) return;
  Object.assign(D, {key, rows: new Map(), del: new Set(), restore: new Set(), adds: [], docDel: new Set(), docAdds: ['']});
}
function schedForm(app, key, rows) {
  draft(key);
  const byId = new Map((app.dates || []).map(d => [d.id, d]));
  const order = [...rows.map(r => r.rowId), ...(app.dates || []).map(d => d.id).filter(id => !rows.some(r => r.rowId === id))];
  const labelOf = new Map(rows.map(r => [r.rowId, r])), isIv = ivRowOf(app);
  const row = id => {
    const d = byId.get(id), r = labelOf.get(id), label0 = r ? r.label : L.rowLabel(d);
    const v = D.rows.get(id) || {date: d.date || '', time: isIv(d) ? app.ivTime : d.time || '', label: label0};
    const atBro = d.bro && v.date === (d.bro.date || '') && v.time === (d.bro.time || '');
    const edited = d.src === 'brochure' && d.bro && !(D.restore.has(id) && atBro) && L.isEdited({...d, date: v.date, time: isIv(d) ? d.time : v.time});
    // 簡章的名稱不給改（和備審一樣）：報名列的名稱決定要勾哪幾個部分，放榜、報到的名稱也是固定的。自己加的可以改。
    // 簡章列一律寫時程上的名稱，不看草稿（還原、改了日期再重畫時，草稿裡沒有名稱）。
    const lab = d.src !== 'mine' ? `<span class="s-fl">${esc(label0)}</span>` : `<input type="text" name="l:${esc(id)}" data-sf="label" data-row="${esc(id)}" value="${esc(v.label)}" aria-label="名稱" maxlength="40">`;
    return `<div class="edit-row s-er"><input type="date" class="d" name="d:${esc(id)}" data-sf="date" data-row="${esc(id)}" value="${esc(v.date)}" aria-label="日期">${timeInput('t:' + id, v.time, `data-sf="time" data-row="${esc(id)}" aria-label="時間"`)}<span class="l">${lab}</span><span class="r">${edited ? `<button class="link" type="button" data-sched-restore="${esc(id)}">還原</button>` : ''}</span><button class="rm x" type="button" data-sched-rm="${esc(id)}" aria-label="刪除這個日期">✕</button></div>`;
  };
  const addRow = (v, i) => `<div class="edit-row s-er"><input type="date" class="d" name="ad:${i}" data-sf="date" data-add="${i}" value="${esc(v.date)}" aria-label="日期">${timeInput('at:' + i, v.time, `data-sf="time" data-add="${i}" aria-label="時間"`)}<span class="l"><input type="text" name="al:${i}" data-sf="label" data-add="${i}" value="${esc(v.label)}" placeholder="名稱" aria-label="名稱" maxlength="40"></span><span class="r"></span><button class="rm x" type="button" data-sched-add-rm="${i}" aria-label="不要這一列">✕</button></div>`;
  const p = programOf(app), bro = p ? L.brochureRows(p) : [];
  const hidden = (app.hidden || []).filter(ref => !ref.startsWith('doc|')).map(ref => bro.find(b => b.ref === ref)).filter(Boolean);
  const inner = `<div class="s-ef">${order.filter(id => !D.del.has(id) && byId.has(id)).map(row).join('')}${D.adds.map(addRow).join('')}</div>
    ${hidden.length ? `<p class="s-hid">已刪除：${hidden.map(b => `${esc(L.rowLabel(b))} ${esc(md(b.date))} <button class="link" type="button" data-unhide="${esc(b.ref)}">加回</button>`).join('　')}</p>` : ''}
    <p class="form-err" data-err></p>`;
  return editForm(key, inner, {cls: 's-sched-ed', extra: '<button class="link" type="button" data-add-date>＋ 新增日期</button>'});
}
function saveSched(form, key) {
  const app = appById(key.slice(6));
  if (!app) return;
  const err = (el, msg) => { form.querySelectorAll('.bad').forEach(x => x.classList.remove('bad')); if (el) { el.classList.add('bad'); el.focus(); } form.querySelector('[data-err]').textContent = msg; return false; };
  const val = name => { const el = form.elements[name]; return el ? el.value.trim() : ''; };
  const edits = [], adds = [], restores = [], orig = new Map(timelineOf(app).map(r => [r.rowId, r.label])), isIv = ivRowOf(app);
  let ivTime;
  for (const d of app.dates || []) {
    if (D.del.has(d.id) || !form.elements['d:' + d.id]) continue;
    const date = val('d:' + d.id), time = normTime(val('t:' + d.id));
    if (!date) return err(form.elements['d:' + d.id], '日期要填');
    if (time === null) return err(form.elements['t:' + d.id], '時間寫成 17:00');
    const ch = {}, iv = isIv(d);
    if (date !== (d.date || '')) ch.date = date;
    // 面試列的時間是紀錄裡的 ivTime：改了就存回紀錄；按了還原就清掉，回到簡章的時間
    if (iv) { if (D.restore.has(d.id) && d.bro && time === (d.bro.time || '')) ivTime = ''; else if (time !== app.ivTime) ivTime = time; }
    else if (time !== (d.time || '')) ch.time = time;
    const lab = form.elements['l:' + d.id];
    if (lab && lab.value.trim() && lab.value.trim() !== (orig.get(d.id) ?? L.rowLabel(d))) ch.label = lab.value.trim();
    // 改回和簡章一樣（或按了還原）：用 restoreDate，連 from、end 一起回到簡章
    if (d.src === 'brochure' && d.bro && (ch.date || ch.time !== undefined || D.restore.has(d.id)) && date === d.bro.date && (iv || time === (d.bro.time || ''))) { restores.push(d.id); delete ch.date; delete ch.time; }
    if (Object.keys(ch).length) edits.push([d.id, ch]);
  }
  for (let i = 0; i < D.adds.length; i++) {
    const date = val('ad:' + i), time = normTime(val('at:' + i)), label = val('al:' + i);
    if (!date && !label && !time) continue;
    if (!date) return err(form.elements['ad:' + i], '日期要填');
    if (time === null) return err(form.elements['at:' + i], '時間寫成 17:00');
    if (!label) return err(form.elements['al:' + i], '名稱要填');
    adds.push({date, time, label, id: uid()});
  }
  const dels = [...D.del].filter(id => (app.dates || []).some(d => d.id === id));
  if (!edits.length && !adds.length && !dels.length && !restores.length && ivTime === undefined) return;
  const removed = dels.map(id => { const d = app.dates.find(x => x.id === id); return L.rowLabel(d) || L.KIND_LABEL[d.kind] || ''; });
  mutate(app.id, a => {
    let x = a;
    for (const id of restores) x = L.applyAction(x, 'restoreDate', {rowId: id}, actx(x));
    for (const [id, ch] of edits) x = L.applyAction(x, 'editDate', {rowId: id, ...ch}, actx(x));
    for (const id of dels) x = L.applyAction(x, 'removeDate', {rowId: id}, actx(x));
    for (const v of adds) x = L.applyAction(x, 'addDate', v, actx(x));
    if (ivTime !== undefined) x = L.applyAction(x, 'editRecord', {ivTime}, actx(x));
    return x;
  }, {toast: dels.length && !edits.length && !adds.length && !restores.length && ivTime === undefined ? `已刪除 ${shortName(app)} ${removed.join('、')}` : `已記下：${shortName(app)} 時程`});
}

/* ---------- 備審 ---------- */
// 簡章原文去掉和短名稱重複的開頭，剩下的當灰字說明：「學歷證明（如學生證…）」→「如學生證…」
function docDesc(d) {
  const full = String(d.full || '').trim(), name = String(d.name || '').trim();
  if (!full || !name || nz(full) === nz(name)) return '';
  let i = 0, j = 0;
  while (i < full.length && j < name.length) {
    if (full[i] === name[j]) { i++; j++; continue; }
    if (/\s/.test(full[i])) { i++; continue; }
    if (/\s/.test(name[j])) { j++; continue; }
    const m = /^[（(][^）)]{0,4}[）)]/.exec(full.slice(i));    // 「高中(職)」的(職)
    if (m) { i += m[0].length; continue; }
    break;
  }
  if (j < name.length) return full;
  let rest = full.slice(i).trim().replace(/^[：:，,、；;\s]+/, '');
  const m = /^[（(]([^（()）]*)[）)]$/.exec(rest);
  if (m) rest = m[1];
  else if (/^[（(]/.test(rest) && !/[）)]/.test(rest)) rest = rest.slice(1);   // 簡章抽出來被截斷、沒有右括號的
  return rest;
}
function docsHtml(app) {
  const key = 'docs:' + app.id, p = programOf(app), docs = app.docs || [];
  if (isEditing(key)) return `<section class="sec s-docs"><div class="sec-h"><h3>備審</h3></div>${docsForm(app, key, p)}</section>`;
  const summary = L.docsMode(app, p, now()) === 'summary', open = ST.docsOpen.has(app.id);
  if (summary && !open) return `<section class="sec s-docs"><div class="sec-h"><h3>備審</h3><span class="count">${docs.length} 項${app.status === 'skipped' ? '' : '・已隨報名送出'}</span>${docs.length ? '<button class="link" type="button" data-docs-open aria-expanded="false">展開</button>' : ''}</div></section>`;
  const req = docs.filter(d => !d.opt), done = req.filter(d => d.done).length;
  const generic = docs.length > 0 && docs.every(d => d.src === 'placeholder');
  const count = docs.length ? `${done}／${req.length}${generic ? '・通用項目' : ''}` : '';
  const item = d => {
    const desc = docDesc(d);
    return `<li><label class="check task"><input type="checkbox" data-doc="${esc(d.id)}"${d.done ? ' checked' : ''}><span>${esc(d.name)}${d.opt ? ' <span class="opt">選繳</span>' : ''}${desc ? ` <span class="s-dd">${esc(desc)}</span>` : ''}${d.gone ? ' <span class="s-dd">簡章已刪除</span>' : ''}</span></label></li>`;
  };
  return `<section class="sec s-docs"><div class="sec-h"><h3>備審</h3>${count ? `<span class="count">${esc(count)}</span>` : ''}${summary ? '<button class="link" type="button" data-docs-open aria-expanded="true">收起</button>' : ''}<button class="link edit" type="button" data-edit="${esc(key)}">改</button></div>
    ${docs.length ? `<ul class="s-dl">${docs.map(item).join('')}</ul>` : '<p class="empty">沒有備審項目</p>'}</section>`;
}
function docsForm(app, key, p) {
  draft(key);
  const docs = (app.docs || []).filter(d => !D.docDel.has(d.id));
  const hid = (app.hidden || []).filter(r => r.startsWith('doc|')).map(ref => ({ref, full: ((p && p.docs) || []).find(f => docRef(f) === ref)})).filter(x => x.full);
  const inner = `<ul class="s-dl s-def">${docs.map(d => `<li class="edit-row"><span>${esc(d.name)}${d.opt ? ' <span class="opt">選繳</span>' : ''}</span><button class="rm" type="button" data-doc-rm="${esc(d.id)}" aria-label="移除 ${esc(d.name)}">✕</button></li>`).join('')}
    ${D.docAdds.map((v, i) => `<li class="edit-row"><input type="text" name="doc:${i}" data-doc-add="${i}" value="${esc(v)}" placeholder="新增項目" aria-label="新增項目" maxlength="40"><button class="rm" type="button" data-doc-add-rm="${i}" aria-label="不要這一項">✕</button></li>`).join('')}</ul>
    ${hid.length ? `<p class="s-hid">已移除：${hid.map(h => `${esc(L.shortDoc(h.full))} <button class="link" type="button" data-unhide-doc="${esc(h.ref)}">加回</button>`).join('　')}</p>` : ''}`;
  return editForm(key, inner, {extra: '<button class="link" type="button" data-doc-more>＋ 再一項</button>'});
}
function saveDocs(form, key) {
  const app = appById(key.slice(5));
  if (!app) return;
  const adds = [...form.querySelectorAll('[data-doc-add]')].map(el => el.value.trim()).filter(Boolean).map(name => ({name, id: uid()}));
  const dels = [...D.docDel].filter(id => (app.docs || []).some(d => d.id === id));
  if (!adds.length && !dels.length) return;
  const gone = dels.map(id => app.docs.find(d => d.id === id).name);
  mutate(app.id, a => {
    let x = a;
    for (const id of dels) x = L.applyAction(x, 'hideDoc', {docId: id}, actx(x));
    for (const v of adds) x = L.applyAction(x, 'addDoc', v, actx(x));
    return x;
  }, {toast: dels.length && !adds.length ? `已移除 ${shortName(app)} ${gone.join('、')}` : `已記下：${shortName(app)} 備審`});
}

/* ---------- 紀錄 ---------- */
function recFields(app, p) {
  const f = L.recordFields(app, p, now());
  // 只有筆試（成大）：欄位名稱跟著改
  const go = eventsFor(app).filter(e => e.role === 'go');
  if (go.length && !go.some(e => e.kind === 'interview')) for (const x of f) x.label = x.label.replace('面試被問了什麼', '筆試考了什麼').replace('面試', '筆試');
  return f;
}
function recHtml(app) {
  const key = 'rec:' + app.id, p = programOf(app), fields = recFields(app, p);
  if (isEditing(key)) {
    const input = f => f.key === 'ivTime' ? timeInput('ivTime', f.value, `id="rec-ivTime"`)
      : f.key === 'asked' || f.key === 'notes' ? `<textarea id="rec-${f.key}" name="${f.key}" rows="3">${esc(f.value)}</textarea>`
      : `<input type="text" id="rec-${f.key}" name="${f.key}" value="${esc(f.value)}" maxlength="${f.key === 'regNo' ? 40 : 120}">`;
    const inner = `<div class="s-kv s-kv-ed">${fields.map(f => `<label for="rec-${f.key}">${esc(f.label)}</label><div>${input(f)}</div>`).join('')}</div><p class="form-err" data-err></p>`;
    return `<section class="sec s-rec"><div class="sec-h"><h3>紀錄</h3></div>${editForm(key, inner)}</section>`;
  }
  const vals = fields.filter(f => f.value);
  if (!vals.length) return `<section class="sec s-rec"><div class="sec-h"><h3>紀錄</h3></div><button class="link" type="button" data-edit="${esc(key)}">＋ 記一筆</button></section>`;
  return `<section class="sec s-rec"><div class="sec-h"><h3>紀錄</h3><button class="link edit" type="button" data-edit="${esc(key)}">改</button></div>
    <dl class="s-kv">${vals.map(f => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl></section>`;
}
function saveRec(form, key) {
  const app = appById(key.slice(4));
  if (!app) return;
  const pl = {};
  for (const k of ['regNo', 'place', 'asked', 'notes']) if (form.elements[k]) pl[k] = form.elements[k].value;
  if (form.elements.ivTime) {
    const t = normTime(form.elements.ivTime.value);
    if (t === null) { form.elements.ivTime.classList.add('bad'); form.elements.ivTime.focus(); form.querySelector('[data-err]').textContent = '時間寫成 17:00'; return false; }
    pl.ivTime = t;
  }
  const after = L.applyAction(app, 'editRecord', pl, actx(app));
  if (JSON.stringify(after) === JSON.stringify(app)) return;
  act(app.id, 'editRecord', pl, {toast: `已記下：${shortName(app)} 紀錄`});
}

/* ---------- 簡章（右欄，依階段） ---------- */
const NOISE_CW = /^正取報到[\n；;]*備取(等待|填寫就讀意願)$/;
// said：畫面上已經寫了附註的日期列（下一步、時程），那句附註這裡就不再寫；列印時全部都寫
function submitLines(app, p, said = new Set()) {
  const out = [], ev = eventsFor(app).find(e => e.role === 'reg' && e.parts.some(pt => pt.key === 'docs'));
  if (ev) {
    const pt = ev.parts.find(x => x.key === 'docs');
    const how = pt.mail === 'postmark' ? '郵寄，郵戳為憑' : pt.mail === 'arrive' ? '寄達為憑' : /上傳/.test(pt.name) ? '網路上傳' : ev.kind === 'reg' ? '和網路報名一起繳交' : '';
    // 附註已經寫了郵戳／寄達的規則（市北「限時掛號，郵戳為憑」），推出來的「郵寄，郵戳為憑」就不重複
    const t = [pt.mail && /郵戳|寄達|送達/.test(ev.note) ? '' : how, said.has(ev.rowId) ? '' : ev.note].filter(Boolean).join('；');
    if (t) out.push(t);
  }
  if (p.rl && p.rl !== 'N') out.push(`推薦函：${p.rl.replace(/^暗/, '暗推').replace(/^明/, '明推')}`);
  if (p.pf === 'Y') out.push('要附作品集');
  return out;
}
// 每一塊：{k:小標, lines, page, more:'qx'|'ivn'（超過 4 行收起來）}
function refBlocks(app, p, stage, said) {
  const pg0 = (p.pg || [])[0] || 0, out = [];
  // 一行可以是字串，或 {html, text}（html 給畫面、text 給列印）
  const add = (k, ls, page, more) => { ls = (ls || []).map(x => x && x.html ? x : String(x || '').trim()).filter(Boolean); if (ls.length) out.push({k, lines: ls, page: page || pg0, more}); };
  const method = methodText(p), how = k => (p.how && typeof p.how === 'object' && p.how[k]) || '';
  const cw = p.cw && !NOISE_CW.test(p.cw.trim()) ? lines(p.cw) : [];
  if (stage === 'prep') {
    const facts = [p.fee && `報名費 ${feeText(p.fee)}`, p.q != null && p.q !== '' && `名額 ${p.q}`, /^\d+$/.test(String(p.mx || '')) && `同校最多報 ${p.mx} 個系組`].filter(Boolean);
    const nw = x => `<span class="nowrap">${esc(x)}</span>`, items = method ? method.split('・') : [];
    add('甄選方式', [{html: [items.map(nw).join('・'), ...facts.map(nw)].filter(Boolean).join('　'), text: [method, ...facts].filter(Boolean).join('　')}], pg0);
    add('繳件方式', submitLines(app, p, said), pg0);
    add('格式規定', p.fmt, findPage(p, (p.fmt || [])[0]));
    add('報名資格', lines(p.qx || p.tgt), p.qxp, 'qx');
  } else if (stage === 'applied' || stage === 'interview') {
    add('甄選方式', [method], pg0);
    add('面試注意', p.ivn, findPage(p, (p.ivn || [])[0]), 'ivn');
    add('考試地點', [p.loc], pg0);
  } else if (stage === 'waiting' || stage === 'ended') {
    add('甄選方式', [method], pg0);
    if (stage === 'waiting') add('報到・遞補', [...cw, how('confirm')], findPage(p, cw[0]));
  } else {
    add('報到・遞補', [...cw, how('confirm')], findPage(p, cw[0]));
    add('放棄方式', [how('giveup')], pg0);
  }
  if (!out.length) add('甄選方式', [method], pg0);
  return out;
}
function refHtml(app, p) {
  if (!p) return '<aside class="s-ref" aria-label="簡章"><div class="col-h">簡章</div><p class="ref">這間沒有簡章資料</p></aside>';
  loadText(p.code);
  const blocks = refBlocks(app, p, stageOf(app), notesShown);
  const body = b => {
    const k = b.more ? b.more + ':' + app.id : '', open = k && ST.refOpen.has(k), cut = b.more && b.lines.length > 4 && !open;
    return `${(cut ? b.lines.slice(0, 4) : b.lines).map(l => `<p>${l.html || esc(l)}</p>`).join('')}${b.more && b.lines.length > 4 ? `<button class="link" type="button" data-ref-open="${esc(b.more)}" aria-expanded="${!!open}">${open ? '收起' : '展開'}</button>` : ''}`;
  };
  return `<aside class="s-ref" aria-label="簡章"><div class="col-h">簡章</div>${blocks.length ? `<dl class="s-rl">${blocks.map(b => `<dt>${esc(b.k)}</dt><dd>${body(b)}</dd><span class="s-pg">${pg(app, b.page)}</span>`).join('')}</dl>` : ''}</aside>`;
}

/* ---------- 列印這一間 ---------- */
function printOne(app) {
  const p = programOf(app), rows = timelineOf(app), fields = recFields(app, p).filter(f => f.value);
  const seen = new Set(), blocks = p ? ['prep', 'applied', 'admitted'].flatMap(s => refBlocks(app, p, s)).filter(b => !seen.has(b.k) && seen.add(b.k)) : [];
  const time = r => r.mail === 'postmark' ? '郵戳為憑' : r.mail === 'arrive' ? `${r.time ? r.time + ' ' : ''}前寄達` : r.time || '';
  $('#print').innerHTML = `<div class="sp">
    <h1>${esc(app.school)} ${esc(app.dept || '')}</h1>
    <div class="pmeta">${esc(mdw(today()))} 列印・${esc(statusOf(app))}${linksOf(app).apply ? '・報名系統 ' + esc(linksOf(app).apply) : ''}</div>
    <h2>時程</h2>
    <table><tbody>${rows.map(r => `<tr${r.past || r.done ? ' class="sp-past"' : ''}><td class="sp-d">${esc(L.fmtDate(r.date))}</td><td class="sp-t">${esc(time(r))}</td><td>${esc(r.label)}${[r.note, r.clash && r.clash.length ? '同天：' + names(r.clash) : ''].filter(Boolean).map(x => ` <small>${esc(x)}</small>`).join('')}</td></tr>`).join('')}</tbody></table>
    <div class="sp-cols">
      <div><h2>備審</h2><ul class="sp-docs">${(app.docs || []).map(d => `<li>${d.done ? '☑' : '☐'} ${esc(d.name)}${d.opt ? '（選繳）' : ''}${docDesc(d) ? `<br><small>${esc(docDesc(d))}</small>` : ''}</li>`).join('') || '<li>—</li>'}</ul></div>
      <div>${fields.length ? `<h2>紀錄</h2><dl class="sp-dl">${fields.map(f => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl>` : ''}</div>
    </div>
    ${blocks.length ? `<h2>簡章</h2><dl class="sp-dl">${blocks.map(b => `<dt>${esc(b.k)}</dt><dd>${b.lines.map(l => esc(l.text || l)).join('<br>')}${b.page ? ` <small>p.${esc(b.page)}</small>` : ''}</dd>`).join('')}</dl>` : ''}
  </div>`;
  window.print();
}

/* ---------- 選單：狀態、⋯、顏色 ---------- */
// 回答、改狀態都給「復原」；提示寫新的狀態字（有變的話）
// focus：重畫後游標放哪裡（按下的按鈕通常跟著那一列消失，所以預設放回「下一步」）
function doAction(app, a, payload, focus = '.s-next') {
  ST.ask = null; ST.focus = focus;
  const pl = payload !== undefined ? payload : a.payload || {};
  const msg = actionToast(app, a.id, pl);
  if (!msg) return;
  if (a.also && a.also.length) mutateMany([[app.id, x => L.applyAction(x, a.id, pl, actx(x))], ...a.also.map(o => [o.appId, x => L.applyAction(x, o.id, o.payload || {}, actx(x))])], {toast: msg});
  else act(app.id, a.id, pl, {toast: msg});
}
function statusMenu(btn, app) {
  const w = statusOf(app), ENDED = ['rejected', 'out', 'skipped'];
  // 沒去面試（不去面試、面試日過了）：選單裡沒有這個字，什麼都不勾，選哪一個（包括原本的已報名）都會改（setStatus 會清掉 ivSkip）
  const now_ = app.giveupDone ? 'gaveup' : app.status === 'admitted' && app.confirmDone ? 'held' : app.choice === 'decline' && !ENDED.includes(app.status) ? 'declined'
    : w === '沒去面試' ? '' : L.STATUS.find(k => L.STATUS_LABEL[k] === w) || (w.startsWith('備取') ? 'waitlist' : app.status);
  const items = [...L.STATUS.map(k => ({id: k, label: L.STATUS_LABEL[k], checked: now_ === k})), '-', ...[['held', '已報到'], ['gaveup', '已放棄'], ['declined', '不去']].map(([id, label]) => ({id, label, checked: now_ === id}))];
  popMenu(btn, items, (id, it) => { if (id !== now_) doAction(cur() || app, {id: 'setStatus', label: it.label}, {status: id}, '[data-status]'); });
}
function moreMenu(btn, app) {
  popMenu(btn, [{id: 'color', label: '顏色'}, {id: 'print', label: '列印這一間'}, '-', {id: 'del', label: '刪除這間學校', danger: true}], id => {
    if (id === 'color') colorMenu(btn, app);
    else if (id === 'print') printOne(cur() || app);
    else if (id === 'del') removeApp(app.id);
  });
}
function colorMenu(btn, app) {
  const c = colourOf(app);
  const items = Array.from({length: PALETTE}, (_, i) => {
    const others = S.apps.filter(a => a.id !== app.id && colourOf(a) === i).map(shortName);
    return {id: i, checked: i === c, html: `<span class="dot" style="--hue:var(--c${i})"></span><span class="sch" style="--hue:var(--c${i})">${esc(shortName(app))}</span>${others.length ? `<span class="s-cm">${esc(others.join('、'))}</span>` : ''}`};
  });
  popMenu(btn, items, i => { if (i !== c) act(app.id, 'setColor', {color: i}); });
}

/* ---------- 事件（init 掛一次，委派） ---------- */
function onClick(e) {
  const t = e.target;
  if (t.closest('[data-add-school]')) { add.open(); return; }
  const app = cur();
  if (!app) return;
  let b;
  if ((b = t.closest('[data-status]'))) return statusMenu(b, app);
  if ((b = t.closest('[data-more]'))) return moreMenu(b, app);
  if ((b = t.closest('[data-act]'))) {
    const a = V.next && V.next.actions[Number(b.dataset.act)];
    if (!a || a.disabled) return;
    if (a.ask) { ST.ask = {key: V.next.key, id: a.id}; ST.focus = '.s-ask input, .s-ask [data-ask-ok]'; rerender(); return; }
    return doAction(app, a);
  }
  if (t.closest('[data-ask-ok]')) { const a = askAction(); if (a) doAction(app, a); return; }
  if (t.closest('[data-ask-cancel]')) { ST.ask = null; rerender(); return; }
  if (t.closest('[data-all]')) { toggle(ST.all, app.id); rerender(); return; }
  if (t.closest('[data-docs-open]')) { toggle(ST.docsOpen, app.id); rerender(); return; }
  if ((b = t.closest('[data-ref-open]'))) { toggle(ST.refOpen, b.dataset.refOpen + ':' + app.id); rerender(); return; }
  // 「改」表單裡的按鈕：先動草稿，儲存時才寫入
  if ((b = t.closest('[data-sched-rm]'))) { D.del.add(b.dataset.schedRm); rerender(); return; }
  if ((b = t.closest('[data-sched-add-rm]'))) { D.adds.splice(Number(b.dataset.schedAddRm), 1); rerender(); return; }
  if ((b = t.closest('[data-sched-restore]'))) {
    const id = b.dataset.schedRestore, d = (app.dates || []).find(x => x.id === id), f = b.closest('form');
    if (!d || !d.bro) return;
    const v = D.rows.get(id) || {label: (f.elements['l:' + id] || {}).value || ''};
    D.rows.set(id, {...v, date: d.bro.date || '', time: d.bro.time || ''});
    D.restore.add(id);
    // 欄位數量沒變時 ui.js 會把重畫前的值放回去，所以先改畫面上的值
    f.elements['d:' + id].value = d.bro.date || ''; f.elements['t:' + id].value = d.bro.time || '';
    ST.focus = `[name="d:${CSS.escape(id)}"]`;
    rerender(); return;
  }
  if (t.closest('[data-add-date]')) { D.adds.push({date: '', time: '', label: ''}); ST.focus = `[name="ad:${D.adds.length - 1}"]`; rerender(); return; }
  if ((b = t.closest('[data-unhide]'))) { act(app.id, 'unhide', {ref: b.dataset.unhide}); return; }
  if ((b = t.closest('[data-doc-rm]'))) { D.docDel.add(b.dataset.docRm); rerender(); return; }
  if ((b = t.closest('[data-doc-add-rm]'))) { D.docAdds.splice(Number(b.dataset.docAddRm), 1); rerender(); return; }
  if (t.closest('[data-doc-more]')) { D.docAdds.push(''); ST.focus = `[name="doc:${D.docAdds.length - 1}"]`; rerender(); return; }
  if ((b = t.closest('[data-unhide-doc]'))) { act(app.id, 'unhideDoc', {ref: b.dataset.unhideDoc}); return; }
}
function onChange(e) {
  const t = e.target, app = cur();
  if (!app) return;
  if (t.matches('[data-tick]')) {
    const key = t.dataset.tick;
    ST.focus = `[data-tick="${CSS.escape(key)}"]`;
    // 勾完最後一個必要的部分（→ 已報名，或那一列做完）：給「復原」
    act(app.id, 'tick', {key, done: t.checked}, {toast: tickToast(app, key, t.checked, V && V.next)});
  } else if (t.matches('[data-doc]')) {
    ST.focus = `[data-doc="${CSS.escape(t.dataset.doc)}"]`;
    act(app.id, 'tickDoc', {docId: t.dataset.doc, done: t.checked});
  }
}
function onInput(e) {
  const t = e.target;
  if (t.dataset.sf) {
    const f = t.dataset.sf;
    if (t.dataset.row) {
      const id = t.dataset.row, form = t.form;
      const v = D.rows.get(id) || {date: form.elements['d:' + id].value, time: form.elements['t:' + id].value, label: (form.elements['l:' + id] || {}).value || ''};
      D.rows.set(id, {...v, [f]: t.value});
    } else if (t.dataset.add != null && D.adds[Number(t.dataset.add)]) D.adds[Number(t.dataset.add)][f] = t.value;
  } else if (t.dataset.docAdd != null) D.docAdds[Number(t.dataset.docAdd)] = t.value;
  else if (t.closest('[data-ask-form]') && ST.ask) ST.ask[t.name] = t.value;
}
function onSubmit(e) {
  const f = e.target.closest('[data-ask-form]');
  if (!f) return;
  e.preventDefault();
  const a = askAction(), app = cur();
  if (!a || !app) return;
  if (a.ask.type === 'number') return doAction(app, a, {no: f.elements.no.value.trim()});
  const date = f.elements.date.value, time = normTime(f.elements.time.value);
  const err = (el, msg) => { el.classList.add('bad'); el.focus(); f.querySelector('[data-ask-err]').textContent = msg; };
  if (!date) return err(f.elements.date, '日期要填');
  if (time === null) return err(f.elements.time, '時間寫成 17:00');
  doAction(app, a, {date, time, id: uid()});
}

export function init() {
  const root = $('#view-schools');
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && ST.ask && e.target.closest('.s-ask')) { e.stopPropagation(); ST.ask = null; rerender(); } });
  onEditSave('sched', saveSched);
  onEditSave('docs', saveDocs);
  onEditSave('rec', saveRec);
}

/* ---------- 畫 ---------- */
export function render(route) {
  const root = $('#view-schools');
  if (!S.apps.length) {
    V = null; ST.id = '';
    root.innerHTML = '<div class="s-none"><p class="empty">還沒有加學校。</p><button class="btn" type="button" data-add-school>＋ 加學校</button></div>';
    return;
  }
  let app = route.id ? appById(route.id) : null;
  // 網址的那間剛被刪掉（8 秒內可以復原）：先顯示別間，但不改網址，復原後就回來
  if (!app) { app = pickDefault(); if (!route.id) setUrl({view: 'schools', id: app.id}); }
  const fresh = app.id !== ST.id;
  if (fresh) {
    ST.id = app.id; ST.ask = null;
    // 簡章更新的標記：打開時先記下來（這次看得到），然後標成看過（下次就不顯示）
    ST.marks = {unseen: syncUnseen(app.id), list: syncMarks(app.id)};
    ackSync(app.id);
  }
  if (!editKey()) D.key = '';
  const p = programOf(app), ag = agendaNow(), first = new Map();
  for (const r of ag.rows) if (!first.has(r.appId)) first.set(r.appId, r);
  const n = first.get(app.id) || null;
  if (ST.ask && (!n || n.key !== ST.ask.key)) ST.ask = null;
  V = {app, p, next: n};
  const cols = $('.s-cols', root), rail = $('.s-rail', root);
  const top = !fresh && cols ? cols.scrollTop : 0, railTop = rail ? rail.scrollTop : 0;
  root.innerHTML = `${railHtml(app.id, first)}<div class="s-page">${headHtml(app, p)}${nextHtml(app, n)}
    <div class="s-cols scroll"><div class="s-mine"><div class="col-h">我的</div>${schedHtml(app)}${docsHtml(app)}${recHtml(app)}</div>${refHtml(app, p)}</div></div>`;
  if (top) $('.s-cols', root).scrollTop = top;
  if (railTop) $('.s-rail', root).scrollTop = railTop;
  // 打勾、回答之後那個元素可能已經不見了（那一列做完）：游標放回「下一步」，不要掉到頁首
  if (ST.focus) { const el = root.querySelector(ST.focus) || (ST.focus.startsWith('[data-tick') ? root.querySelector('.s-next') : null); ST.focus = ''; if (el) el.focus({preventScroll: true}); }
}
