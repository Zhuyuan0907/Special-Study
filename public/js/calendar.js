// 行事曆（#calendar）：月和週兩種看法，按 M／W 切換（跟 Google 日曆一樣），T 回到今天，J／K 或 ←／→ 前後翻。
// 網址：#calendar（現在，用上次的看法）、#calendar/2026-12（月）、#calendar/2026-12-04（那一天所在的週）。
// 畫的是 logic.calendarItems：接下來的列、還沒到那個階段的名單・面試・放榜（報名時就看得到面試在哪天，畫淡），
// 過去或做完的（灰）。再加上大考日期（設定裡可以關）。
// 月：一件事一行。放不下時先換短的寫法（「報名・繳費・郵寄備審」→「報名」），還放不下才換行；
//     格子真的滿了，先收做完的、還沒到的，寫「還有 N 件」，點了在旁邊列出那天全部。
// 週：七欄，每件事寫完整（時間、學校、要做什麼、各部分的時間、名單公布後才確定…），今天那欄有現在的線。
// 點一件事：旁邊打開詳細（日期、要做的部分、簡章附註、同一天還有誰、報名系統），那間學校的其他事留著、別的變淡。
import {$, $$, esc, now, today, appById, schoolName, deptName, statusOf, seasonItems, calendarNow, ls} from './core.js';
import {hue, icon, mdw} from './ui.js';
import {go, onRoute} from './router.js';
import * as settings from './settings.js';
import * as L from './logic.js';

