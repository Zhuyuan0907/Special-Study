// 接下來（#next）：所有現在要處理的事，照日期、時間排成一列（logic.agenda）；第一件今天以後的事放大。
// 右邊是選到那一列的細節（預設是放大的那一列）：報名列看備審和簡章重點，面試列看准考證・時間地點，名單／放榜列看公告在哪、之後會怎樣。
// 畫面上能直接按的只有：報名部分和備審的勾、結果按鈕、不去、連結；其他都在右欄的「改」。
import {$, $$, S, esc, now, today, uid, appById, programOf, shortName, schoolName, agendaNow, act, actx, mutate, mutateMany, statusOf, eventsFor, namesOf, actionToast, tickToast} from './core.js';
import * as L from './logic.js';
import {hue, ext, pg, isEditing, editKey, closeEdit, editForm, onEditSave, timeInput, normTime, fromAhead, fromText, methodText, feeText} from './ui.js';

// sel：選到的列（row.key）；ask：按了需要再補一個值的按鈕（備取幾號、報到期限、換到 B 前的確認）
// picked：自己點過別列；沒點過就一直跟著放大的那一列（勾完一件，右欄自動換到下一件）
const V = {sel: '', picked: false, ask: null, rows: new Map(), focalKey: ''};
const root = () => $('#view-next');
const phone = () => matchMedia('(max-width: 600px)').matches;

/* ---------- 文字 ---------- */
// 列的日期標頭：放大的那一組是「今天」＋小字日期；七天以外寫日期＋週幾
function dayHead(date, n) {
  const lab = L.dayLabel(date, n);
  if (/^(今天|明天|後天)$/.test(lab)) return {word: lab, sub: L.fmtDate(date)};
  const m = /^(週.) (\d\d\/\d\d)$/.exec(lab);
  if (m) return {word: m[1], sub: m[2]};
  return {word: '', sub: lab, md: L.md(date), wd: '週' + L.weekday(date)};
}
const when = (date, time, n) => { const lab = L.dayLabel(date, n); return /^(今天|明天|後天|週)/.test(lab) ? lab + (time ? ' ' + time : '') : L.fmtDate(date) + time; };
const dt = (date, time) => L.fmtDate(date) + (time || '');
// 簡章抽出來的條列：去掉開頭的（一）、1.、一、
const lines = (v, k) => (Array.isArray(v) ? v : String(v || '').split('\n')).map(s => String(s).replace(/^\s*(（[一二三四五六七八九十]+）|[(（]?\d+[.)）、]|[一二三四五六七八九十]+、)\s*/, '').trim()).filter(Boolean).slice(0, k);
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const names = ids => namesOf(ids).join('、');
// 換行只在「、」後面，校名不會被拆成兩行
const namesHtml = ids => namesOf(ids).map(x => `<span class="nowrap">${esc(x)}</span>`).join('、');

