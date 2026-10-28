// 行事曆：整個月，每一天直接列出事情（學校簡稱・哪件事・時間）。同一天多校相同的截止合成一列。
import {S, KINDS, DEADLINE_KINDS, esc, uid, todayKey, isKey, md, wdShort, liveEvents, saveTodos, deptMain, appName, fmtDate, seasonItems} from './core.js';
import {hueStyle, shortName, monthTitle} from './ui.js';
import {go} from './router.js';

const t0 = new Date();
export const cal = {y: t0.getFullYear(), m: t0.getMonth(), pop: null};
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');

function dayItems() {
  const byDay = {};
  for (const ev of liveEvents()) {
    (byDay[ev.date] ||= []).push({ev});
    if (ev.end && ev.end !== ev.date) {
      // 期間（甄試期間、成績複查）：中間每天都標，最後一天標「結束」
      let d = ev.date;
      for (let i = 0; i < 60 && d < ev.end; i++) { d = nextDay(d); (byDay[d] ||= []).push({ev, mid: d !== ev.end, end: d === ev.end}); }
    }
  }
  for (const td of S.todos) if (isKey(td.due)) (byDay[td.due] ||= []).push({todo: td});
  for (const s of seasonItems()) for (let d = s.date, i = 0; d <= s.last && i < 10; d = nextDay(d), i++) (byDay[d] ||= []).push({season: s});
  // 同一天、同一種截止、三間以上學校 → 合成一列
  for (const k of Object.keys(byDay)) {
    const list = byDay[k], out = [], groups = {};
    for (const it of list) {
      if (it.ev && DEADLINE_KINDS.has(it.ev.kind) && !it.mid && !it.end) (groups[it.ev.kind] ||= []).push(it); else out.push(it);
    }
    for (const [kind, its] of Object.entries(groups)) {
      if (its.length >= 3) out.push({multi: true, kind, items: its});
      else out.push(...its);
    }
    byDay[k] = out.sort((a, b) => timeOf(a).localeCompare(timeOf(b)));
  }
  return byDay;
}
const timeOf = it => it.todo ? '98' : it.season ? '97' : it.multi ? (it.items[0].ev.time || '99') : (it.ev.time || '99');
function nextDay(k) { const d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function itemHtml(it, full = false) {
  if (it.todo) return `<div class="citem todo ${it.todo.done ? 'done' : ''}" data-todo="${esc(it.todo.id)}"><span class="dot" style="background:var(--ink-3)"></span><span class="k">${esc(it.todo.text)}</span></div>`;
  if (it.season) return `<div class="citem season"><span class="dot" style="background:var(--ink-3)"></span><span class="k">${esc(it.season.label)}</span></div>`;
  if (it.multi) return `<div class="citem multi" data-multi="${esc(it.kind)}"><span class="dot" style="background:var(--ink-2)"></span><span class="s">${it.items.length} 校</span><span class="k">${KINDS[it.kind].label}</span></div>`;
  const ev = it.ev;
  return `<div class="citem" ${hueStyle(ev.app)} data-app="${esc(ev.app.id)}"><span class="dot"></span><span class="s">${esc(shortName(ev.app))}</span><span class="k">${full ? esc(deptMain(ev.app)) + ' ' : ''}${KINDS[ev.kind].label}${it.end ? '結束' : it.mid ? '中' : ''}</span>${ev.time && !it.mid && !it.end ? `<span class="t">${esc(ev.time)}</span>` : ''}</div>`;
}

export function renderCalendar() {
  const {y, m} = cal, t = todayKey();
  $('#cal-title').textContent = monthTitle(y, m);
  const byDay = dayItems();
  const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // 週一開始
  const cells = [];
  const prevDays = new Date(y, m, 0).getDate();
  for (let i = lead - 1; i >= 0; i--) cells.push({k: `${y}-${pad(m)}-${pad(prevDays - i)}`, pad: true, n: prevDays - i});
  for (let d = 1; d <= days; d++) cells.push({k: `${y}-${pad(m + 1)}-${pad(d)}`, n: d});
  while (cells.length % 7) { const i = cells.length - lead - days + 1; cells.push({k: `${y}-${pad(m + 2)}-${pad(i)}`, pad: true, n: i}); }
  const rows = cells.length / 7;
  const maxLines = rows >= 6 ? 4 : 5;
  const grid = $('#cal-grid');
  grid.style.gridTemplateRows = `auto repeat(${rows}, minmax(0, 1fr))`;
  grid.innerHTML = '一二三四五六日'.split('').map(c => `<div class="cal-wd">週${c}</div>`).join('') + cells.map(c => {
    const items = byDay[c.k] || [];
    const shown = items.slice(0, maxLines);
    return `<div class="cday ${c.pad ? 'pad' : ''} ${c.k === t ? 'today' : ''} ${c.k < t ? 'past' : ''}" data-day="${c.k}">
      <div class="cday-n"><span>${c.n}${c.k === t ? ' 今天' : ''}</span><button class="add" type="button" data-add-day="${c.k}" aria-label="加待辦" title="加待辦">＋</button></div>
      <div class="cday-items">${shown.map(it => itemHtml(it)).join('')}${items.length > shown.length ? `<div class="citem" data-more="${c.k}"><span class="k muted">還有 ${items.length - shown.length} 項…</span></div>` : ''}</div>
    </div>`;
  }).join('');
  const legend = S.apps.filter(a => !['rejected', 'out', 'skipped'].includes(a.status)).map(a => `<span ${hueStyle(a)}><span class="dot"></span>${esc(shortName(a))} ${esc(deptMain(a))}</span>`).join('');
  $('#cal-legend').innerHTML = legend;
  const total = Object.values(byDay).flat().length;
  $('#cal-note').textContent = total ? '點一天的「＋」可以加待辦；點事情會打開那間學校' : '';
  $('#cal-tools').innerHTML = `<button class="btn sm ghost" type="button" data-settings="export">訂閱到手機・匯出</button><button class="btn sm ghost" type="button" id="cal-print">列印</button>`;
}
function openPop(k, anchor) {
  const pop = $('#daypop');
  const items = (dayItems()[k] || []);
  pop.innerHTML = `<h3><span>${md(k)}（${wdShort(k)}）</span><button class="icon-btn" type="button" data-pop-close aria-label="關閉">✕</button></h3>
    ${items.length ? items.map(it => itemHtml(it, true)).join('') : '<div class="small muted">這天沒有事情</div>'}
    <form class="todo-add" data-pop-add="${k}" style="padding-top:4px"><input type="text" placeholder="加一筆待辦" aria-label="待辦內容" autocomplete="off" style="flex:1"><button class="btn sm" type="submit">加入</button></form>`;
  const r = anchor.getBoundingClientRect();
  const left = Math.min(r.left, window.innerWidth - 376), top = r.bottom + 6 > window.innerHeight - 420 ? Math.max(8, r.top - 426) : r.bottom + 6;
  pop.style.left = `${Math.max(8, left)}px`; pop.style.top = `${top}px`;
  pop.classList.add('open');
  cal.pop = k;
  pop.querySelector('input').focus();
}
export function closePop() { $('#daypop').classList.remove('open'); cal.pop = null; }

export function wireCalendar() {
  const view = $('#view-calendar');
  const move = n => { const d = new Date(cal.y, cal.m + n, 1); cal.y = d.getFullYear(); cal.m = d.getMonth(); closePop(); renderCalendar(); };
  $('#cal-prev').addEventListener('click', () => move(-1));
  $('#cal-next').addEventListener('click', () => move(1));
  $('#cal-today').addEventListener('click', () => { const d = new Date(); cal.y = d.getFullYear(); cal.m = d.getMonth(); closePop(); renderCalendar(); });
  view.addEventListener('click', e => {
    if (e.target.closest('[data-pop-close]')) { closePop(); return; }
    if (e.target.closest('#daypop')) { const a = e.target.closest('[data-app]'); if (a) { closePop(); go('schools', {id: a.dataset.app}); } return; }
    const add = e.target.closest('[data-add-day]');
    if (add) { openPop(add.dataset.addDay, add.closest('.cday')); return; }
    const more = e.target.closest('[data-more]');
    if (more) { openPop(more.dataset.more, more.closest('.cday')); return; }
    const multi = e.target.closest('[data-multi]');
    if (multi) { openPop(multi.closest('.cday').dataset.day, multi.closest('.cday')); return; }
    const a = e.target.closest('[data-app]');
    if (a) { go('schools', {id: a.dataset.app}); return; }
    const td = e.target.closest('[data-todo]');
    if (td) { const x = S.todos.find(z => z.id === td.dataset.todo); if (x) { x.done = !x.done; saveTodos(); } return; }
    if (e.target.closest('#cal-print')) { document.dispatchEvent(new CustomEvent('print-all')); return; }
    if (cal.pop && !e.target.closest('#daypop')) closePop();
  });
  view.addEventListener('submit', e => {
    const f = e.target.closest('[data-pop-add]');
    if (!f) return;
    e.preventDefault();
    const inp = f.querySelector('input'), text = inp.value.trim();
    if (!text) return;
    S.todos.push({id: uid(), text, due: f.dataset.popAdd, appId: '', done: false, createdAt: Date.now()});
    saveTodos();
    openPop(f.dataset.popAdd, document.querySelector(`.cday[data-day="${f.dataset.popAdd}"]`));
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && cal.pop) closePop(); });
}
