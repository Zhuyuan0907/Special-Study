// 本週：一個焦點（下一個日期倒數）、這一週七天、要做的事、學校進度。
import {S, KINDS, DEADLINE_KINDS, esc, clone, uid, todayKey, diffDays, addDays, md, wdShort, fmtDate, cdText, appName, deptMain, schoolLinks, upcoming, liveEvents, firstDate, clashes, chosenSchool, nextEventOf, activeApp, upsertApp, removeApp, saveTodos, STAGE_ORDER, composing, isKey, toast, seasonItems} from './core.js';
import {hueStyle, stateHtml, shortName, kindsLabel, kindsTimesLabel, sameTimes, weekDays, mdw, countdownHtml} from './ui.js';
import {go} from './router.js';

export const wk = {offset: 0, far: false};
const $ = s => document.querySelector(s);

export function renderWeek() {
  renderHero();
  renderStrip();
  renderTasks();
  renderRight();
}

// 同一間學校同一天的幾個截止（報名、繳費、繳件）當成一件事，各自的時間一起列出。
function mergeDeadlines(list) {
  const rows = [], byKey = new Map();
  for (const ev of list) {
    const key = !ev.end && DEADLINE_KINDS.has(ev.kind) ? `${ev.app.id}|${ev.date}` : null;
    const prev = key && byKey.get(key);
    if (prev) { prev.kinds.push(ev.kind); prev.times.push(ev.time || ''); continue; }
    const row = {...ev, kinds: [ev.kind], times: [ev.time || '']};
    rows.push(row);
    if (key) byKey.set(key, row);
  }
  return rows;
}

function renderHero() {
  const el = $('#hero');
  const list = mergeDeadlines(upcoming(liveEvents()));
  const next = list.find(ev => !ev.derived) || list[0];
  if (!next) {
    el.className = 'hero quiet';
    el.innerHTML = S.apps.length
      ? `<div class="hero-n">—</div><div class="hero-t"><b>接下來沒有日期</b><span>學校的日期都過了，或都已經結案</span></div>`
      : `<div class="hero-n">—</div><div class="hero-t"><b>先加入第一間學校</b><span>右上角「新增學校」，從簡章選學校和系，日期會自動排進來</span></div>`;
    return;
  }
  const f = next.date >= todayKey() ? next.date : next.last, n = diffDays(f), ongoing = next.date < todayKey();
  el.className = 'hero';
  const same = sameTimes(next.times);
  el.innerHTML = `<div class="hero-n">${n === 0 ? '今天' : n === 1 ? '明天' : `${n}<small>天後</small>`}</div>
    <div class="hero-t"><b><span class="hue" ${hueStyle(next.app)}>${esc(shortName(next.app))}</span> ${esc(deptMain(next.app))} · ${kindsTimesLabel(next.kinds, next.times)}${ongoing ? '（進行中）' : ''}</b>
    <span>${mdw(f)}${same && next.time && !ongoing ? ' ' + esc(next.time) : ''}${ongoing ? `，到 ${fmtDate(next.last)}` : ''}${next.note && !next.derived && next.kinds.length === 1 ? ' · ' + esc(next.note) : ''}</span></div>`;
  el.onclick = () => go('schools', {id: next.app.id});
}