/* ---------- 左邊：一列一件事 ---------- */
function partsHtml(r, big) {
  return `<span class="nx-parts">${r.parts.map(pt => pt.opt
    ? `<span class="optp">${esc(pt.name)}<span class="opt">（選繳）</span></span>`
    : `<label class="check task${big ? ' lg' : ''}"><input type="checkbox" data-tick="${esc(pt.key)}" data-app="${esc(r.appId)}" data-row="${esc(r.key)}" data-f="tick:${esc(r.appId)}:${esc(pt.key)}"${pt.done ? ' checked' : ''}><span>${esc(pt.name)}${pt.own ? `<span class="own${pt.own === '時間未公布' ? ' unk' : ''}">${esc(pt.own)}</span>` : ''}</span></label>`).join('')}</span>`;
}
function whatHtml(r, big, n) {
  const ticks = r.type === 'do' && r.parts.length && ['reg', 'ticket', 'intent'].includes(r.role);
  const from = fromAhead(r.from, r.fromTime, n) ? `<span class="nx-from">${esc(fromText(r.from, r.fromTime, n))}</span>` : '';
  return (ticks ? partsHtml(r, big) : `<span class="lab">${esc(r.label)}</span>`) + from;
}
function actsHtml(r, big) {
  const q = !!r.question, asking = V.ask && V.ask.key === r.key;
  const out = [];
  r.actions.forEach((a, i) => {
    if (a.kind === 'link') return;
    if (asking) return;
    out.push(`<button type="button" class="btn sm" data-act="${i}" data-key="${esc(r.key)}" data-f="act:${esc(r.key)}:${i}"${a.disabled ? ' disabled' : ''}>${esc(a.label)}</button>`);
  });
  const lk = r.actions.find(a => a.kind === 'link');
  if (lk) out.push(big && !q ? `<a class="btn sm ext" href="${esc(lk.href)}" target="_blank" rel="noopener">${esc(lk.label)}</a>` : ext(lk.href, lk.label));
  return out.join('');
}
// 按了「備取」「遞補上了」「換到 B」之後才出現的小欄位，放在那一列底下
function askHtml(r) {
  const a = r.actions[V.ask.i], k = a.ask, v = V.ask.vals, err = V.ask.err ? `<span class="form-err">${esc(V.ask.err)}</span>` : '';
  const cancel = '<button class="link" type="button" data-ask-cancel>取消</button>';
  if (k.type === 'number') return `<form class="nx-ask" data-ask novalidate autocomplete="off"><label>${esc(k.label)}<input type="number" name="no" min="1" step="1" inputmode="numeric" value="${esc(v.no || '')}" data-f="ask:no"></label><button class="btn sm" type="submit">確定</button>${cancel}${err}</form>`;
  if (k.type === 'datetime') return `<form class="nx-ask" data-ask novalidate autocomplete="off"><label>${esc(k.label)}<input type="date" name="date" value="${esc(v.date || '')}" data-f="ask:date"></label>${timeInput('time', v.time || '', 'data-f="ask:time"')}<button class="btn sm" type="submit">確定</button>${cancel}${err}</form>`;
  return `<div class="nx-ask"><span>${esc(k.text)}</span><button class="btn sm" type="button" data-ask-ok data-f="ask:ok">${esc(k.ok || '確定')}</button>${cancel}</div>`;
}
function rowHtml(r, big, n) {
  const app = appById(r.appId);
  if (!app) return '';
  const cls = ['nx-row', big && 'big', r.overdue && 'over', r.tentative && 'tent', r.key === V.sel && r.key !== V.focalKey && 'tint'].filter(Boolean).join(' ');
  const t = L.timeText(r, n);
  return `<div class="${cls}" data-key="${esc(r.key)}" style="${hue(app)}">`
    + `<span class="t${r.mail ? ' mail' : ''}">${esc(t)}</span>`
    + `<a class="sch s" href="#schools/${encodeURIComponent(app.id)}">${esc(shortName(app))}</a>`
    + `<div class="w">${whatHtml(r, big, n)}</div>`
    + `<div class="nx-acts">${actsHtml(r, big)}</div>`
    + (V.ask && V.ask.key === r.key ? askHtml(r) : '')
    + '</div>';
}
function listHtml(ag, n) {
  const rows = ag.rows, focal = rows[ag.focalIndex] || null, td = today();
  const groups = [];
  for (const r of rows) { let g = groups[groups.length - 1]; if (!g || g.date !== r.date) groups.push(g = {date: r.date, rows: []}); g.rows.push(r); }
  const sw = Math.max(3, ...rows.map(r => [...shortName(appById(r.appId))].length));
  const html = groups.map(g => {
    const isFocal = focal && g.date === focal.date, over = g.rows.every(r => r.overdue);
    const h = dayHead(g.date, n);
    const clash = g.rows.flatMap(r => r.clash && r.clash.length ? [r.appId, ...r.clash] : []);
    let head;
    if (isFocal) head = `<b class="big">${esc(h.word || h.md)}</b><span>${esc(h.word ? h.sub : h.wd)}</span>`;
    else head = h.word ? `<b>${esc(h.word)}</b><span>${esc(h.sub)}</span>` : `<span>${esc(h.sub)}</span>`;
    if (clash.length) head += `<span class="clash">同天：${namesHtml(clash)}</span>`;
    const cls = ['nx-day', isFocal && 'focal', over && 'over', g.date === td && 'today'].filter(Boolean).join(' ');
    return `<section class="${cls}"><h2 class="nx-dh">${head}</h2><div class="nx-rows">${g.rows.map(r => rowHtml(r, isFocal && !r.overdue, n)).join('')}</div></section>`;
  }).join('');
  return `<div class="nx-list scroll" style="--sw:${sw}em">${html}</div>`;
}