const WD = ['一', '二', '三', '四', '五', '六', '日'];
const pad = n => String(n).padStart(2, '0');
const utc = d => new Date(d + 'T00:00:00Z');
const isMonth = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
const isDay = s => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s || '') && !isNaN(utc(s)) && utc(s).toISOString().slice(0, 10) === s;
const thisMonth = () => today().slice(0, 7);
const monday = d => L.addDays(d, -((utc(d).getUTCDay() + 6) % 7));
function shift(m, n) {
  const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
// 月：從包含 1 號那週的週一，到包含月底那週的週日（4–6 週）
function monthCells(m) {
  const first = m + '-01', start = monday(first);
  const days = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
  const n = Math.ceil((L.daysBetween(start, first) + days) / 7) * 7;
  return Array.from({length: n}, (_, i) => L.addDays(start, i));
}
const weekCells = d => Array.from({length: 7}, (_, i) => L.addDays(monday(d), i));

/* ---------- 看法、焦點日 ---------- */
// focus：目前「選到」的那一天。週＝包含它的那週；換成月＝它的那個月；在月裡點日期＝那天的週。
let mode = 'month', focus = '';
function read(route) {
  const arg = (route && route.month) || '';
  if (isDay(arg)) return {mode: 'week', focus: arg};
  if (isMonth(arg)) return {mode: 'month', focus: arg === thisMonth() ? today() : focus && focus.slice(0, 7) === arg ? focus : arg + '-01'};
  return {mode: ls.get('calMode', 'month') === 'week' ? 'week' : 'month', focus: today()};
}
function goTo(m, f) {
  ls.set('calMode', m);
  const t = today();
  const arg = m === 'month' ? (f.slice(0, 7) === t.slice(0, 7) ? '' : f.slice(0, 7)) : (monday(f) === monday(t) ? '' : f);
  const before = location.hash;
  mode = m; focus = f;
  go({view: 'calendar', month: arg});
  if (location.hash === before) render({view: 'calendar', month: arg});   // 網址沒變（例如在這個月按 W）：自己重畫
}
function step(n) {
  if (mode === 'week') { goTo('week', L.addDays(focus, 7 * n)); return; }
  const m = shift(focus.slice(0, 7), n);
  goTo('month', m === thisMonth() ? today() : m + '-01');
}

/* ---------- 一件事的寫法 ---------- */
// 格子已經是那一天，所以郵戳類只寫「郵戳」「寄達」
const timeOf = r => r.time || (r.mail === 'postmark' ? '郵戳' : r.mail === 'arrive' ? '寄達' : '');
// 完整的：報名列只寫還沒勾的必繳部分（做完的列寫全部）；好幾天的接「～12/06」
function fullLabel(r) {
  let s = r.label;
  if (r.role === 'reg') {
    const open = r.parts.filter(p => !p.opt && !p.done);
    s = (open.length && r.state !== 'done' ? open : r.parts).map(p => p.name).join('・');
  } else if (r.role === 'confirm') s = '報到';
  else if (r.role === 'giveup') s = '放棄期限';
  return s + (r.end ? `～${L.md(r.end)}` : '');
}
// 短的：一個詞
const SHORT = {stage1: '名單', notice: '公告', release: '放榜', confirm: '報到', giveup: '放棄期限', intent: '遞補意願', waitcheck: '遞補公告'};
function shortLabel(r) {
  if (r.role === 'reg') { const open = r.parts.filter(p => !p.opt && !p.done); return ((open.length && r.state !== 'done' ? open : r.parts)[0] || {name: r.label}).name; }
  if (r.role === 'go') return r.label.length > 4 ? (L.KIND_LABEL[r.kind] || '面試') : r.label;
  return SHORT[r.role] || r.label;
}
// 換行只在「・」後面（繳費不會拆成「繳／費」）。用零寬空白不用 <wbr>：Chrome 在 nowrap 裡還是會在 <wbr> 換行。
const wbr = s => esc(s).replace(/・/g, '・\u200b');
// 週和「還有 N 件」：每個部分寫出來，做完的灰
function partsHtml(r) {
  if (r.role !== 'reg' || !r.parts.length) return wbr(fullLabel(r));
  const ps = r.state === 'done' ? r.parts : r.parts.filter(p => !p.opt || p.done);
  return ps.map(p => `<span class="pt${p.done && r.state !== 'done' ? ' did' : ''}">${esc(p.name)}</span>`).join('・\u200b') + (r.end ? `～${esc(L.md(r.end))}` : '');
}
// 第三行：各部分自己的時間、郵戳、名單公布後才確定、合併的系
function extraLines(r) {
  const out = [];
  if (r.role === 'reg') {
    const own = r.parts.filter(p => !p.done || r.state === 'done').map(p => {
      const t = p.own != null ? p.own : (p.mail ? (p.mail === 'postmark' ? '郵戳為憑' : '寄達為憑') : p.time && p.time !== r.time ? p.time : '');
      return t ? `${p.name} ${t}` : '';
    }).filter(Boolean);
    if (own.length) out.push(own.join('・'));
  }
  if (r.context && r.state !== 'done') out.push(r.context);
  if (r.appIds.length > 1) out.push(r.appIds.map(appById).filter(Boolean).map(deptName).join('、'));
  return out;
}
const STATE_RANK = {done: 0, later: 1, tent: 2, now: 3, late: 4};

/* ---------- 每一天的事情 ---------- */
let byKey = new Map(), clashDays = new Map();
function dayMap(from, to) {
  const data = calendarNow();
  byKey = new Map(data.items.map(r => [r.key, r]));
  clashDays = data.clashDays || new Map();
  const by = new Map();
  const add = (d, it) => { if (d >= from && d <= to) (by.get(d) || by.set(d, []).get(d)).push(it); };
  // 大考日期是整天的事：排在那天最前面
  for (const s of seasonItems()) for (let d = s.date, i = 0; d <= (s.end || s.date) && i < 14; d = L.addDays(d, 1), i++) add(d, {season: s});
  for (const r of data.items) if (appById(r.appId)) add(r.date, {row: r});
  return by;
}
const seasonText = s => s.label + (s.tentative ? '（暫定）' : '');
const itemAttrs = r => `href="#schools/${esc(encodeURIComponent(r.appId))}" data-k="${esc(r.key)}" data-s="${esc(r.school)}" data-st="${r.state}" style="${hue(appById(r.appId))}"`;
const cls = (base, r) => [base, r.state, r.type].join(' ');

function monthItem(it) {
  if (it.season) return `<div class="ci season" data-st="season"><span class="ci-l">${esc(seasonText(it.season))}</span></div>`;
  const r = it.row, t = timeOf(r), full = fullLabel(r), short = shortLabel(r);
  const tip = [t, r.name, full].filter(Boolean).join(' ');
  return `<a class="${cls('ci', r)}" ${itemAttrs(r)} title="${esc(tip)}">${t ? `<span class="ci-t">${esc(t)}</span> ` : ''}<span class="sch">${esc(r.name)}</span> <span class="ci-l"><span class="v-full">${wbr(full)}</span>${short !== full ? `<span class="v-short">${esc(short)}</span>` : ''}</span></a>`;
}
function weekItem(it) {
  if (it.season) return `<div class="wi season"><div class="wi-l">${esc(seasonText(it.season))}</div></div>`;
  const r = it.row, t = timeOf(r);
  return `<a class="${cls('wi', r)}" ${itemAttrs(r)}>
    <div class="wi-1">${t ? `<span class="wi-t">${esc(t)}</span>` : ''}<span class="sch">${esc(r.name)}</span></div>
    <div class="wi-l">${partsHtml(r)}</div>
    ${extraLines(r).map(x => `<div class="wi-x">${esc(x)}</div>`).join('')}
  </a>`;
}
// 今天那欄：現在的線畫在已經過了的時間和還沒到的中間（沒有時間的是整天，在線的上面）
function withNowLine(items, d) {
  if (d !== today() || !items.length) return items.map(weekItem).join('');
  const t = now().slice(11, 16);
  let at = items.findIndex(it => it.row && it.row.time && it.row.time > t);
  if (at < 0) at = items.length;
  const html = items.map(weekItem);
  html.splice(at, 0, '<div class="now-line" aria-hidden="true"></div>');
  return html.join('');
}

/* ---------- 畫 ---------- */
function title(days) {
  const a = days[0], b = days[days.length - 1];
  if (mode === 'month') return `${+focus.slice(0, 4)} 年 ${+focus.slice(5, 7)} 月`;
  if (a.slice(0, 7) === b.slice(0, 7)) return `${+a.slice(0, 4)} 年 ${+a.slice(5, 7)} 月`;
  if (a.slice(0, 4) === b.slice(0, 4)) return `${+a.slice(0, 4)} 年 ${+a.slice(5, 7)}–${+b.slice(5, 7)} 月`;
  return `${+a.slice(0, 4)} 年 ${+a.slice(5, 7)} 月 – ${+b.slice(0, 4)} 年 ${+b.slice(5, 7)} 月`;
}
function head(days) {
  const unit = mode === 'week' ? '週' : '個月';
  return `<div class="cal-h">
    <h1>${title(days)}</h1>
    <div class="cal-nav">
      <button class="icon-btn" type="button" data-step="-1" aria-label="上一${unit}" title="上一${unit}（K）">${icon('left')}</button>
      <button class="icon-btn" type="button" data-step="1" aria-label="下一${unit}" title="下一${unit}（J）">${icon('chevron')}</button>
      <button class="btn sm" type="button" data-today title="今天（T）">今天</button>
    </div>
    <div class="cal-mode" role="group" aria-label="看法">
      <button class="btn sm" type="button" data-mode="week" aria-pressed="${mode === 'week'}" title="週（W）">週</button>
      <button class="btn sm" type="button" data-mode="month" aria-pressed="${mode === 'month'}" title="月（M）">月</button>
    </div>
    <button class="btn quiet sm cal-sub" type="button" data-subscribe>訂閱</button>
  </div>`;
}
const clashMark = d => clashDays.has(d) ? `<span class="cd-x" title="${esc(clashDays.get(d).join('、'))} 同一天面試">同天</span>` : '';

function monthHtml(list, by) {
  const m = focus.slice(0, 7), t = today(), n = now();
  const inMonth = d => d.slice(0, 7) === m;
  let any = false;
  const grid = list.map(d => {
    const items = by.get(d) || [];
    if (items.length && inMonth(d)) any = true;
    const c = ['cd', inMonth(d) ? '' : 'out', d < t ? 'past' : '', d === t ? 'today' : '', items.length ? '' : 'none'].filter(Boolean).join(' ');
    const num = inMonth(d) && d.slice(8) !== '01' ? String(+d.slice(8)) : `${+d.slice(5, 7)}/${+d.slice(8)}`;
    return `<div class="${c}" data-date="${d}">
      <div class="cd-h"><button class="cd-n" type="button" data-week="${d}" aria-label="看 ${esc(mdw(d))} 那週">${num}</button>${d === t ? '<span class="cd-today">今天</span>' : ''}<span class="cd-w">${esc(L.dayLabel(d, n))}</span>${clashMark(d)}</div>
      <div class="cd-i">${items.map(monthItem).join('')}<button class="link cd-more" type="button" data-more="${d}" hidden></button></div>
    </div>`;
  }).join('');
  return `<div class="cal-wd" aria-hidden="true">${WD.map(w => `<span>${w}</span>`).join('')}</div>
    <div class="cal-g" style="--weeks:${list.length / 7}">${grid}</div>
    ${any ? '' : '<p class="empty cal-empty">這個月沒有事情。</p>'}`;
}
function weekHtml(days, by) {
  const t = today(), n = now();
  const num = d => d.slice(8) === '01' ? `${+d.slice(5, 7)}/1` : String(+d.slice(8));
  const any = days.some(d => (by.get(d) || []).length);
  return `<div class="wk">
    <div class="wk-h">${days.map((d, i) => `<div class="wk-d${d === t ? ' today' : d < t ? ' past' : ''}"><span class="wk-w">${WD[i]}</span><span class="wk-n">${num(d)}</span>${d === t ? '<span class="cd-today">今天</span>' : ''}${clashMark(d)}</div>`).join('')}</div>
    <div class="wk-b scroll">${days.map(d => {
      const items = by.get(d) || [];
      return `<div class="wk-c${d === t ? ' today' : d < t ? ' past' : ''}${items.length ? '' : ' none'}" data-date="${d}"><div class="wk-cl">${esc(L.dayLabel(d, n))}${clashMark(d)}</div>${withNowLine(items, d)}</div>`;
    }).join('')}</div>
    ${any ? '' : '<p class="empty cal-empty">這週沒有事情。</p>'}
  </div>`;
}

let shown = '';
export function render(route) {
  const root = $('#view-calendar');
  if (!root) return;
  ({mode, focus} = read(route));
  ls.set('calMode', mode);   // 上一頁回到週也算：下次按「行事曆」分頁還是週
  const days = mode === 'week' ? weekCells(focus) : monthCells(focus.slice(0, 7));
  const by = dayMap(days[0], days[days.length - 1]);
  const keepScroll = mode === 'week' && shown === 'week:' + monday(focus) ? ($('.wk-b', root) || {}).scrollTop || 0 : 0;
  root.innerHTML = `<div class="cal ${mode}">${head(days)}${mode === 'week' ? weekHtml(days, by) : monthHtml(days, by)}</div>`;
  shown = mode + ':' + (mode === 'week' ? monday(focus) : focus.slice(0, 7));
  if (keepScroll) $('.wk-b', root).scrollTop = keepScroll;
  fit();
  refreshPop();
}

// 月：先把放不下一行的換成短的寫法，短的也放不下才換行；格子還是滿了，從做完的、還沒到的開始收，寫「還有 N 件」。
// 視窗窄（整頁捲動）時格子會長高、一件事可以換行，這裡就不用收。
function fit() {
  const g = $('#view-calendar .cal-g');
  if (!g || !g.clientHeight) return;
  const all = $$('.ci', g), boxes = $$('.cd-i', g);
  for (const it of all) { it.hidden = false; it.classList.remove('s1', 'wrap'); }
  for (const b of boxes) b.querySelector('.cd-more').hidden = true;
  const over = el => el.scrollWidth > el.clientWidth + 1;
  const long = all.filter(over);
  for (const it of long) it.classList.add(it.querySelector('.v-short') ? 's1' : 'wrap');
  for (const it of long.filter(it => it.classList.contains('s1') && over(it))) it.classList.add('wrap');
  for (const box of boxes) {
    if (box.scrollHeight <= box.clientHeight + 1) continue;
    const more = box.querySelector('.cd-more');
    more.hidden = false;
    const order = $$('.ci', box).map((el, i) => ({el, i, p: el.dataset.st === 'season' ? 1.5 : STATE_RANK[el.dataset.st] ?? 3})).sort((a, b) => a.p - b.p || b.i - a.i);
    let n = 0;
    for (const o of order) {
      o.el.hidden = true; n++;
      more.textContent = `還有 ${n} 件`;
      if (box.scrollHeight <= box.clientHeight + 1) break;
    }
  }
}

/* ---------- 詳細（點一件事、點「還有 N 件」） ---------- */
let pop = null;   // {key} 或 {day}
const popEl = () => {
  let el = $('#cal-pop');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cal-pop'; el.className = 'cal-pop'; el.hidden = true; el.tabIndex = -1;
    el.setAttribute('role', 'dialog');
    el.addEventListener('click', e => { if (e.target.closest('[data-pop-close]')) closePop(); });
    document.body.appendChild(el);
  }
  return el;
};
function itemPop(r) {
  const apps = r.appIds.map(appById).filter(Boolean), app = apps[0];
  const when = `${mdw(r.date)}${r.time ? ' ' + r.time : ''}${r.end ? ` – ${mdw(r.end)}` : ''}`;
  const mailWord = r.mail === 'postmark' ? '郵戳為憑' : r.mail === 'arrive' ? '寄達為憑' : '';
  const others = r.role === 'go' && clashDays.has(r.date) ? clashDays.get(r.date).filter(s => s !== r.school) : [];
  const links = (r.actions || []).filter(a => a.kind === 'link' && a.href).map(a => `<a class="btn sm ext" href="${esc(a.href)}" target="_blank" rel="noopener">${esc(a.label)}</a>`);
  const depts = apps.map(a => apps.length > 1 ? `<a class="link" href="#schools/${esc(encodeURIComponent(a.id))}">${esc(deptName(a))}</a>` : esc(deptName(a))).join('、');
  const lines = [
    r.from && r.state !== 'done' ? `${L.md(r.from)}${r.fromTime ? ' ' + r.fromTime : ''} 起` : '',
    ...extraLines(r).filter(x => !(apps.length > 1 && x === apps.map(deptName).join('、'))),
    others.length ? `同一天面試：${others.join('、')}` : '',
  ].filter(Boolean);
  return `<div class="pop-h"><span class="sch" style="${hue(app)}">${esc(schoolName(app))}</span><span class="pop-dept">${depts}</span><button class="icon-btn" type="button" data-pop-close aria-label="關閉">${icon('close')}</button></div>
    <p class="pop-when">${esc(when)}${!r.time && mailWord ? `　${mailWord}` : ''}</p>
    <p class="pop-what">${partsHtml(r)}</p>
    ${lines.map(x => `<p class="pop-x">${esc(x)}</p>`).join('')}
    ${r.note ? `<p class="ref pop-note">${esc(r.note)}</p>` : ''}
    <div class="pop-foot"><span class="pop-st">${esc(apps.map(statusOf).filter((s, i, a) => a.indexOf(s) === i).join('、'))}</span>${links.join('')}${apps.length > 1 ? '' : `<a class="btn sm" href="#schools/${esc(encodeURIComponent(app.id))}">打開學校</a>`}</div>`;
}
function dayPop(d) {
  const items = dayMap(d, d).get(d) || [];
  return `<div class="pop-h"><span class="pop-day">${esc(mdw(d))}</span><span class="pop-dept">${esc(L.dayLabel(d, now()) === mdw(d) ? '' : L.dayLabel(d, now()))}</span><button class="icon-btn" type="button" data-pop-close aria-label="關閉">${icon('close')}</button></div>
    <div class="pop-list">${items.map(weekItem).join('')}</div>`;
}
function place(el, anchor) {
  const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, gap = 8;
  // 先放在右邊，放不下放左邊，再放不下就放在下面；上下都夾在視窗裡
  let left = r.right + gap, top = r.top - 6;
  if (left + w > innerWidth - 12) left = r.left - gap - w;
  if (left < 12) { left = Math.max(12, Math.min(r.left, innerWidth - w - 12)); top = r.bottom + gap; if (top + h > innerHeight - 12) top = r.top - gap - h; }
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(Math.max(12, Math.min(top, innerHeight - h - 12))) + 'px';
}
function focusSchool(school, key) {
  const cal = $('#view-calendar .cal');
  if (!cal) return;
  cal.classList.toggle('focus', !!school);
  for (const el of $$('[data-k]', cal)) { el.classList.toggle('hl', !!school && el.dataset.s === school); el.classList.toggle('cur', !!key && el.dataset.k === key); }
}
function openItem(anchor) {
  const r = byKey.get(anchor.dataset.k);
  if (!r) return;
  const el = popEl();
  el.innerHTML = itemPop(r);
  el.setAttribute('aria-label', `${r.name} ${fullLabel(r)}`);
  el.hidden = false;
  place(el, anchor);
  pop = {key: r.key};
  focusSchool(r.school, r.key);
  el.focus({preventScroll: true});
}
function openDay(anchor, d) {
  const el = popEl();
  el.innerHTML = dayPop(d);
  el.setAttribute('aria-label', mdw(d));
  el.hidden = false;
  place(el, anchor);
  pop = {day: d};
  focusSchool('', '');
  el.focus({preventScroll: true});
}
export function closePop() {
  if (!pop) return false;
  pop = null;
  const el = $('#cal-pop');
  if (el) el.hidden = true;
  focusSchool('', '');
  return true;
}
// 重畫之後：那件事還在就跟著它，不在了就關掉
function refreshPop() {
  if (!pop) return;
  const root = $('#view-calendar');
  const a = pop.key ? $(`[data-k="${CSS.escape(pop.key)}"]`, root) : $(`[data-more="${pop.day}"]`, root);
  if (!a || a.hidden || !a.getClientRects().length) { closePop(); return; }
  if (pop.key) openItem(a); else openDay(a, pop.day);
}