function renderStrip() {
  const days = weekDays(wk.offset), t = todayKey();
  const evs = liveEvents();
  const byDay = {};
  for (const ev of evs) {
    (byDay[ev.date] ||= []).push({ev});
    if (ev.end && ev.end !== ev.date) (byDay[ev.end] ||= []).push({ev, end: true});
  }
  for (const td of S.todos) if (!td.done && isKey(td.due)) (byDay[td.due] ||= []).push({todo: td});
  for (const s of seasonItems()) for (let d = s.date, i = 0; d <= s.last && i < 10; d = addDays(d, 1), i++) (byDay[d] ||= []).push({season: s});
  const label = wk.offset === 0 ? '本週' : wk.offset === 1 ? '下週' : wk.offset === -1 ? '上週' : `${wk.offset > 0 ? '+' : ''}${wk.offset} 週`;
  $('#strip').innerHTML = `<div class="strip-head"><b>${label} <span class="muted small">${md(days[0])} – ${md(days[6])}</span></b>
      <div class="strip-nav"><button class="btn xs ghost" type="button" data-wk="-1">‹</button><button class="btn xs ghost" type="button" data-wk="0">本週</button><button class="btn xs ghost" type="button" data-wk="1">›</button></div></div>
    <div class="strip-grid">${days.map(k => {
      const items = (byDay[k] || []);
      const shown = items.slice(0, 5);
      return `<div class="sday ${k === t ? 'today' : k < t ? 'past' : ''}">
        <div class="sday-h"><b>${Number(k.slice(8))}</b><span>週${wdShort(k)}</span>${k === t ? '<span class="accent">今天</span>' : ''}</div>
        ${shown.map(it => it.todo
          ? `<div class="sitem todo" data-todo="${esc(it.todo.id)}"><span class="dot sm" style="background:var(--ink-3)"></span><span class="k">${esc(it.todo.text)}</span></div>`
          : it.season ? `<div class="sitem season"><span class="dot sm" style="background:var(--ink-3)"></span><span class="k">${esc(it.season.label)}</span></div>`
          : `<div class="sitem" ${hueStyle(it.ev.app)} data-app="${esc(it.ev.app.id)}"><span class="dot sm"></span><span class="s">${esc(shortName(it.ev.app))}</span><span class="k">${KINDS[it.ev.kind].label}${it.end ? '結束' : ''}</span>${it.ev.time && !it.end ? `<span class="t">${esc(it.ev.time)}</span>` : ''}</div>`).join('')}
        ${items.length > shown.length ? `<div class="smore">還有 ${items.length - shown.length} 項</div>` : ''}
      </div>`;
    }).join('')}</div>`;
}

