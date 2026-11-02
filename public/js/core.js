// 共用：時間、狀態、載入、儲存、提示、小工具。各畫面都從這裡 import。
// 寫入一律走 mutate() / addApp() / removeApp() / saveExpense() / deleteExpense() / saveProfile() / saveTodos()：
// 先改畫面上的那一份，再送到伺服器；伺服器說版本不對（409）就拿它的版本把同一個改動重做一次；
// 存不進去（500、斷線）就留著重試，畫面上掛一條「沒有存到，重試中…」。
import * as L from './logic.js';

/* ---------- 工具 ---------- */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const clone = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
export const uid = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
export const pad = n => String(n).padStart(2, '0');
export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const composing = e => e.isComposing || e.keyCode === 229;
export const debounce = (fn, ms) => {
  let t = null;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  f.flush = (...a) => { if (t === null) return; clearTimeout(t); t = null; fn(...a); };
  return f;
};
export const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 無痕模式 */ } },
};

/* ---------- 時間（台北） ---------- */
// ?now=2026-11-24T10:00 只給測試用：前端的時鐘固定在那個台北時間。沒有就用真的時間。
const FAKE = (() => {
  try {
    const v = new URLSearchParams(location.search).get('now') || '';
    const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(v);
    return m ? `${m[1]}T${m[2] || '00:00'}` : '';
  } catch { return ''; }
})();
export const fakeNow = FAKE;
const TPE = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
// 'YYYY-MM-DDTHH:MM'，台北的牆上時間；logic.js 的 now 參數都用這個。
export function now() {
  if (FAKE) return FAKE;
  const p = Object.fromEntries(TPE.formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}
export const today = () => now().slice(0, 10);

/* ---------- 狀態 ---------- */
// S：使用者的紀錄（/api/records、/api/meta）。P：簡章資料（/data/*.json），載入後不變。
export const S = {apps: [], expenses: [], todos: [], profile: {}, meta: {}, syncLog: [], loaded: false};
export const P = {loaded: false, schools: [], programs: [], byId: new Map(), fetched: '', year: null, source: '', pdf: new Set(), links: {}, aliases: {}, synonyms: {}, terms: {aliases: {}, synonyms: {}}, season: []};
const subs = new Set();
export const onChange = fn => { subs.add(fn); return () => subs.delete(fn); };
export function rerender() { for (const fn of [...subs]) { try { fn(); } catch (e) { console.error(e); } } }
let readyResolve;
export const ready = new Promise(r => { readyResolve = r; });
export const editing = () => !!document.body.dataset.editing;

/* ---------- 由紀錄推導（畫面共用，參數一致） ---------- */
export const appById = id => S.apps.find(a => a.id === id) || null;
export const programOf = app => (app && P.byId.get(app.programId)) || null;
export function schoolCode(app) {
  const p = programOf(app);
  if (p) return p.code;
  const s = P.schools.find(x => x.name === (app && app.school));
  return s ? s.code : '';
}
const okUrl = u => typeof u === 'string' && /^https?:\/\//.test(u) ? u : '';
// 報名系統、招生網、系網、簡章 PDF（沒有就是空字串）
export function linksOf(app) {
  const p = programOf(app), code = schoolCode(app), l = (code && P.links[code]) || {};
  return {apply: okUrl(l.apply), adm: okUrl(l.adm), dept: okUrl(app && app.url) || okUrl(p && p.u), pdf: code && P.pdf.has(code) ? `/data/brochures/pdf/${code}.pdf` : '', code};
}
export const pdfAt = (app, page) => { const u = linksOf(app).pdf; return u ? u + (page ? '#page=' + page : '') : ''; };
export const PALETTE = 10;
// 顏色：紀錄裡的 color（遷移時已固定）；沒有的話用加入的順序。
export function colourOf(app) {
  if (app && Number.isInteger(app.color)) return ((app.color % PALETTE) + PALETTE) % PALETTE;
  const i = S.apps.indexOf(app);
  return (i < 0 ? S.apps.length : i) % PALETTE;
}
export function nextColour() {
  const used = S.apps.map(colourOf);
  for (let i = 0; i < PALETTE; i++) if (!used.includes(i)) return i;
  return S.apps.length % PALETTE;
}
// 學校的名字：簡稱；同一間學校加了兩個系組才加系（「宜大 資工・資安組」），列、同天、提示、行事曆都用它。
export const shortName = app => app ? L.appName(app, S.apps, P.aliases) : '';
// 只有簡稱：旁邊已經寫了系的地方（學校清單、右欄標題、已加入提示）用這個，系才不會寫兩次。
export const schoolName = app => app ? L.shortSchool(app.school, P.aliases) : '';
export const deptName = app => app ? L.shortDept(app.dept || '') : '';
// logic.js 的共用參數（其他學校、簡稱、連結、學測成績日期）：每個畫面都傳一樣的，算出來才會一致。
export const lopts = extra => ({apps: S.apps, programs: P.byId, aliases: P.aliases, links: P.links, schools: P.schools, season: P.season, ...extra});
export const agendaNow = opts => L.agenda(S.apps, P.byId, now(), lopts(opts));
export const orderNow = () => L.orderApps(S.apps, P.byId, now());
export const stageOf = app => L.displayStage(app, programOf(app), now());
export const statusOf = app => L.statusWord(app, programOf(app), now());
export const nextOf = app => L.nextStep(app, programOf(app), now(), lopts());
export const timelineOf = app => L.timeline(app, programOf(app), now(), lopts());
export const eventsFor = (app, opts) => L.eventsOf(app, programOf(app), lopts(opts));
export const clashNow = () => L.clashes(S.apps, P.byId, now(), lopts());
// 花費的每一行（自動的報名費＋自己記的），新的在上面
export const expensesNow = () => L.expenseLines(S.apps, S.expenses, P.byId, lopts());
export const actx = app => ({now: now(), apps: S.apps, program: programOf(app), programs: P.byId, uid});
// 按鈕的動作：act(app.id, 'tick', {key:'pay'}, {toast:'已記下：北市大 繳費'})
export const act = (appId, actionId, payload, opts) => mutate(appId, a => L.applyAction(a, actionId, payload, actx(a)), opts);
// 幾間學校的簡稱，照學校清單的順序（同天、撞期在每個畫面都一樣）→ ['宜大', '高師大']
export function namesOf(ids) {
  const o = orderNow(), rank = new Map([...o.active, ...o.ended].map((a, i) => [a.id, i]));
  return [...new Set(ids || [])].map(appById).filter(Boolean).sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99)).map(shortName);
}
// 回答、決定之後的提示（接下來、學校頁共用）：寫新的狀態字「已記下：北市大 已報名」；狀態字不變的動作寫動作本身。
export function actionToast(app, id, payload = {}) {
  const name = shortName(app);
  if (id === 'skipInterview') return `已記下：${name} 不去`;
  if (id === 'notYet') return `已記下：${name} 還沒遞補`;
  if (id === 'keep') return `已記下：留在 ${name}`;
  if (id === 'swap') return `已記下：換到 ${name}`;
  let after;
  try { after = L.applyAction(app, id, payload, actx(app)); } catch { return ''; }
  return `已記下：${name} ${L.statusWord(after, programOf(app), now())}`;
}
// 打勾的提示：狀態變了（勾完 → 已報名）寫新的狀態字；勾完一列的最後一個必繳部分（那列會不見）也給提示，才能復原。
export function tickToast(app, key, done, row) {
  let after;
  try { after = L.applyAction(app, 'tick', {key, done}, actx(app)); } catch { return ''; }
  if (after.status !== app.status) return `已記下：${shortName(app)} ${L.statusWord(after, programOf(app), now())}`;
  const last = done && row && row.parts && !row.parts.some(pt => !pt.opt && !pt.done && pt.key !== key);
  return last ? `已記下：${shortName(app)} ${row.parts.filter(pt => !pt.opt).map(pt => pt.name).join('・')}` : '';
}
// 學測、分科等大考日期（data/season.json），設定裡可以關掉。
export const seasonItems = () => S.profile.hideExams ? [] : P.season.filter(e => isDate(e.date)).map(e => ({...e, end: isDate(e.end) && e.end > e.date ? e.end : ''}));