/* ---------- 快速鍵（app.js 在行事曆畫面時交給這裡） ---------- */
export function key(e) {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 'w') { closePop(); goTo('week', focus || today()); return true; }
  if (k === 'm') { closePop(); goTo('month', focus || today()); return true; }
  if (k === 't') { closePop(); goTo(mode, today()); return true; }
  if (k === 'j' || k === 'ArrowRight') { closePop(); step(1); return true; }
  if (k === 'k' || k === 'ArrowLeft') { closePop(); step(-1); return true; }
  return false;
}

export function init() {
  const root = $('#view-calendar');
  root.addEventListener('click', e => {
    const s = e.target.closest('[data-step]');
    if (s) { closePop(); step(+s.dataset.step); return; }
    if (e.target.closest('[data-today]')) { closePop(); goTo(mode, today()); return; }
    const md = e.target.closest('[data-mode]');
    if (md) { closePop(); goTo(md.dataset.mode, focus || today()); return; }
    const wk = e.target.closest('[data-week]');
    if (wk) { closePop(); goTo('week', wk.dataset.week); return; }
    const more = e.target.closest('[data-more]');
    if (more) { e.preventDefault(); if (pop && pop.day === more.dataset.more) closePop(); else openDay(more, more.dataset.more); return; }
    if (e.target.closest('[data-subscribe]')) { closePop(); settings.open('ics'); return; }
    // 點一件事：打開詳細（⌘／Ctrl／中鍵照樣在新分頁開學校）
    const it = e.target.closest('a[data-k]');
    if (it && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      e.preventDefault();
      if (pop && pop.key === it.dataset.k) closePop(); else openItem(it);
    }
  });
  // 點外面就關
  document.addEventListener('pointerdown', e => {
    if (!pop) return;
    if (e.target.closest('#cal-pop') || e.target.closest('#view-calendar [data-k]') || e.target.closest('#view-calendar [data-more]')) return;
    closePop();
  }, true);
  root.addEventListener('scroll', () => closePop(), true);
  onRoute(() => closePop());
  // 視窗大小變了就重新量（只在看得到的時候）
  let raf = 0;
  const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (!root.hidden && shown) { fit(); if (pop) refreshPop(); } }); };
  if (typeof ResizeObserver === 'function') new ResizeObserver(again).observe(root);
  else addEventListener('resize', again);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(again);
}