// 要做的事：從日期、狀態、待辦推出來的一張清單，照日期排，緊急的放最前面。
function taskRows() {
  const t = todayKey(), horizon = addDays(t, wk.far ? 60 : 14);
  const rows = [];
  const going = chosenSchool();
  for (const c of clashes()) rows.push({crit: true, date: c.date, app: c.evs[0].app, title: `${mdw(c.date)} 面試撞期`, sub: c.evs.map(e => shortName(e.app)).join('、') + '。選一間去，其他的到「學校 › 面試」標記不參加', when: mdw(c.date), actions: []});
  for (const ev of mergeDeadlines(upcoming(liveEvents()))) {
    const a = ev.app, f = ev.date >= t ? ev.date : ev.last, n = diffDays(f);
    if (f > horizon) continue;
    const left = (a.docs || []).filter(d => !d.done).length;
    const L = schoolLinks(a.school) || {};
    const same = sameTimes(ev.times);
    const row = {date: f, time: ev.time, app: a, title: kindsTimesLabel(ev.kinds, ev.times), sub: '', when: `${mdw(f)}${same && ev.time ? ' ' + ev.time : ''}`, n, actions: [], crit: false};
    const k = ev.kinds[0];
    if (ev.kinds.some(x => ['reg', 'pay', 'upload', 'letter'].includes(x))) {
      if (a.status === 'prep' && ev.kinds.includes('reg')) { row.sub = '還沒報名'; row.crit = n <= 1; if (L.apply) row.actions.push({label: '報名系統', href: L.apply}); row.actions.push({label: '已報名', set: {status: 'applied'}, primary: true}); }
      else if (left && ev.kinds.some(x => x === 'upload' || x === 'reg')) { row.sub = `備審還有 ${left} 項沒完成`; row.actions.push({label: '備審', view: 'docs'}); }
      else if (ev.kinds.includes('letter') && left) { row.sub = '確認推薦人已經送出'; }
    } else if (k === 'open') { row.sub = '可以開始報名'; if (L.apply) row.actions.push({label: '報名系統', href: L.apply}); }
    else if (['interview', 'exam', 'window'].includes(k)) { row.sub = [a.place, a.status !== 'interview' && a.status !== 'waiting' ? '' : ''].filter(Boolean).join('・'); row.actions.push({label: '準備面試', view: 'schools', sec: 'interview'}); }
    else if (k === 'stage1') { row.sub = '公布後到「學校」記錄有沒有通過'; }
    else if (k === 'release') { row.sub = '放榜後到「學校」記錄結果'; }
    else if (k === 'confirm') { if (['admitted', 'waitlist'].includes(a.status) && !a.choice) { row.sub = '還沒決定要不要讀'; row.crit = n <= 3; row.actions.push({label: '要去讀', set: {choice: 'attend'}, primary: true}, {label: '放棄', set: {choice: 'decline'}}); } else if (a.choice === 'attend' && !a.confirmDone) { row.sub = '記得完成報到'; row.actions.push({label: '已報到', set: {confirmDone: true}, primary: true}); } }
    else if (k === 'giveup') { if (a.choice === 'decline' && !a.giveupDone) { row.sub = '記得交出放棄聲明'; row.crit = true; row.actions.push({label: '已辦放棄', set: {giveupDone: true}, primary: true}); } else if (going && going.id !== a.id && ['admitted', 'waitlist'].includes(a.status) && a.choice !== 'decline') { row.sub = `你要讀 ${shortName(going)}，這間也要辦放棄`; row.crit = true; row.actions.push({label: '放棄這間', set: {choice: 'decline'}, primary: true}); } else if (!['admitted', 'waitlist'].includes(a.status)) continue; }
    else if (k === 'wait' && a.status !== 'waitlist') continue;
    rows.push(row);
  }
  // 不受 14 天限制的提醒：報名過了還是準備中、要不要讀、放棄。
  for (const a of S.apps) {
    const reg = firstDate(a, ['reg']);
    if (a.status === 'prep' && reg && reg.date < t && diffDays(reg.date) >= -21) rows.push({crit: true, date: t, app: a, title: '報名已截止，還是「準備中」', sub: `${mdw(reg.date)} 截止。有報名就按「已報名」，沒報就按「沒有報名」`, when: '', actions: [{label: '已報名', set: {status: 'applied'}, primary: true}, {label: '沒有報名', set: {status: 'skipped'}}]});
    const cf = firstDate(a, ['confirm']), g = firstDate(a, ['giveup']);
    if (['admitted', 'waitlist'].includes(a.status) && !a.choice && !(cf && cf.date <= horizon) && !(going && going.id !== a.id)) rows.push({crit: false, date: cf ? cf.date : t, app: a, title: '決定要不要讀', sub: cf ? `${mdw(cf.date)}${cf.time ? ' ' + cf.time : ''} 報到截止` : '', when: cf ? mdw(cf.date) : '', actions: [{label: '要去讀', set: {choice: 'attend'}, primary: true}, {label: '放棄', set: {choice: 'decline'}}]});
    if (going && going.id !== a.id && ['admitted', 'waitlist'].includes(a.status) && a.choice !== 'decline' && !(g && g.date <= horizon)) rows.push({crit: true, date: t, app: a, title: '也要辦理放棄', sub: `你決定讀 ${shortName(going)}${g ? `，${mdw(g.date)}${g.time ? ' ' + g.time : ''} 前要辦好` : ''}`, when: g ? mdw(g.date) : '', actions: [{label: '放棄這間', set: {choice: 'decline'}, primary: true}]});
    if (a.choice === 'decline' && !a.giveupDone && ['admitted', 'waitlist'].includes(a.status) && !(g && g.date <= horizon)) rows.push({crit: true, date: t, app: a, title: '交出放棄聲明', sub: g ? `${mdw(g.date)}${g.time ? ' ' + g.time : ''} 前。沒辦放棄就不能走繁星、申請、分發` : '沒辦放棄就不能走繁星、申請、分發', when: g ? mdw(g.date) : '', actions: [{label: '已辦放棄', set: {giveupDone: true}, primary: true}]});
  }
  for (const td of S.todos) {
    if (td.done) continue;
    if (isKey(td.due) && td.due > horizon) continue;
    const a = td.appId ? S.apps.find(x => x.id === td.appId) : null;
    rows.push({todo: td, app: a, date: isKey(td.due) ? td.due : '9999', title: td.text, sub: a ? appName(a) : '', when: isKey(td.due) ? mdw(td.due) : '', n: isKey(td.due) ? diffDays(td.due) : null, crit: isKey(td.due) && td.due < t});
  }
  return rows.sort((x, y) => (y.crit ? 1 : 0) - (x.crit ? 1 : 0) || x.date.localeCompare(y.date) || (x.time || '99').localeCompare(y.time || '99'));
}