/* ---------- 一直在的提示列 ---------- */
// 一次只顯示一條，依重要性：網頁要重新整理 > 沒有存到 > 連不到 > 從備份還原
const bars = new Map();
const BAR_ORDER = ['stale', 'save', 'load', 'recovered'];
export function setBar(kind, opts) {
  if (opts) bars.set(kind, opts); else bars.delete(kind);
  const el = $('#bar');
  if (!el) return;
  const k = BAR_ORDER.find(x => bars.has(x)) || [...bars.keys()][0];
  if (!k) { el.hidden = true; el.innerHTML = ''; return; }
  const b = bars.get(k);
  el.className = b.err ? 'err' : '';
  el.innerHTML = `<span class="msg">${esc(b.msg)}</span>${b.btn ? `<button class="btn sm" type="button">${esc(b.btn.label)}</button>` : ''}`;
  if (b.btn) el.querySelector('button').onclick = b.btn.fn;
  el.hidden = false;
  toTop(el);
}
// 打開的對話框在最上層，提示要搬進去才看得到。
export function toTop(el) {
  const host = $$('dialog[open]').pop() || document.body;
  if (el && el.parentElement !== host) host.append(el);
}

/* ---------- 提示（下方置中，一次一則） ---------- */
let toastT = 0, toastUndo = null;
export function toast(msg, {undo, action, ms} = {}) {
  const el = $('#toast');
  if (!el) return;
  toTop(el);
  const a = undo ? {label: '復原', fn: undo} : action;
  el.innerHTML = `<span class="msg">${esc(msg)}</span>${a ? `<button type="button">${esc(a.label)}</button>` : ''}`;
  toastUndo = undo || null;
  if (a) el.querySelector('button').onclick = () => { hideToast(); a.fn(); };
  const life = ms || (a ? 8000 : 3000);
  el.onmouseenter = () => clearTimeout(toastT);
  el.onmouseleave = () => { clearTimeout(toastT); toastT = setTimeout(hideToast, 2500); };
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(hideToast, life);
}
export function hideToast() { clearTimeout(toastT); toastUndo = null; const el = $('#toast'); if (el) el.classList.remove('show'); }
export function undoLast() { const u = toastUndo; if (!u) return false; hideToast(); u(); return true; }

