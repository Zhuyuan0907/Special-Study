// 啟動：載入資料、四個分頁（接下來・學校・行事曆・花費）、兩個對話框（加學校、設定）、快速鍵、分頁標題、簡章更新提示。
import {S, P, $, $$, load, refresh, onChange, now, today, toast, setBar, toTop, undoLast, agendaNow, appById, shortName, ready, ls, editing} from './core.js';
import {route, go, onRoute, start} from './router.js';
import {wireEdit, closeEdit, editKey, snapshotEdit, restoreEdit, afterRender, closeMenu, fmtVal} from './ui.js';
import * as next from './next.js';
import * as schools from './schools.js';
import * as calendar from './calendar.js';
import * as money from './money.js';
import * as add from './add.js';
import * as settings from './settings.js';
import {shortSchool, syncHeadline} from './logic.js';

const VIEWS = {next, schools, calendar, money};
let booted = false;

/* ---------- 畫面 ---------- */
function show() {
  for (const k of Object.keys(VIEWS)) $('#view-' + k).hidden = k !== route.view;
  for (const a of $$('#tabs a')) { if (a.dataset.view === route.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  closeMenu();
  if (editKey()) closeEdit();
  render();
  if (route.open === 'add') { const pid = route.pid; route.open = ''; route.pid = ''; ready.then(() => add.open({pid})); }
}
function render() {
  if (!booted) return;
  const snap = snapshotEdit();
  try { VIEWS[route.view].render(route); } catch (e) { console.error(e); }
  restoreEdit(snap);
  afterRender();
  title();
}
onRoute(show);
onChange(render);

/* ---------- 分頁標題：特選 · 今天 北市大 15:30 ---------- */
let sig = '';
function title() {
  let t = '特選';
  try {
    const ag = agendaNow() || {}, rows = ag.rows || [], r = rows[ag.focalIndex];
    sig = JSON.stringify(rows.map(x => [x.appId, x.date, x.time, x.type, x.overdue, x.question ? 1 : 0]));
    if (r && r.date === today()) { const a = appById(r.appId); t += ` · 今天 ${a ? shortName(a) : ''}${r.time ? ' ' + r.time : ''}`; }
  } catch (e) { console.error(e); }
  document.title = t;
}
// 時間過了，「今天」、逾期、要不要問結果都會變：每分鐘看一次，有變才重畫。
let lastMin = now();
setInterval(() => {
  const n = now();
  if (!booted || n === lastMin || document.hidden || editing() || $('dialog[open]')) return;
  const day = n.slice(0, 10) !== lastMin.slice(0, 10);
  lastMin = n;
  const before = sig;
  try { const ag = agendaNow() || {}; const s = JSON.stringify((ag.rows || []).map(x => [x.appId, x.date, x.time, x.type, x.overdue, x.question ? 1 : 0])); if (!day && s === before) return; } catch { /* 照樣重畫 */ }
  render();
}, 30 * 1000);

/* ---------- 載入後：學年度、從備份還原、簡章更新 ---------- */
function afterLoad() {
  const m = S.meta || {};
  const y = m.year || P.year;
  if (y) $('#brand-year').textContent = `${y} 學年度`;
  recovered(m.recovered);
  syncToast();
}
function recovered(r) {
  if (!r) { setBar('recovered', null); return; }
  const key = JSON.stringify(r);
  if (ls.get('recoveredSeen') === key) return;
  const from = typeof r === 'string' ? r : r.from || r.backup || r.file || '';
  const day = /(\d{4})-(\d{2})-(\d{2})/.exec(from);
  setBar('recovered', {err: !from, msg: from ? `紀錄檔讀不到，已改用${day ? ` ${day[2]}/${day[3]} 的` : ''}備份` : '紀錄檔讀不到，也沒有能用的備份', btn: {label: '知道了', fn: () => { ls.set('recoveredSeen', key); setBar('recovered', null); }}});
}
// 每次簡章同步只提示一次（記在這台電腦）。
function syncToast() {
  const logs = [...(S.syncLog || []), S.meta && S.meta.syncLog].filter(x => x && x.id && Array.isArray(x.changes) && x.changes.length);
  const seen = ls.get('syncSeen', []);
  const fresh = logs.filter((x, i) => !seen.includes(x.id) && logs.findIndex(y => y.id === x.id) === i);
  if (!fresh.length) return;
  ls.set('syncSeen', [...seen, ...fresh.map(x => x.id)].slice(-50));
  // 前後看起來一樣的（舊版記下的「12/02 10:00 → 12/02 10:00」）不算；一則提示只寫最要緊的一項（logic.syncHeadline）
  const ch = fresh.flatMap(x => x.changes).filter(c => fmtVal(c.from) !== fmtVal(c.to));
  if (!ch.length) return;
  const c = syncHeadline(ch);
  const app = appById(c.appId);
  const name = app ? shortName(app) : shortSchool(c.school || '', P.aliases);
  const what = c.from && c.to ? `${c.what} ${fmtVal(c.from)} → ${fmtVal(c.to)}` : c.to ? `新增 ${c.what} ${fmtVal(c.to)}` : `${c.what} 移除`;
  toast(`簡章更新：${name} ${what}${ch.length > 1 ? `，還有 ${ch.length - 1} 項` : ''}`, {ms: 10000, action: app ? {label: '打開', fn: () => go({view: 'schools', id: app.id})} : null});
}

/* ---------- 接線 ---------- */
// 站內連結（#schools/<id> 之類）走 router，才會 pushState；在對話框裡點就先關掉對話框。
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
  e.preventDefault();
  const d = a.closest('dialog[open]');
  if (d) d.close();
  go(a.getAttribute('href'));
});
$('#btn-add').addEventListener('click', () => ready.then(() => add.open()));
$('#btn-settings').addEventListener('click', () => ready.then(() => settings.open()));
for (const d of $$('dialog')) {
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
  for (const b of $$('[data-close]', d)) b.addEventListener('click', () => d.close());
  d.addEventListener('close', () => { closeMenu(); toTop($('#toast')); toTop($('#bar')); });
}
wireEdit();

const inField = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (closeMenu()) { e.preventDefault(); return; }
    if ($('dialog[open]')) return;                         // 對話框自己會關
    if (editKey()) { e.preventDefault(); closeEdit(); }
    return;
  }
  if (e.isComposing || e.keyCode === 229) return;
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && !inField(document.activeElement) && !editKey()) { if (undoLast()) e.preventDefault(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey || inField(document.activeElement) || $('dialog[open]') || editKey()) return;
  const i = ['1', '2', '3', '4'].indexOf(e.key);
  if (i >= 0) { e.preventDefault(); go({view: ['next', 'schools', 'calendar', 'money'][i]}); }
  else if (e.key === 'n' || e.key === 'N' || e.key === '/') { e.preventDefault(); ready.then(() => add.open()); }
});
// 回到網頁（切回分頁、手機解鎖）就重新載入：別的裝置可能改過。「改」表單打開時不載。
const back = () => { if (document.visibilityState === 'visible') refresh().then(afterLoad); };
addEventListener('focus', back);
document.addEventListener('visibilitychange', back);

/* ---------- 啟動 ---------- */
for (const m of [next, schools, calendar, money, add, settings]) { try { m.init && m.init(); } catch (e) { console.error(e); } }
start();
show();
load().then(() => { booted = true; render(); afterLoad(); }).catch(e => console.error(e));