function renderTasks() {
  const rows = taskRows();
  const el = $('#tasks');
  el._rows = rows;
  const schoolOpts = S.apps.filter(activeApp).map(a => `<option value="${esc(a.id)}">${esc(shortName(a))} ${esc(deptMain(a))}</option>`).join('');
  el.innerHTML = `<div class="tasks-head"><b>要做的事<span class="count">${rows.length || ''}</span></b><button class="link" type="button" id="tasks-far">${wk.far ? '只看 14 天內' : '看到 60 天'}</button></div>
    <div class="task-list scroll">${rows.length ? rows.map((r, i) => {
      const n = r.n ?? (r.date !== '9999' ? diffDays(r.date) : null);
      return `<div class="task ${r.crit ? 'crit' : ''} ${r.todo && r.todo.done ? 'done' : ''}" ${r.app ? hueStyle(r.app) : ''} data-i="${i}" ${r.app ? `data-app="${esc(r.app.id)}"` : ''}>
        <span class="task-bar"></span>
        <div class="task-main">
          <div class="task-title">${r.todo ? `<label class="check"><input type="checkbox" data-done="${esc(r.todo.id)}"></label>` : ''}${r.app && !r.todo ? `<span class="s">${esc(shortName(r.app))}</span><span class="muted">${esc(deptMain(r.app))}</span>` : ''}<b>${esc(r.title)}</b></div>
          ${r.sub ? `<div class="task-sub">${esc(r.sub)}</div>` : ''}
        </div>
        <div class="task-acts">
          ${r.when ? `<span class="task-when ${n != null && n <= 1 ? 'hot' : ''}">${esc(r.when)}${n != null ? ` · <b>${cdText(n)}</b>` : ''}</span>` : ''}
          ${(r.actions || []).map((x, j) => x.href ? `<a class="btn xs ext" href="${esc(x.href)}" target="_blank" rel="noopener">${x.label}</a>` : `<button class="btn xs ${x.primary ? 'fill' : ''}" type="button" data-act="${i}:${j}">${x.label}</button>`).join('')}
          ${r.todo ? `<button class="icon-btn" type="button" data-del-todo="${esc(r.todo.id)}" aria-label="刪除待辦">✕</button>` : ''}
        </div>
      </div>`;
    }).join('') : `<div class="empty"><b>這兩週沒有要做的事</b>${S.apps.length ? '可以先把備審往前做，或在下面加一筆待辦。' : '先加入學校，日期和該做的事會自動出現。'}</div>`}</div>
    <form class="todo-add" id="todo-add"><input type="text" id="todo-text" placeholder="新增待辦，例如：請老師寫推薦信" autocomplete="off" aria-label="待辦內容"><input type="date" id="todo-due" aria-label="到期日"><select id="todo-app" aria-label="哪一間學校"><option value="">（不指定學校）</option>${schoolOpts}</select><button class="btn sm" type="submit">加入</button></form>`;
}