/* ---------- 連線 ---------- */
export async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {method, cache: 'no-cache', headers: {'X-Client': '3', ...(body !== undefined ? {'Content-Type': 'application/json'} : {})}, body: body !== undefined ? JSON.stringify(body) : undefined});
  } catch {
    const err = new Error('連不到伺服器'); err.status = 0; throw err;
  }
  let data = null;
  if (res.status !== 204) { const t = await res.text(); try { data = t ? JSON.parse(t) : null; } catch { data = t; } }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}
// 重試的等待：1、2、4…30 秒；回到網頁或恢復連線就馬上再試。
const wakers = new Set();
const nap = ms => new Promise(r => { const w = () => { clearTimeout(t); wakers.delete(w); r(); }; const t = setTimeout(w, ms); wakers.add(w); });
export const wakeRetries = () => { for (const w of [...wakers]) w(); };
const backoff = n => Math.min(30000, 1000 * 2 ** n);
const failing = new Set();
function setFailing(key, on) {
  if (on) failing.add(key); else failing.delete(key);
  setBar('save', failing.size ? {msg: '沒有存到，重試中…', err: true} : null);
}
// 舊版網頁（沒帶 X-Client: 3）或伺服器更新過：只能重新整理。
function stale(msg) { setBar('stale', {msg: msg || '網頁已更新，請重新整理', err: true, btn: {label: '重新整理', fn: () => location.reload()}}); }

