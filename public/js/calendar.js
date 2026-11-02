// 行事曆（#calendar、#calendar/2026-11）：週一到週日的月曆，畫的就是「接下來」那些列（同一套關聯和合併），
// 再加上大考日期（設定裡可以關）。格子放不下就量出來，多的收成「＋N」，點了跳到接下來的那一天。點事情打開那間學校。
import {$, $$, esc, now, today, agendaNow, appById, shortName, seasonItems, eventsFor} from './core.js';
import {hue, icon} from './ui.js';
import {go} from './router.js';
import * as settings from './settings.js';
import * as L from './logic.js';

const WD = ['一', '二', '三', '四', '五', '六', '日'];
const pad = n => String(n).padStart(2, '0');
const thisMonth = () => today().slice(0, 7);
// 網址的月份不對（#calendar/2027-13）就回到這個月
const monthOf = route => /^\d{4}-(0[1-9]|1[0-2])$/.test(route && route.month || '') ? route.month : thisMonth();
function shift(m, n) {
  const y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + n;
  const d = new Date(Date.UTC(y, mo, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
// 這個月要畫的格子：從包含 1 號那週的週一，到包含月底那週的週日（4–6 週）
function cells(m) {
  const first = m + '-01';
  const lead = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
  const n = Math.ceil((lead + days) / 7) * 7;
  const start = L.addDays(first, -lead);
  return Array.from({length: n}, (_, i) => L.addDays(start, i));
}

/* ---------- 每一天的事情 ---------- */
// 格子裡寫得短一點：報名列只寫還沒勾的必繳部分（已勾的、選繳的在接下來看）；報到、放棄只寫事情本身。
function labelOf(r) {
  if (r.role === 'reg') {
    const open = r.parts.filter(p => !p.opt && !p.done);
    return (open.length ? open : r.parts).map(p => p.name).join('・');
  }
  if (r.role === 'confirm') return '報到';
  if (r.role === 'giveup') return '放棄期限';
  return r.label;
}
// 格子已經是那一天，所以郵戳類只寫「郵戳」「寄達」，不再重複日期
const timeOf = r => r.time || (r.mail === 'postmark' ? '郵戳' : r.mail === 'arrive' ? '寄達' : '');
// 好幾天的面試（甄試期間）：只在第一天畫，後面接「～12/06」
function goEnd(r) {
  const app = appById(r.appId);
  if (!app || r.type !== 'go') return '';
  const ends = eventsFor(app).filter(e => r.rowIds.includes(e.rowId) && e.end).map(e => e.end).sort();
  return ends.length ? ends[ends.length - 1] : '';
}
function dayItems(from, to) {
  const ag = agendaNow();
  const by = new Map();
  const add = (d, it) => { if (d >= from && d <= to) (by.get(d) || by.set(d, []).get(d)).push(it); };
  // 大考日期是整天的事，照「沒有時間的排在那天最前面」放在前面
  for (const s of seasonItems()) for (let d = s.date, i = 0; d <= (s.end || s.date) && i < 14; d = L.addDays(d, 1), i++) add(d, {season: s});
  for (const r of ag.rows) add(r.date, {row: r});
  return {by, clashes: ag.clashes || new Map()};
}

// 換行只在「・」後面或詞和詞之間（繳費不會拆成「繳／費」）；真的太窄才隨便斷。
function itemHtml(it) {
  if (it.season) return `<div class="ci season"><span class="ci-l">${esc(it.season.label)}${it.season.tentative ? '（暫定）' : ''}</span></div>`;
  const r = it.row, app = appById(r.appId);
  if (!app) return '';
  const t = timeOf(r), end = goEnd(r);
  const cls = ['ci', r.type, r.tentative ? 'tent' : '', r.overdue ? 'late' : ''].filter(Boolean).join(' ');
  return `<a class="${cls}" href="#schools/${esc(encodeURIComponent(app.id))}" style="${hue(app)}">${t ? `<span class="ci-t">${esc(t)}</span> ` : ''}<span class="sch">${esc(shortName(app))}</span> <span class="ci-l">${esc(labelOf(r)).replace(/・/g, '・<wbr>')}${end ? `～${esc(L.md(end))}` : ''}</span></a>`;
}

/* ---------- 畫 ---------- */
let shown = '';
export function render(route) {
  const root = $('#view-calendar');
  if (!root) return;
  const m = monthOf(route), t = today(), n = now();
  const list = cells(m), {by, clashes} = dayItems(list[0], list[list.length - 1]);
  const inMonth = d => d.slice(0, 7) === m;
  let any = false;
  const grid = list.map(d => {
    const items = by.get(d) || [];
    if (items.length && inMonth(d)) any = true;
    const cls = ['cd', inMonth(d) ? '' : 'out', d < t ? 'past' : '', d === t ? 'today' : '', items.length ? '' : 'none'].filter(Boolean).join(' ');
    const num = inMonth(d) ? String(+d.slice(8)) : `${+d.slice(5, 7)}/${+d.slice(8)}`;
    return `<div class="${cls}" data-date="${d}">
      <div class="cd-h"><span class="cd-n">${num}</span>${d === t ? '<span class="cd-today">今天</span>' : ''}<span class="cd-w">${esc(L.dayLabel(d, n))}</span>${clashes.has(d) ? '<span class="cd-x">同天</span>' : ''}</div>
      <div class="cd-i">${items.map(itemHtml).join('')}<button class="link cd-more" type="button" data-more="${d}" hidden></button></div>
    </div>`;
  }).join('');
  root.innerHTML = `<div class="cal">
    <div class="cal-h">
      <h1>${+m.slice(0, 4)} 年 ${+m.slice(5, 7)} 月</h1>
      <div class="cal-nav">
        <button class="icon-btn" type="button" data-month="${shift(m, -1)}" aria-label="上個月">${icon('left')}</button>
        <button class="icon-btn" type="button" data-month="${shift(m, 1)}" aria-label="下個月">${icon('chevron')}</button>
        <button class="btn sm" type="button" data-month="">今天</button>
      </div>
      <button class="btn quiet sm cal-sub" type="button" data-subscribe>訂閱</button>
    </div>
    <div class="cal-wd" aria-hidden="true">${WD.map(w => `<span>${w}</span>`).join('')}</div>
    <div class="cal-g" style="--weeks:${list.length / 7}">${grid}</div>
    ${any ? '' : '<p class="empty cal-empty">這個月沒有事情。</p>'}
  </div>`;
  shown = m;
  fit();
}

// 量格子：放不下的從最後一件開始收起來，換成「＋N」。只在格子固定高度時有作用（窄螢幕整頁捲動，格子會長高）。
function fit() {
  const g = $('#view-calendar .cal-g');
  if (!g || !g.clientHeight) return;
  for (const box of $$('.cd-i', g)) {
    const items = $$('.ci', box), more = box.querySelector('.cd-more');
    for (const it of items) it.hidden = false;
    more.hidden = true;
    if (box.scrollHeight <= box.clientHeight + 1) continue;
    more.hidden = false;
    let n = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      items[i].hidden = true; n++;
      more.textContent = `＋${n}`;
      more.setAttribute('aria-label', `還有 ${n} 件，到接下來看`);
      if (box.scrollHeight <= box.clientHeight + 1) break;
    }
  }
}

/* ---------- 跳到接下來的那一天 ---------- */
// 約定：document 上的 'next:date' 事件，detail.date = 'YYYY-MM-DD'。接下來（next.js）收到就選那天的第一列、捲到中間。
// go() 會同步畫好接下來，所以事件送出時那些列已經在了。
export function showInNext(date) {
  go({view: 'next'});
  document.dispatchEvent(new CustomEvent('next:date', {detail: {date}, cancelable: true}));
}

export function init() {
  const root = $('#view-calendar');
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-month]');
    if (b) { const m = b.dataset.month; go({view: 'calendar', month: m === thisMonth() ? '' : m}); return; }
    const more = e.target.closest('[data-more]');
    if (more) { showInNext(more.dataset.more); return; }
    if (e.target.closest('[data-subscribe]')) { settings.open('ics'); return; }
  });
  // 視窗大小變了就重新量（只在看得到的時候）
  let raf = 0;
  const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (!root.hidden && shown) fit(); }); };
  if (typeof ResizeObserver === 'function') new ResizeObserver(again).observe(root);
  else addEventListener('resize', again);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(again);
}