function renderRight() {
  const t = todayKey();
  const apps = [...S.apps].sort((a, b) => {
    const oa = activeApp(a) ? 0 : 1, ob = activeApp(b) ? 0 : 1;
    const na = nextEventOf(a), nb = nextEventOf(b);
    return oa - ob || (na ? na.date : '9').localeCompare(nb ? nb.date : '9') || (STAGE_ORDER[a.status] ?? 9) - (STAGE_ORDER[b.status] ?? 9);
  });
  const applied = S.apps.filter(a => !['prep', 'skipped'].includes(a.status)).length;
  const ok = S.apps.filter(a => a.status === 'admitted').length, wl = S.apps.filter(a => a.status === 'waitlist').length;
  const ex = S.apps.filter(a => a.example).length;
  const summary = [`${S.apps.length} 間`, applied ? `已報名 ${applied}` : '', ok ? `正取 ${ok}` : '', wl ? `備取 ${wl}` : ''].filter(Boolean).join('・');
  $('#week-right').innerHTML = `<div class="sched"><div class="sched-head"><b>學校進度</b><span class="small muted">${summary}</span></div>
    <div class="scroll">${apps.length ? apps.map(a => {
      const nx = nextEventOf(a), f = nx ? (nx.date >= t ? nx.date : nx.last) : null, n = f ? diffDays(f) : null;
      return `<div class="srow ${activeApp(a) ? '' : 'off'}" ${hueStyle(a)} data-app="${esc(a.id)}">
        <span class="dot"></span>
        <div class="srow-main"><div class="srow-name">${esc(shortName(a))}${stateHtml(a)}</div><div class="srow-dept">${esc(deptMain(a) || '（還沒填學系）')}${a.example ? ' <span class="tag">範例</span>' : ''}</div></div>
        <div class="srow-next">${nx && activeApp(a) ? `<b>${KINDS[nx.kind].label} ${md(f)}${nx.time ? ' ' + esc(nx.time) : ''}</b>${countdownHtml(n)}` : '<span class="muted">—</span>'}</div>
      </div>`;
    }).join('') : '<div class="empty"><b>還沒有學校</b></div>'}</div>
    ${ex ? `<div class="small muted" style="padding-top:8px">有 ${ex} 筆是範例 · <button class="link" type="button" id="clear-ex">清除範例</button></div>` : ''}</div>`;
}

/* ---------- 動作 ---------- */
export function setOnApp(a, patch) {
  const next = {...clone(a), ...patch};
  if (patch.choice === 'attend') for (const o of S.apps) if (o.id !== a.id && o.choice === 'attend') upsertApp({...clone(o), choice: ''});
  if (patch.status && !['admitted', 'waitlist'].includes(patch.status)) next.choice = '';
  delete next.example;
  upsertApp(next);
}
let clearArmed = false;
export function wireWeek() {
  const view = $('#view-week');
  view.addEventListener('click', async e => {
    const wkb = e.target.closest('[data-wk]');
    if (wkb) { const v = Number(wkb.dataset.wk); wk.offset = v === 0 ? 0 : wk.offset + v; renderStrip(); return; }
    if (e.target.closest('#tasks-far')) { wk.far = !wk.far; renderTasks(); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      const [i, j] = act.dataset.act.split(':').map(Number);
      const row = $('#tasks')._rows[i], x = row && row.actions[j];
      if (!x) return;
      if (x.view) { go(x.view, {id: row.app && row.app.id, sec: x.sec}); return; }
      if (x.set) setOnApp(row.app, x.set);
      return;
    }
    const del = e.target.closest('[data-del-todo]');
    if (del) { S.todos = S.todos.filter(td => td.id !== del.dataset.delTodo); saveTodos(); return; }
    if (e.target.closest('#clear-ex')) {
      if (!clearArmed) { clearArmed = true; e.target.textContent = '再按一次確認清除'; setTimeout(() => { clearArmed = false; renderRight(); }, 4000); return; }
      clearArmed = false;
      for (const a of S.apps.filter(x => x.example)) await removeApp(a.id);
      toast('範例已清除');
      return;
    }
    if (e.target.closest('input, label, button, a, select')) return;
    const td = e.target.closest('[data-todo]');
    if (td) return;
    const row = e.target.closest('[data-app]');
    if (row) go('schools', {id: row.dataset.app});
  });
  view.addEventListener('change', e => {
    if (e.target.dataset.done) { const td = S.todos.find(x => x.id === e.target.dataset.done); if (td) { td.done = e.target.checked; saveTodos(); } }
  });
  view.addEventListener('submit', e => {
    if (e.target.id !== 'todo-add') return;
    e.preventDefault();
    const text = $('#todo-text').value.trim();
    if (!text) return;
    S.todos.push({id: uid(), text, due: $('#todo-due').value || '', appId: $('#todo-app').value || '', done: false, createdAt: Date.now()});
    saveTodos();
    const inp = $('#todo-text'); if (inp) inp.focus();
  });
  view.addEventListener('keydown', e => { if (e.target.id === 'todo-text' && e.key === 'Enter' && composing(e)) e.preventDefault(); });
}