/* ---------- 改學校紀錄、花費：mutate ---------- */
// 一筆一筆存的有兩種：學校（/api/apps/:id）和花費（/api/expenses/:id）。佇列、409 重做、重試、刪除後 8 秒內可以復原，兩種都一樣。
// fn(複本) 可以直接改複本，或回傳新的物件（logic.applyAction 就是回傳新的）。
// 每一筆一個佇列：還沒被伺服器確認的 fn 都留著，409 時拿伺服器的版本依序重做。
const KIND = {
  app: {list: () => S.apps, url: id => `/api/apps/${encodeURIComponent(id)}`, field: 'app', name: a => shortName(a)},
  exp: {list: () => S.expenses, url: id => `/api/expenses/${encodeURIComponent(id)}`, field: 'expense', name: e => e && e.what ? `「${e.what}」` : '這筆花費'},
};
const qkey = (kind, id) => `${kind}:${id}`;
const itemOf = (kind, id) => KIND[kind].list().find(x => x.id === id) || null;
export const expenseById = id => itemOf('exp', id);
const Q = new Map();
const IGNORE = new Set(['rev', 'updatedAt']);
const applyFn = (fn, app) => { const c = clone(app); const r = fn(c); return r && typeof r === 'object' ? r : c; };
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function changedKeys(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  return [...keys].filter(k => !IGNORE.has(k) && !sameJson(a[k], b[k]));
}
function putLocal(item, kind = 'app') {
  const list = KIND[kind].list(), i = list.findIndex(a => a.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
}
export const saving = () => [...Q.values()].some(q => q.fns.length) || [...W.values()].some(w => w.busy) || pendingDelete.size > 0;

export function mutate(appId, fn, opts = {}) { return mutateMany([[appId, fn]], opts); }
// 一次改幾間（例如換到 B：A 已放棄、B 已報到），一則提示、一個復原。
export const mutateMany = (list, opts) => mutateItems('app', list, opts);
function mutateItems(kind, list, {toast: msg = '', undo = true, action = null, ms} = {}) {
  const undos = [], done = [];
  for (const [id, fn] of list) {
    const before = itemOf(kind, id);
    if (!before) continue;
    let after;
    try { after = applyFn(fn, before); } catch (e) { console.error(e); continue; }
    const keys = changedKeys(before, after);
    if (!keys.length) continue;
    after.rev = before.rev;
    putLocal(after, kind);
    const prev = clone(before);
    undos.push([id, cur => { for (const k of keys) { if (prev[k] === undefined) delete cur[k]; else cur[k] = clone(prev[k]); } }]);
    done.push(enqueue(kind, id, fn));
  }
  if (done.length) rerender();
  if (msg) toast(msg, undo && undos.length ? {undo: () => { mutateItems(kind, undos); }, ms} : {action, ms});
  return Promise.all(done);
}
// 新增一間（加學校）。app 要有 id；回傳存好時 resolve 的 promise。
export function addApp(app, {toast: msg = '', action = null} = {}) {
  if (!app.id) app.id = uid();
  if (!Number.isInteger(app.color)) app.color = nextColour();
  if (!app.createdAt) app.createdAt = Date.now();
  putLocal(clone(app));
  rerender();
  if (msg) toast(msg, {action});
  return enqueue('app', app.id, a => a);
}
// 花費：新的一筆或改一筆（只送 entry 裡的欄位；409 時套在伺服器的版本上）。新的那筆的「復原」是直接刪掉。
export function saveExpense(entry, {toast: msg = '', undo = true} = {}) {
  if (!entry.id) entry.id = uid();
  const {id, rev, createdAt, ...patch} = entry;
  if (itemOf('exp', id)) return mutateItems('exp', [[id, e => Object.assign(e, clone(patch))]], {toast: msg, undo});
  putLocal({...clone(entry), rev: 0, createdAt: createdAt || Date.now()}, 'exp');
  rerender();
  if (msg) toast(msg, undo ? {undo: () => removeItem('exp', id, {immediate: true})} : {});
  return enqueue('exp', id, e => e);
}
// 刪一筆花費：和刪學校一樣，8 秒內可以復原
export const deleteExpense = (id, opts) => removeItem('exp', id, opts);

function enqueue(kind, id, fn) {
  const key = qkey(kind, id);
  let q = Q.get(key);
  if (!q) Q.set(key, q = {fns: [], busy: null});
  q.fns.push(fn);
  if (!q.busy) q.busy = flush(kind, id, q).finally(() => { q.busy = null; });
  return q.busy;
}
async function flush(kind, id, q) {
  const K = KIND[kind], key = qkey(kind, id);
  let tries = 0, conflicts = 0;
  while (q.fns.length) {
    // 刪除後 8 秒內：先不送，復原時再送。「重試中」也要收掉，不然刪掉之後還一直顯示
    if (pendingDelete.has(key)) { setFailing(key, false); return; }
    const item = itemOf(kind, id);
    if (!item) { q.fns = []; break; }
    const sent = q.fns.length;
    let res;
    try { res = {ok: true, data: await request('PUT', K.url(id), item)}; }
    catch (e) { res = {ok: false, status: e.status, data: e.data, msg: e.message}; }
    if (res.ok) {
      tries = 0; conflicts = 0;
      q.fns.splice(0, sent);
      setFailing(key, false);
      const saved = res.data && typeof res.data === 'object' ? (res.data[K.field] || res.data) : null;
      const cur = itemOf(kind, id);
      if (cur && saved && saved.rev != null) cur.rev = saved.rev;
      // 沒有新的改動在排隊：改用伺服器的版本（伺服器會補回它保管的欄位）
      if (cur && saved && saved.id === id && !q.fns.length && !pendingDelete.has(key)) {
        const differs = changedKeys(cur, saved).length > 0;
        putLocal(saved, kind);
        if (differs) rerender();
      }
      continue;
    }
    const cur = res.data && typeof res.data === 'object' ? (res.data[K.field] || (res.data.id === id ? res.data : null)) : null;
    if (res.status === 409 && cur) {
      // 別的分頁或手機先改過：用伺服器的版本重做一次還沒確認的改動
      if (++conflicts > 3) {
        putLocal(cur, kind); q.fns = []; rerender();
        // 先清掉「重試中」再顯示訊息；不然迴圈後面的 setFailing 會把這個訊息也清掉
        setFailing(key, false);
        setBar('save', {msg: `${K.name(cur)} 的改動沒有存到，已換成最新的資料`, err: true, btn: {label: '知道了', fn: () => setBar('save', null)}});
        return;
      }
      let base = cur;
      for (const f of q.fns) { try { base = applyFn(f, base); } catch (e) { console.error(e); } }
      base.rev = cur.rev;
      putLocal(base, kind);
      rerender();
      continue;
    }
    if (res.status === 409) { q.fns = []; stale(res.msg); break; }
    // 4xx（例如 410：別的分頁或裝置已經刪掉這筆）：不再重試，重新載入（刪掉的就從畫面上拿掉），留著訊息
    if (res.status >= 400 && res.status < 500) {
      q.fns = [];
      setFailing(key, false);
      setBar('save', {msg: `沒有存到：${res.msg}`, err: true, btn: {label: '知道了', fn: () => setBar('save', null)}});
      refresh({force: true});
      return;
    }
    setFailing(key, true);
    await nap(backoff(tries++));
  }
  setFailing(key, false);
}

/* ---------- 刪除：8 秒內可以復原 ---------- */
// key 是 'app:<id>' 或 'exp:<id>'
const pendingDelete = new Map();
const isPendingDelete = (kind, id) => pendingDelete.has(qkey(kind, id));
export function removeApp(id, {toast: msg} = {}) {
  const app = appById(id);
  if (app) removeItem('app', id, {toast: msg || `已刪除 ${shortName(app)}`});
}
// immediate：不等 8 秒、沒有提示（剛記下的花費按「復原」）
function removeItem(kind, id, {toast: msg = '', immediate = false} = {}) {
  const list = KIND[kind].list(), i = list.findIndex(a => a.id === id), key = qkey(kind, id);
  if (i < 0) return;
  const item = list[i];
  list.splice(i, 1);
  if (immediate) { pendingDelete.set(key, {kind, id, item, index: i, timer: 0}); rerender(); commitDelete(key); return; }
  const undo = () => {
    const p = pendingDelete.get(key);
    if (!p) return;
    clearTimeout(p.timer);
    pendingDelete.delete(key);
    const cur = KIND[kind].list();     // 重新載入過的話已經是另一個陣列
    cur.splice(Math.min(p.index, cur.length), 0, p.item);
    rerender();
    const q = Q.get(key);
    if (q && q.fns.length && !q.busy) q.busy = flush(kind, id, q).finally(() => { q.busy = null; });
  };
  // 8 秒後才送出；提示還在（滑鼠停在上面）就再等，「復原」按得到的時候一定有用
  const later = ms => setTimeout(() => {
    const p = pendingDelete.get(key);
    if (p && toastUndo === undo) p.timer = later(500);
    else if (p) commitDelete(key);
  }, ms);
  pendingDelete.set(key, {kind, id, item, index: i, timer: later(8000)});
  rerender();
  toast(msg || '已刪除', {ms: 8000, undo});
}
async function commitDelete(key) {
  const p = pendingDelete.get(key);
  if (!p) return;
  const q = Q.get(key);
  // 還在送的那一次（剛新增的 PUT）先等它回來，DELETE 才不會比它早到、被它加回去
  if (q && q.busy) { wakeRetries(); await q.busy.catch(() => {}); }
  if (q) q.fns = [];
  let tries = 0;
  for (;;) {
    try { await request('DELETE', KIND[p.kind].url(p.id)); break; }
    catch (e) {
      if (e.status === 404) break;
      if (e.status === 409) { stale(e.message); break; }
      if (e.status >= 400 && e.status < 500) { setBar('save', {msg: `沒有刪除：${e.message}`, err: true, btn: {label: '知道了', fn: () => setBar('save', null)}}); break; }
      setFailing('del:' + key, true);
      await nap(backoff(tries++));
    }
  }
  setFailing('del:' + key, false);
  pendingDelete.delete(key);
}
// 關掉網頁時，還在復原時間內的刪除直接送出。
addEventListener('pagehide', () => {
  for (const p of pendingDelete.values()) { try { fetch(KIND[p.kind].url(p.id), {method: 'DELETE', keepalive: true, headers: {'X-Client': '3'}}); } catch { /* ignore */ } }
});
// 還有沒存到的改動就先提醒，不要直接關掉。
addEventListener('beforeunload', e => { if ([...Q.values()].some(q => q.fns.length)) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- 設定、待辦：整份覆蓋，最後一次為準 ---------- */
const W = new Map();
function write(key, send) {
  let w = W.get(key);
  if (!w) W.set(key, w = {dirty: false, busy: null, send: null});
  w.dirty = true; w.send = send;
  // 回傳的 promise：存好是 true；伺服器拒絕（409、4xx）是 false。500 和斷線會一直重試，存好才 resolve。
  if (!w.busy) w.busy = (async () => {
    let tries = 0, ok = true;
    while (w.dirty) {
      w.dirty = false;
      try { await w.send(); tries = 0; ok = true; setFailing(key, false); }
      catch (e) {
        if (e.status === 409) { stale(e.message); ok = false; break; }
        if (e.status >= 400 && e.status < 500) { setBar('save', {msg: `沒有存到：${e.message}`, err: true, btn: {label: '知道了', fn: () => setBar('save', null)}}); ok = false; break; }
        w.dirty = true; setFailing(key, true);
        await nap(backoff(tries++));
      }
    }
    setFailing(key, false);
    w.busy = null;
    return ok;
  })();
  return w.busy;
}
export function saveProfile(patch) {
  S.profile = {...S.profile, ...patch};
  rerender();
  return write('profile', () => request('PUT', '/api/profile', S.profile));
}
// 先改 S.todos，再呼叫 saveTodos()。
export function saveTodos() {
  rerender();
  return write('todos', () => request('PUT', '/api/todos', S.todos));
}

/* ---------- 載入 ---------- */
const byCreated = (a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
// 伺服器的清單，加上自己還沒存好的：排隊中的用自己這份，復原時間內刪掉的不要被帶回來，剛加、還沒存好的留著
function mergeList(kind, server) {
  const mine = KIND[kind].list(), local = new Map(mine.map(a => [a.id, a]));
  const queued = id => { const q = Q.get(qkey(kind, id)); return !!(q && q.fns.length); };
  const out = [];
  for (const a of server) {
    if (!a || isPendingDelete(kind, a.id)) continue;
    out.push(queued(a.id) && local.has(a.id) ? local.get(a.id) : a);
  }
  for (const a of mine) if (queued(a.id) && !server.some(x => x && x.id === a.id)) out.push(a);
  return out;
}
function applyRecords(d) {
  const apps = mergeList('app', Array.isArray(d && d.apps) ? d.apps : []).sort(byCreated);
  const expenses = mergeList('exp', Array.isArray(d && d.expenses) ? d.expenses : []);
  const todos = Array.isArray(d && d.todos) ? d.todos : [];
  const profile = W.get('profile') && W.get('profile').busy ? S.profile : (d && d.profile) || {};
  const syncLog = Array.isArray(d && d.syncLog) ? d.syncLog : [];
  const changed = !S.loaded || !sameJson(apps, S.apps) || !sameJson(expenses, S.expenses) || !sameJson(todos, S.todos) || !sameJson(profile, S.profile);
  S.apps = apps;
  S.expenses = expenses;
  if (!(W.get('todos') && W.get('todos').busy)) S.todos = todos;
  S.profile = profile;
  S.syncLog = syncLog;
  S.loaded = true;
  return changed;
}
export async function loadPrograms() {
  const [d, terms, links, season] = await Promise.all([
    request('GET', '/data/programs.json'),
    request('GET', '/data/search-terms.json').catch(() => null),
    request('GET', '/data/school-links.json').catch(() => null),
    request('GET', '/data/season.json').catch(() => null),
  ]);
  P.schools = Array.isArray(d.schools) ? d.schools : [];
  P.fetched = d.fetched || '';
  P.year = d.year || null;
  P.source = d.source || '';
  // 每個系組補上學校全名、代碼、地區（programs.json 只存學校的索引 s）
  P.programs = (d.programs || []).map(p => { const s = P.schools[p.s] || {}; return Object.assign(p, {school: s.name || '', code: s.code || '', region: s.region || ''}); });
  P.byId = new Map(P.programs.map(p => [p.i, p]));
  if (terms) { P.aliases = terms.aliases || {}; P.synonyms = terms.synonyms || {}; P.terms = {aliases: P.aliases, synonyms: P.synonyms}; }
  if (links) P.links = links.schools || {};
  if (season && Array.isArray(season.events)) P.season = season.events;
  P.loaded = true;
}
function applyMeta(m) {
  S.meta = m && typeof m === 'object' ? m : {};
  if (Array.isArray(S.meta.pdfSchools)) P.pdf = new Set(S.meta.pdfSchools);
}
// 第一次載入：紀錄和簡章資料都到了才 resolve（畫面要兩個都有才畫得出來）。
export async function load() {
  const meta = request('GET', '/api/meta').catch(() => null);
  const progs = loadPrograms().catch(e => { console.error(e); setBar('load', {msg: '簡章資料沒有載入', err: true, btn: {label: '重新整理', fn: () => location.reload()}}); });
  let d;
  try { d = await request('GET', '/api/records'); }
  catch (e) { setBar('load', {msg: '連不到伺服器', err: true, btn: {label: '重試', fn: () => location.reload()}}); throw e; }
  applyRecords(d);
  applyMeta(await meta);
  await progs;
  lastLoad = Date.now();
  readyResolve();
}
// 回到網頁時重新載入（別的裝置可能改過）。「改」表單打開時不載，免得蓋掉正在打的字。
let lastLoad = 0;
export async function refresh({force = false} = {}) {
  if (!S.loaded || (!force && (editing() || Date.now() - lastLoad < 2000))) return false;
  lastLoad = Date.now();
  wakeRetries();
  try {
    const [d, meta] = await Promise.all([request('GET', '/api/records'), request('GET', '/api/meta').catch(() => null)]);
    if (!force && editing()) return false;
    setBar('load', null);
    if (meta) applyMeta(meta);
    const changed = applyRecords(d);
    if (changed) rerender();
    return changed;
  } catch (e) {
    if (e.status === 0) setBar('load', {msg: '連不到伺服器', err: true, btn: {label: '重試', fn: () => refresh({force: true})}});
    return false;
  }
}
addEventListener('online', wakeRetries);

/* ---------- 簡章更新的標記 ---------- */
// syncLog：[{id, at, changes:[{appId, school, what, from, to, added?, removed?, gone?, conflict?}]}]；同步改到的日期列有 upd = 那次的 id。
// 學校頁在打開那間時把它的標記收掉（ackSync）。
export function syncEntries() {
  const all = [...(S.syncLog || []), S.meta && S.meta.syncLog].filter(x => x && x.id && Array.isArray(x.changes));
  const seen = new Set();
  return all.filter(x => !seen.has(x.id) && seen.add(x.id));
}
export function syncMarks(appId) {
  const acked = ls.get('syncAck', {});
  return syncEntries().flatMap(x => (acked[x.id] || []).includes(appId) ? [] : x.changes.filter(c => c.appId === appId));
}
// 這間還沒看過的同步 id：日期列的 upd 在裡面，就在那一列寫「簡章更新」。
export function syncUnseen(appId) {
  const acked = ls.get('syncAck', {});
  return new Set(syncEntries().filter(x => x.changes.some(c => c.appId === appId) && !(acked[x.id] || []).includes(appId)).map(x => x.id));
}
export function ackSync(appId) {
  const acked = ls.get('syncAck', {});
  let dirty = false;
  for (const x of syncEntries()) if (x.changes.some(c => c.appId === appId) && !(acked[x.id] || []).includes(appId)) { (acked[x.id] = acked[x.id] || []).push(appId); dirty = true; }
  if (dirty) ls.set('syncAck', acked);
}

/* ---------- 其他 ---------- */
// 內網的 http 網址沒有 navigator.clipboard，退回用隱藏的 textarea 複製。
export async function copyText(text, okMsg = '已複製') {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); toast(okMsg); return true; } } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.append(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy'); ta.remove();
    toast(ok ? okMsg : '沒辦法自動複製，請手動選取'); return ok;
  } catch { toast('沒辦法自動複製，請手動選取'); return false; }
}
export function download(name, text, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = Object.assign(document.createElement('a'), {href: url, download: name});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
// 配色：''（跟著系統）／'light'／'dark'。localStorage 存純字串，index.html 開頭那段會讀。
export function setTheme(t) {
  const on = t === 'light' || t === 'dark';
  if (on) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { if (on) localStorage.setItem('theme', t); else localStorage.removeItem('theme'); } catch { /* 無痕模式 */ }
}
export const theme = () => document.documentElement.dataset.theme || '';

// 「我的條件」：勾選的經歷，對照簡章的報名資格文字（設定、加學校共用）。關鍵字比對前會先正規化（小寫、台→臺）。
export const CONDITIONS = [
  {group: '資訊', items: [
    {id: 'apcs', label: 'APCS 程式設計先修檢測', kw: ['apcs', '程式設計先修']},
    {id: 'ais3', label: 'AIS3 資安暑期課程', kw: ['ais3', '新型態資安']},
    {id: 'jindun', label: '金盾獎', kw: ['金盾']},
    {id: 'ctf', label: 'CTF 資安競賽', kw: ['ctf']},
    {id: 'infocomp', label: '資訊學科能力競賽', kw: ['資訊學科', '學科能力競賽(資訊', '資訊科)複賽', '資訊科)決賽']},
    {id: 'progcomp', label: '程式設計競賽（NPSC、ICPC…）', kw: ['程式設計競賽', '程式競賽', 'npsc', 'icpc', 'toi', 'yti', 'apcs 程式']},
    {id: 'cpe', label: 'CPE 程式能力檢定', kw: ['cpe', '程式能力檢定']},
    {id: 'project', label: '自己做過程式專案／作品', kw: ['程式作品', 'github', '專案', '軟體', 'app']},
    {id: 'cert', label: '資訊相關證照', kw: ['證照', 'ipas', '乙級', '丙級']},
  ]},
  {group: '科學・數理', items: [
    {id: 'olympiad', label: '奧林匹亞（選訓營、決賽）', kw: ['奧林匹亞', '奧林匹克', '選訓']},
    {id: 'sciencefair', label: '科展', kw: ['科展', '科學展覽']},
    {id: 'mathcomp', label: '數學競賽（AMC、TRML…）', kw: ['數學競賽', 'amc', 'trml', '數學能力競賽', '數學科']},
    {id: 'research', label: '專題研究／小論文', kw: ['專題研究', '小論文', '研究成果', '科學研究', '研究報告']},
    {id: 'invention', label: '發明展／專利／創客', kw: ['發明', '專利', '創客', 'maker']},
  ]},
  {group: '語文・人文', items: [
    {id: 'english', label: '英語檢定（多益、托福、雅思…）', kw: ['toeic', 'toefl', 'ielts', '英檢', '多益', '英語能力', '英文能力', '英語檢定']},
    {id: 'otherlang', label: '其他外語檢定（日檢、德檢…）', kw: ['日檢', 'jlpt', '德語', '法語', '西班牙語', '韓語', '外語能力', '語言能力檢定']},
    {id: 'writing', label: '文學獎／寫作／創作', kw: ['文學獎', '徵文', '寫作', '作文', '文學創作']},
    {id: 'speech', label: '演說／辯論／朗讀', kw: ['演說', '辯論', '朗讀', '演講']},
  ]},
  {group: '藝術・體育', items: [
    {id: 'art', label: '美術／設計作品', kw: ['美術', '設計', '繪畫', '作品集', '視覺']},
    {id: 'music', label: '音樂／表演／舞蹈', kw: ['音樂', '演奏', '表演', '舞蹈', '戲劇']},
    {id: 'sports', label: '體育選手／運動成績', kw: ['運動', '體育', '選手', '全中運', '全國運動會', '競技']},
    {id: 'esports', label: '電競', kw: ['電競', '電子競技']},
  ]},
  {group: '社會參與・技能', items: [
    {id: 'leadership', label: '社團幹部／領導經驗', kw: ['社團', '幹部', '領導', '班聯會', '學生會']},
    {id: 'service', label: '志工／服務學習', kw: ['志工', '服務學習', '公益']},
    {id: 'business', label: '創業／商業競賽', kw: ['創業', '商業', '企劃', '行銷']},
    {id: 'skills', label: '技藝／技能競賽', kw: ['技藝競賽', '技能競賽', '工科技藝', '商科技藝', '技藝']},
  ]},
  {group: '身分（不同教育資歷）', items: [
    {id: 'experimental', label: '實驗教育／自學生', kw: ['實驗教育', '自學']},
    {id: 'newimmigrant', label: '新住民或其子女', kw: ['新住民']},
    {id: 'disadvantaged', label: '低收入／中低收入／特殊境遇', kw: ['低收入', '中低收入', '特殊境遇', '經濟弱勢', '弱勢']},
    {id: 'overseas', label: '境外臺生／僑生', kw: ['境外', '僑生', '海外']},
    {id: 'local', label: '在地／偏鄉／離島／原住民', kw: ['在地', '偏鄉', '離島', '原住民', '花東']},
    {id: 'vocational', label: '高職／技術型高中', kw: ['高職', '技術型高中', '技高']},
  ]},
];
export const COND_BY_ID = new Map(CONDITIONS.flatMap(g => g.items).map(c => [c.id, c]));