/* ---------- 右邊：選到那一列的細節 ---------- */
const sec = (title, body, {right = '', cls = ''} = {}) => body ? `<section class="nx-sec${cls ? ' ' + cls : ''}">${title || right ? `<h3>${title}${right}</h3>` : ''}${body}</section>` : '';
const dl = (items, cls = 'nx-dl') => { const it = items.filter(([, v]) => v); return it.length ? `<dl class="${cls}">${it.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : ''; };
const page1 = p => (p && Array.isArray(p.pg) && p.pg[0]) || '';
// 簡章（唯讀、13px 灰字）：一個區塊，標題旁邊是 p.N ↗
const bro = (app, p, items) => { const body = dl(items); return body ? sec('簡章', body, {right: pg(app, page1(p)), cls: 'ref-sec'}) : ''; };

function docsSec(app) {
  const docs = app.docs || [];
  if (!docs.length) return '';
  const req = docs.filter(d => !d.opt), done = req.filter(d => d.done).length;
  const items = docs.map(d => d.opt
    ? `<p class="optdoc"${d.full ? ` title="${esc(d.full)}"` : ''}>${esc(d.name)}<span class="opt">（選繳）</span></p>`
    : `<label class="check task${d.src === 'placeholder' ? ' ph' : ''}"${d.full ? ` title="${esc(d.full)}"` : ''}><input type="checkbox" data-doc="${esc(d.id)}" data-app="${esc(app.id)}" data-f="doc:${esc(d.id)}"${d.done ? ' checked' : ''}><span>${esc(d.name)}</span></label>`).join('');
  return sec('備審', `<div class="nx-docs">${items}</div>`, {right: req.length ? `<span class="count">${done}／${req.length}</span>` : ''});
}
// 寄件／上傳：簡章附註優先；沒有就從郵戳／寄達／上傳推出一句
function sendLine(r) {
  const pt = r.parts.find(x => x.key === 'docs');
  if (!pt) return null;
  const sendBy = pt.sendBy || r.sendBy;
  if (pt.mail) return ['寄件', esc(r.note || (pt.mail === 'arrive' ? '郵寄，寄達為憑' : '郵寄，郵戳為憑')) + (sendBy ? `<br>最晚 ${esc(L.fmtDate(sendBy))} 寄出` : '')];
  return [/上傳/.test(pt.name) ? '上傳' : '繳件', esc(r.note || (/上傳/.test(pt.name) ? '網路上傳' : ''))];
}
function regPanel(app, p, r) {
  const evs = eventsFor(app);
  const same = (r.sameDay || []).map(s => { const e = evs.find(x => x.role === 'go' && x.date === s.date); return `${L.md(s.date)} ${e ? e.label : '面試'}和 ${names(s.with)} 同一天`; });
  const fmt = p ? lines(p.fmt, 2).map(esc).join('<br>') : '';
  return docsSec(app)
    + bro(app, p, [sendLine(r) || ['', ''], ['報名費', esc(feeText((p && p.fee) || app.fee))], ['甄選', esc(methodText(p))], ['名額', p && p.q != null ? esc(p.q + ' 名') : ''], ['格式', fmt]])
    + (same.length ? `<section class="nx-sec"><p class="fact">${same.map(esc).join('<br>')}</p></section>` : '');
}
// 面試／筆試：准考證號、時間、地點是自己記的（改）；面試注意、甄選方式是簡章的
function goPanel(app, p, r) {
  const key = 'nxrec:' + app.id;
  const f = [['regNo', '准考證號', app.regNo || ''], ['ivTime', '時間', app.ivTime || ''], ['place', '地點', app.place || '']];
  let mine;
  if (isEditing(key)) {
    mine = sec('准考證・時間地點', editForm(key, f.map(([k, l, v]) => `<label class="edit-row" style="--cols: 4.5em minmax(0, 1fr)"><span>${l}</span>${k === 'ivTime' ? timeInput(k, v) : `<input type="text" name="${k}" value="${esc(v)}">`}</label>`).join('') + '<p class="form-err" data-err></p>'));
  } else if (f.some(x => x[2])) {
    mine = sec('准考證・時間地點', dl(f.map(([, l, v]) => [l, esc(v)]), 'nx-kv'), {right: `<button class="link edit" type="button" data-edit="${esc(key)}">改</button>`});
  } else {
    mine = `<section class="nx-sec"><button class="link" type="button" data-edit="${esc(key)}" data-f="rec:${esc(app.id)}">＋ 記准考證號・時間・地點</button></section>`;
  }
  const ivn = p ? lines(p.ivn, 3).map(esc).join('<br>') : '';
  return (r.context ? `<section class="nx-sec"><p class="ctx">${esc(r.context)}</p></section>` : '')
    + mine + bro(app, p, [['注意', ivn], ['甄選', esc(methodText(p))]]);
}
// 名單、放榜、遞補公告：公告在哪裡、之後會怎樣
function checkPanel(app, p, r) {
  const lk = r.actions.find(a => a.kind === 'link');
  const evs = eventsFor(app).filter(e => e.date >= r.date);
  let next = r.context ? [esc(r.context)] : [];
  if (!next.length && r.role === 'release') {
    const conf = evs.find(e => e.role === 'confirm'), it = evs.find(e => e.role === 'intent');
    if (conf) next.push(`正取：${esc(dt(conf.date, conf.time))} 前報到`);
    if (it) next.push(`備取：${esc(dt(it.date, it.time))} 前${esc(it.label)}`);
  }
  if (!next.length && r.role === 'notice') { const go = evs.find(e => e.role === 'go'); if (go) next.push(`${esc(dt(go.date, go.time))} ${esc(go.label)}`); }
  return sec('', dl([['公告', lk ? ext(lk.href, host(lk.href)) : ''], ['之後', next.join('<br>')]], 'nx-kv'))
    + bro(app, p, [['甄選', esc(methodText(p))], ['名額', p && p.q != null ? esc(p.q + ' 名') : ''], ['報到', r.role === 'waitcheck' && p ? lines(p.cw, 2).map(esc).join('<br>') : '']]);
}
// 報到、放棄、遞補意願、印准考證：方式（簡章）、還有幾間在等結果
function decidePanel(app, p, r) {
  const how = r.note || (p && (r.role === 'confirm' || r.role === 'intent') ? lines(p.cw, 2).join('\n') : '');
  return (r.context ? `<section class="nx-sec"><p class="ctx">${esc(r.context)}</p></section>` : '')
    + bro(app, p, [['方式', esc(how).replace(/\n/g, '<br>')]]);
}
function panelHtml(r) {
  if (!r) return '<aside class="nx-side scroll" aria-label="細節"></aside>';
  const app = appById(r.appId), p = programOf(app);
  if (!app) return '<aside class="nx-side scroll" aria-label="細節"></aside>';
  const {main, quals} = L.splitDept(app.dept || '');
  const body = r.role === 'reg' ? regPanel(app, p, r)
    : r.role === 'go' ? goPanel(app, p, r)
    : r.type === 'check' ? checkPanel(app, p, r)
    : decidePanel(app, p, r);
  return `<aside class="nx-side scroll" aria-label="細節" data-k="${esc(r.key)}" style="${hue(app)}">`
    + `<div class="nx-ph"><a class="sch" href="#schools/${encodeURIComponent(app.id)}">${esc(schoolName(app))}</a><span class="dept">${esc([main, ...quals].join(' '))}</span><span class="st">${esc(statusOf(app))}</span></div>`
    + body
    + `<p class="nx-open"><a class="link" href="#schools/${encodeURIComponent(app.id)}">打開 ${esc(shortName(app))} →</a></p></aside>`;
}

/* ---------- 沒有事 ---------- */
function emptyHtml(ag, n) {
  if (!S.apps.length) return `<div class="nx-empty"><p class="empty">還沒有加學校。</p><button class="btn" type="button" data-add>＋ 加學校</button></div>`;
  const u = ag.upcoming, a = u && appById(u.appId);
  return `<div class="nx-empty"><p class="empty">現在沒有要處理的事。</p>${a ? `<p class="nx-up">下一個日期　<span class="when">${esc(when(u.date, u.time, n))}</span>　<a class="sch" href="#schools/${encodeURIComponent(a.id)}" style="${hue(a)}">${esc(shortName(a))}</a> ${esc(u.label)}</p>` : ''}</div>`;
}

/* ---------- 畫面 ---------- */
export function render() {
  const el = root();
  if (!el) return;
  const n = now(), ag = agendaNow(), rows = ag.rows;
  V.rows = new Map(rows.map(r => [r.key, r]));
  const focal = rows[ag.focalIndex] || rows[0] || null;
  V.focalKey = focal ? focal.key : '';
  if (!V.picked || !V.rows.has(V.sel)) { V.sel = V.focalKey; V.picked = false; }
  if (V.ask && !V.rows.has(V.ask.key)) V.ask = null;
  // 重畫前記下捲到哪裡、游標在哪個勾上，畫完放回去
  const l0 = $('.nx-list', el), s0 = $('.nx-side', el), ae = document.activeElement;
  const keep = {l: l0 ? l0.scrollTop : 0, s: s0 && s0.dataset.k === V.sel ? s0.scrollTop : 0, f: ae && el.contains(ae) && ae.dataset ? ae.dataset.f || '' : ''};
  el.classList.toggle('is-empty', !rows.length);
  el.innerHTML = rows.length ? listHtml(ag, n) + panelHtml(V.rows.get(V.sel)) : emptyHtml(ag, n);
  const l1 = $('.nx-list', el), s1 = $('.nx-side', el);
  if (l1) l1.scrollTop = keep.l;
  if (s1) s1.scrollTop = keep.s;
  const f = keep.f && el.querySelector(`[data-f="${CSS.escape(keep.f)}"]`);
  if (f) f.focus({preventScroll: true});
  if (V.ask && V.ask.focus) { V.ask.focus = false; const i = el.querySelector('.nx-ask input, .nx-ask [data-ask-ok]'); if (i) i.focus({preventScroll: true}); }
}
// 換選到的列：只換右欄，不重畫左邊（不然正在按的勾會被換掉）
function select(key, {reveal = false} = {}) {
  if (!V.rows.has(key)) return;
  const el = root();
  V.picked = key !== V.focalKey;
  if (key !== V.sel) {
    V.sel = key;
    // 右欄的「改」還開著就關掉；等這次點擊（可能是勾選）處理完再重畫
    if (editKey().startsWith('nxrec:')) setTimeout(closeEdit, 0);
    // 放大的那一列本來就是預設，不另外上底色
    for (const r of $$('.nx-row', el)) r.classList.toggle('tint', r.dataset.key === key && key !== V.focalKey);
    const old = $('.nx-side', el);
    if (old) old.outerHTML = panelHtml(V.rows.get(key));
  }
  if (reveal && phone()) { const s = $('.nx-side', el); if (s) s.scrollIntoView({block: 'start', behavior: 'smooth'}); }
}

/* ---------- 動作 ---------- */
// 提示（core.actionToast）：狀態有變就寫新的狀態字（「已記下：北市大 已報名」），附復原
function run(r, a, payload) {
  const app = appById(r.appId);
  if (!app) return;
  payload = payload || a.payload || {};
  const list = [[app.id, x => L.applyAction(x, a.id, payload, actx(x))]];
  for (const o of a.also || []) if (appById(o.appId)) list.push([o.appId, x => L.applyAction(x, o.id, o.payload || {}, actx(x))]);
  V.ask = null;
  mutateMany(list, {toast: actionToast(app, a.id, payload)});
}
function onAct(key, i) {
  const r = V.rows.get(key), a = r && r.actions[i];
  if (!a || a.disabled) return;
  V.sel = key; V.picked = key !== V.focalKey;
  if (a.ask) { V.ask = {key, i, vals: {}, err: '', focus: true}; render(); return; }
  run(r, a);
}
function submitAsk(form) {
  const r = V.ask && V.rows.get(V.ask.key), a = r && r.actions[V.ask.i];
  if (!a) return;
  const k = a.ask, fe = form.elements;
  if (k.type === 'number') {
    const v = String(fe.no.value || '').trim();
    if (v && !(parseInt(v, 10) > 0)) { V.ask.err = '寫一個數字'; render(); return; }
    run(r, a, {no: v ? parseInt(v, 10) : null});
  } else if (k.type === 'datetime') {
    const d = fe.date.value, t = normTime(fe.time.value);
    if (!d) { V.ask.err = '日期要填'; render(); return; }
    if (t === null) { V.ask.err = '時間寫成 17:00'; render(); return; }
    run(r, a, {date: d, time: t, id: uid()});
  }
}
// 勾完最後一個部分，那一列會消失：給提示和復原（狀態變了就寫新的狀態字，例如「已報名」）
function tick(appId, key, done, rowKey) {
  const app = appById(appId);
  if (!app) return;
  act(appId, 'tick', {key, done}, {toast: tickToast(app, key, done, V.rows.get(rowKey))});
}

export function init() {
  const el = root();
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-tick]')) tick(t.dataset.app, t.dataset.tick, t.checked, t.dataset.row);
    else if (t.matches('[data-doc]')) act(t.dataset.app, 'tickDoc', {docId: t.dataset.doc, done: t.checked});
  });
  el.addEventListener('click', e => {
    const t = e.target;
    const b = t.closest('[data-act]');
    if (b) { e.preventDefault(); onAct(b.dataset.key, Number(b.dataset.act)); return; }
    if (t.closest('[data-ask-cancel]')) { V.ask = null; render(); return; }
    if (t.closest('[data-ask-ok]')) { const r = V.ask && V.rows.get(V.ask.key); if (r) run(r, r.actions[V.ask.i]); return; }
    if (t.closest('[data-add]')) { $('#btn-add').click(); return; }
    const row = t.closest('.nx-row');
    if (row && !t.closest('a')) select(row.dataset.key, {reveal: !t.closest('label, button, input, form')});
  });
  el.addEventListener('submit', e => { const f = e.target.closest('[data-ask]'); if (f) { e.preventDefault(); submitAsk(f); } });
  // 打到一半的值記著：每分鐘重畫或回到網頁重新載入時不會不見
  el.addEventListener('input', e => { if (V.ask && e.target.closest('[data-ask]') && e.target.name) V.ask.vals[e.target.name] = e.target.value; });
  el.addEventListener('keydown', e => { if (e.key === 'Escape' && V.ask) { e.preventDefault(); e.stopPropagation(); V.ask = null; render(); } });
  // 右欄「准考證・時間地點」的改
  onEditSave('nxrec', (form, key) => {
    const id = key.slice(key.indexOf(':') + 1), fe = form.elements;
    const t = normTime(fe.ivTime.value);
    if (t === null) { const er = form.querySelector('[data-err]'); if (er) er.textContent = '時間寫成 17:00'; fe.ivTime.classList.add('bad'); return false; }
    mutate(id, a => L.applyAction(a, 'editRecord', {regNo: fe.regNo.value.trim(), ivTime: t, place: fe.place.value.trim()}, actx(a)));
  });
}
// 給測試用：現在選到哪一列
export const state = () => ({sel: V.sel, focal: V.focalKey, ask: V.ask && {key: V.ask.key, i: V.ask.i}});
