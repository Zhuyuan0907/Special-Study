// 網址：#next（預設）、#schools、#schools/<id>、#calendar、#calendar/2026-11、#money。
// 用 pushState，所以上一頁／下一頁能在畫面之間來回；重新整理會回到同一個畫面。
// 舊網址：#week → #next、#docs → #schools、#finder → #next 並打開加學校。
export const VIEWS = ['next', 'schools', 'calendar', 'money'];
// route.open：'add' 表示要順便打開加學校（舊的 #finder），pid 是要先選好的系組。
export const route = {view: 'next', id: '', month: '', open: '', pid: ''};
const subs = new Set();
export const onRoute = fn => { subs.add(fn); return () => subs.delete(fn); };

export function parse(hash) {
  const m = /^#?([a-z]*)(?:\/([^?]*))?/i.exec(hash || '');
  const name = (m && m[1] || '').toLowerCase();
  let arg = '';
  try { arg = m && m[2] ? decodeURIComponent(m[2]) : ''; } catch { arg = ''; }
  const r = {view: 'next', id: '', month: '', open: '', pid: '', legacy: false};
  if (name === 'schools') return {...r, view: 'schools', id: arg};
  if (name === 'calendar') return {...r, view: 'calendar', month: /^\d{4}-\d{2}$/.test(arg) ? arg : ''};
  if (name === 'money') return {...r, view: 'money'};
  if (name === 'docs') return {...r, view: 'schools', legacy: true};
  if (name === 'finder') return {...r, open: 'add', pid: arg, legacy: true};
  if (name === 'next') return r;
  return {...r, legacy: !!name && name !== 'next'};       // #week、#home、亂打的都回到接下來
}
export function href(view, arg = '') {
  return '#' + (VIEWS.includes(view) ? view : 'next') + (arg ? '/' + encodeURIComponent(arg) : '');
}
const canon = r => href(r.view, r.view === 'schools' ? r.id : r.view === 'calendar' ? r.month : '');
const same = (a, b) => a.view === b.view && a.id === b.id && a.month === b.month;

function set(r, how) {
  const h = canon(r);
  if (how && location.hash !== h) history[how === 'replace' ? 'replaceState' : 'pushState'](null, '', h);
  Object.assign(route, {view: r.view, id: r.id || '', month: r.month || '', open: r.open || '', pid: r.pid || ''});
}
const emit = () => { for (const fn of [...subs]) fn(route); };

// go('#schools/abc')、go({view:'schools', id:'abc'})、go('#calendar/2026-12', {replace:true})
export function go(target, {replace = false} = {}) {
  const r = typeof target === 'string' ? parse(target) : {...parse(href(target.view)), ...target, legacy: false};
  if (same(r, route) && !r.open && location.hash === canon(r)) return;
  set(r, replace || r.legacy ? 'replace' : 'push');
  emit();
}
// 只改網址列、不重畫（例如 #schools 自己選了第一間學校，網址補成 #schools/<id>）。
export function setUrl(target) {
  const r = typeof target === 'string' ? parse(target) : {...parse(href(target.view)), ...target};
  set(r, 'replace');
}
// 啟動時讀網址；舊網址換成新的（replace，不多一筆上一頁）。不通知，app.js 自己畫第一次。
export function start() {
  const r = parse(location.hash);
  set(r, r.legacy || !location.hash ? 'replace' : '');
  return route;
}
function onPop() {
  const r = parse(location.hash);
  if (same(r, route) && !r.open) return;
  set(r, r.legacy ? 'replace' : '');
  emit();
}
addEventListener('popstate', onPop);
addEventListener('hashchange', onPop);
