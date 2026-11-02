// 花費（#money）：左邊是一直在的「記一筆」表單和依月份分組的清單，右邊是這次特選花了多少（焦點，同一行右邊是下載 CSV）、依類別、依學校。
// 報名費是自動的（logic.expenseLines）：改那一行就是改學校的報名費（app.fee），「沒繳」把它藏起來。
// 學校頁的「花費」那一塊也在這裡畫（schoolBlock），「＋ 記花費」打開同一個表單、學校就是這間；點一行和花費頁一樣變成「改」表單。
import {$, S, P, esc, today, uid, appById, programOf, shortName, orderNow, expensesNow, expenseById, saveExpense, deleteExpense, act} from './core.js';
import {hueAttr, amt, isEditing, closeEdit, editForm, onEditSave} from './ui.js';
import * as L from './logic.js';

// 記一筆的草稿：'' 是花費頁那一份，學校頁每間一份（key 是 app.id）。類別、學校自己選過就不再自動帶。
const DR = new Map();
let flashId = '', flashT = 0;
function draftOf(ctx) {
  let d = DR.get(ctx);
  if (!d) DR.set(ctx, d = {date: '', what: '', amount: '', cat: 'other', catSet: false, appId: ctx, appSet: !!ctx, err: '', errAt: ''});
  if (!L.isKey(d.date)) d.date = today();
  if (!d.catSet) d.cat = L.guessCat(d.what);
  if (!d.appSet) d.appId = L.guessSchool(S.apps, P.byId, d.date);
  if (d.appId && !appById(d.appId)) d.appId = '';
  return d;
}
// 記下之後：日期留著，其他清掉、類別和學校回到自動
const resetDraft = (ctx, date) => { Object.assign(draftOf(ctx), {date, what: '', amount: '', catSet: false, appSet: !!ctx, appId: ctx, err: '', errAt: ''}); draftOf(ctx); };

/* ---------- 欄位 ---------- */
const catOptions = cur => L.CATS.map(k => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(L.CAT_LABEL[k])}</option>`).join('');
// 學校：照學校清單的順序；學校刪掉了、這筆還記著的，用記下時的名字留一個選項
function schoolOptions(cur, snapshot = '') {
  const {active, ended} = orderNow();
  const opts = [...active, ...ended].map(a => `<option value="${esc(a.id)}"${a.id === cur ? ' selected' : ''}>${esc(shortName(a))}</option>`);
  if (cur && !appById(cur)) opts.push(`<option value="${esc(cur)}" selected>${esc(snapshot || '已刪除的學校')}</option>`);
  return `<option value=""${cur ? '' : ' selected'}>學校（選填）</option>${opts.join('')}`;
}
const amountInput = (v, attrs = '') => `<span class="mn-amt"><input type="text" name="amount" value="${esc(v)}" inputmode="numeric" maxlength="12" placeholder="金額" aria-label="金額" autocomplete="off"${attrs}><span>元</span></span>`;
// 日期・項目・金額・類別・學校（花費頁和學校頁同一組）。學校頁的學校就是那一間（標題寫著），不再放選單，一行放得下；要換學校到花費頁改。
function fieldsHtml(d, fixed = false) {
  return `<input type="date" name="date" value="${esc(d.date)}" aria-label="日期" required>
    <input type="text" name="what" value="${esc(d.what)}" maxlength="${L.WHAT_MAX}" placeholder="例如：高鐵 台北→台中" aria-label="項目" data-first>
    ${amountInput(d.amount)}
    <select name="cat" aria-label="類別">${catOptions(d.cat)}</select>
    ${fixed ? `<input type="hidden" name="appId" value="${esc(d.appId)}">` : `<select name="appId" aria-label="學校">${schoolOptions(d.appId)}</select>`}`;
}
// 讀表單：{entry} 或 {err, at}
function readForm(f) {
  const el = f.elements, date = el.date.value, what = el.what.value.trim(), raw = el.amount.value.trim(), amount = L.parseAmount(raw);
  if (!L.isKey(date)) return {err: '日期要填', at: 'date'};
  if (!what) return {err: '項目要填', at: 'what'};
  if (!raw) return {err: '金額要填', at: 'amount'};
  if (amount === null) return {err: /^\d[\d,]*$/.test(raw.replace(/\s|元$/g, '')) ? `金額最多 ${amt(L.AMOUNT_MAX)} 元` : '金額寫整數，例如 1490', at: 'amount'};
  const app = appById(el.appId.value);
  return {entry: {date, what, amount, cat: L.CAT_LABEL[el.cat.value] ? el.cat.value : L.guessCat(what), appId: app ? app.id : el.appId.value, school: app ? shortName(app) : ''}};
}
function flash(id) {
  flashId = id;
  clearTimeout(flashT);
  flashT = setTimeout(() => { flashId = ''; }, 1600);
}
// 記下：草稿清掉（日期留著），提示「已記下 1,490 元　復原」
function addFrom(f, ctx) {
  const r = readForm(f);
  if (r.err) return r;
  const entry = {id: uid(), ...r.entry};
  resetDraft(ctx, entry.date);
  flash(entry.id);
  saveExpense(entry, {toast: `已記下 ${amt(entry.amount)} 元`});
  return r;
}

/* ---------- 清單 ---------- */
function monthLabels(keys) {
  const nums = keys.map(k => k.slice(5, 7));
  const twice = nums.some((n, i) => nums.indexOf(n) !== i);
  return k => !k ? '沒有日期' : twice ? `${k.slice(0, 4)} 年 ${Number(k.slice(5, 7))} 月` : `${Number(k.slice(5, 7))} 月`;
}
const catText = l => l.what === L.CAT_LABEL[l.cat] ? '' : L.CAT_LABEL[l.cat];
function schoolSpan(l) {
  const app = l.appId && appById(l.appId);
  return app ? `<span class="s sch" ${hueAttr(app)}>${esc(l.school)}</span>` : `<span class="s">${esc(l.school)}</span>`;
}
const amountSpan = l => `<span class="a${l.unknown ? ' unk' : ''}">${l.unknown ? '—' : amt(l.amount)}</span>`;
function rowHtml(l) {
  const key = 'mn:' + l.id;
  if (isEditing(key)) return editHtml(l, key);
  return `<button type="button" class="mn-row${flashId === l.id ? ' flash' : ''}" data-edit="${esc(key)}" data-line="${esc(l.id)}"><span class="d">${esc(l.date ? L.fmtDate(l.date) : '')}</span>${schoolSpan(l)}<span class="w">${esc(l.what)}</span><span class="c">${esc(catText(l))}</span>${amountSpan(l)}</button>`;
}
// 點一行 → 那一行變成表單（同樣的欄位）。自動的報名費只能改金額，刪除換成「沒繳」。學校頁（fixed）不放學校，和記花費一樣。
function editHtml(l, key, fixed = false) {
  if (l.derived) {
    const app = appById(l.appId);
    const inner = `<div class="mn-ef"><span class="d">${esc(l.date ? L.fmtDate(l.date) : '')}</span>${fixed ? '' : schoolSpan(l)}<span class="w">${esc(l.what)}</span>${fixed ? '' : '<span class="c"></span>'}${amountInput(l.unknown ? '' : String(l.amount), ' data-first')}</div><p class="form-err" data-err></p>`;
    return editForm(key, inner, {cls: 'mn-ed mn-ed-fee', extra: app ? `<button class="link push" type="button" data-mn-skip="${esc(app.id)}">沒繳</button>` : ''});
  }
  const inner = `<div class="mn-ef"><input type="date" name="date" value="${esc(l.date)}" aria-label="日期" required>
    ${fixed ? `<input type="hidden" name="appId" value="${esc(l.appId)}">` : `<select name="appId" aria-label="學校">${schoolOptions(l.appId, l.school)}</select>`}
    <input type="text" name="what" value="${esc(l.what)}" maxlength="${L.WHAT_MAX}" aria-label="項目" data-first>
    <select name="cat" aria-label="類別">${catOptions(l.cat)}</select>
    ${amountInput(String(l.amount))}</div><p class="form-err" data-err></p>`;
  return editForm(key, inner, {cls: 'mn-ed', extra: `<button class="link danger push" type="button" data-mn-del="${esc(l.id)}">刪除</button>`});
}
function listHtml(lines) {
  if (!lines.length) return '<p class="empty mn-empty">還沒有記錄。</p>';
  // 學校那一欄的寬度跟著最長的簡稱（每一行對齊）
  const sw = Math.max(2, ...lines.map(l => [...l.school].length));
  const months = [];
  for (const l of lines) {
    const k = l.date.slice(0, 7), m = months[months.length - 1];
    if (m && m.k === k) m.lines.push(l); else months.push({k, lines: [l]});
  }
  const label = monthLabels(months.map(m => m.k));
  return `<div class="mn-months" style="--sw:${sw}em">` + months.map(m => `<section class="mn-mon"><h3 class="mn-mh"><span>${esc(label(m.k))}</span><span class="mn-ms">${amt(m.lines.reduce((n, l) => n + l.amount, 0))} 元</span></h3>
    <div class="mn-rows">${m.lines.map(rowHtml).join('')}</div></section>`).join('') + '</div>';
}

/* ---------- 右邊：合計（焦點）、依類別、依學校 ---------- */
// 下載 CSV 放在「這次特選花了」那一行的右邊：學校一多，依學校的清單會比右欄高，放在最底下就看不到了
function sumHtml(lines) {
  const t = L.expenseTotals(lines);
  const cats = L.CATS.filter(k => t.byCat[k] > 0);
  const schools = t.bySchool.filter(s => s.amount > 0);
  const sch = s => { const app = s.appId && appById(s.appId); return !s.appId && !s.school ? '<span class="k muted">沒有指定學校</span>' : app ? `<span class="k sch" ${hueAttr(app)}>${esc(s.school)}</span>` : `<span class="k">${esc(s.school)}</span>`; };
  return `<div class="mn-head"><div class="mn-hl"><span>這次特選花了</span>${lines.length ? '<a class="link" href="/api/expenses.csv" download>下載 CSV</a>' : ''}</div><div class="mn-total">${amt(t.total)}<span> 元</span></div></div>
    <div class="mn-break">${cats.length ? `<section class="mn-sec mn-cat"><h3 class="col-h">依類別</h3><dl class="mn-kv">${cats.map(k => `<div><dt class="k">${esc(L.CAT_LABEL[k])}</dt><dd>${amt(t.byCat[k])}</dd></div>`).join('')}</dl></section>` : ''}
    ${schools.length ? `<section class="mn-sec mn-sch"><h3 class="col-h">依學校</h3><dl class="mn-kv">${schools.map(s => `<div><dt>${sch(s)}</dt><dd>${amt(s.amount)}</dd></div>`).join('')}</dl></section>` : ''}</div>`;
}

/* ---------- 學校頁的「花費」 ---------- */
// 一行：日期・項目・金額；點了是和花費頁同一個「改」表單（儲存、刪除、沒繳共用）。
// key 是 mns: 不是 mn:：換分頁時舊畫面的表單還留在 DOM 裡，同一個 key 會找到另一頁那個看不見的表單
function schoolRow(l) {
  const key = 'mns:' + l.id;
  if (isEditing(key)) return editHtml(l, key, true);
  return `<button type="button" class="mn-sr" data-edit="${esc(key)}"><span class="d">${esc(l.date ? L.fmtDate(l.date) : '')}</span><span class="w">${esc(l.what)}</span>${amountSpan(l)}</button>`;
}
// 只有這間有花費（或報名費按了沒繳）才畫；「＋ 記花費」打開同一個表單，學校就是這間（不放學校選單）。
// 不叫「＋ 記一筆」：紀錄是空的時候，上面那一塊也有一個「＋ 記一筆」
export function schoolBlock(app) {
  const lines = expensesNow().filter(l => l.appId === app.id).reverse();
  const skipped = app.feeHidden && L.feeLine({...app, feeHidden: false}, programOf(app));
  if (!lines.length && !skipped) return '';
  const key = 'mnadd:' + app.id, open = isEditing(key);
  const total = lines.reduce((n, l) => n + l.amount, 0);
  const form = open ? `<form class="edit-form mn-add-s" data-edit-form="${esc(key)}" data-mn="${esc(app.id)}" novalidate autocomplete="off"><div class="mn-f">${fieldsHtml(draftOf(app.id), true)}</div><p class="form-err" data-err></p>
    <div class="edit-acts"><button class="btn primary sm" type="submit">記下</button><button class="btn sm" type="button" data-edit-cancel>取消</button></div></form>` : '';
  return `<section class="sec s-money"><div class="sec-h"><h3>花費</h3>${lines.length ? `<span class="count">${amt(total)} 元</span>` : ''}${open ? '' : `<button class="link edit" type="button" data-edit="${esc(key)}">＋ 記花費</button>`}</div>${form}
    ${lines.length ? `<div class="mn-sl">${lines.map(schoolRow).join('')}</div>` : ''}
    ${skipped ? `<p class="mn-skip">報名費沒繳<button class="link" type="button" data-mn-unskip="${esc(app.id)}">改回</button></p>` : ''}</section>`;
}

/* ---------- 畫 ---------- */
// 記一筆的表單一直在：只換清單和右欄，表單本身不重畫（正在打的字、游標、輸入法都不會被打斷）；欄位跟著草稿
function syncAdd(f) {
  const d = draftOf(''), el = f.elements;
  for (const n of ['date', 'what', 'amount']) if (el[n].value !== d[n]) el[n].value = d[n];
  el.cat.value = d.cat;
  const opts = schoolOptions(d.appId);
  if (f.dataset.opts !== opts) { el.appId.innerHTML = opts; f.dataset.opts = opts; }
  el.appId.value = d.appId;
  for (const n of ['date', 'what', 'amount']) el[n].classList.toggle('bad', d.errAt === n);
  const er = $('.mn-err', f.parentElement);
  if (er.textContent !== d.err) er.textContent = d.err;
}
export function render() {
  const root = $('#view-money');
  if (!root) return;
  if (!$('.mn-add', root)) {
    root.innerHTML = `<div class="mn-main"><form class="mn-add mn-f" data-mn="" novalidate autocomplete="off">${fieldsHtml(draftOf(''))}<button class="btn" type="submit">記下</button></form><p class="form-err mn-err" role="alert"></p>
      <div class="mn-list scroll"></div></div><aside class="mn-sum scroll" aria-label="合計"></aside>`;
  }
  syncAdd($('.mn-add', root));
  const lines = expensesNow(), list = $('.mn-list', root), top = list.scrollTop;
  list.innerHTML = listHtml(lines);
  list.scrollTop = top;
  $('.mn-sum', root).innerHTML = sumHtml(lines);
  const fl = flashId && list.querySelector(`[data-line="${CSS.escape(flashId)}"]`);
  if (fl) fl.scrollIntoView({block: 'nearest'});
}

/* ---------- 事件 ---------- */
function saveEdit(form, key) {
  const id = key.slice(key.indexOf(':') + 1), err = (at, msg) => { form.querySelectorAll('.bad').forEach(x => x.classList.remove('bad')); const el = at && form.elements[at]; if (el) { el.classList.add('bad'); el.focus(); } form.querySelector('[data-err]').textContent = msg; return false; };
  if (id.startsWith('fee:')) {
    const app = appById(id.slice(4));
    if (!app) return;
    const raw = form.elements.amount.value.trim(), n = L.parseAmount(raw);
    if (n === null) return err('amount', raw ? '金額寫整數，例如 900' : '金額要填');
    if (n === app.fee) return;
    act(app.id, 'setFee', {fee: n}, {toast: `已記下：${shortName(app)} 報名費 ${amt(n)} 元`});
    return;
  }
  const cur = expenseById(id);
  if (!cur) return;
  const r = readForm(form);
  if (r.err) return err(r.at, r.err);
  const e = r.entry;
  // 學校沒換就留著原本記下的名字；刪掉的學校也一樣
  if (e.appId === (cur.appId || '')) e.school = cur.school || e.school;
  if (['date', 'what', 'amount', 'cat', 'appId', 'school'].every(k => e[k] === (cur[k] ?? ''))) return;
  // 和記一筆的「已記下 1,490 元」分開：寫出是哪一筆，才不會以為多記了一筆
  saveExpense({id, ...e}, {toast: `已記下：${e.what} ${amt(e.amount)} 元`});
}
function onDraft(e) {
  const f = e.target.closest && e.target.closest('[data-mn]');
  if (!f || !e.target.name) return;
  const ctx = f.dataset.mn, d = draftOf(ctx), t = e.target, el = f.elements;
  if (t.name === 'what') { d.what = t.value; if (!d.catSet) el.cat.value = d.cat = L.guessCat(t.value); }
  else if (t.name === 'amount') d.amount = t.value;
  else if (t.name === 'date') { d.date = t.value; if (!d.appSet && e.type === 'change') { d.appId = L.guessSchool(S.apps, P.byId, d.date); el.appId.value = d.appId; } }
  else if (t.name === 'cat' && e.type === 'change') { d.cat = t.value; d.catSet = true; }
  else if (t.name === 'appId' && e.type === 'change') { d.appId = t.value; d.appSet = true; }
  // 改了出錯的那一格，錯誤就收起來
  if (d.errAt === t.name) {
    d.err = ''; d.errAt = ''; t.classList.remove('bad');
    const er = ctx ? f.querySelector('[data-err]') : $('#view-money .mn-err');
    if (er) er.textContent = '';
  }
}
export function init() {
  const root = $('#view-money');
  root.addEventListener('submit', e => {
    const f = e.target.closest('.mn-add[data-mn=""]');
    if (!f) return;
    e.preventDefault();
    const r = addFrom(f, '');
    if (r.err) { Object.assign(draftOf(''), {err: r.err, errAt: r.at}); syncAdd(f); f.elements[r.at].focus(); return; }
    f.elements.what.focus();
  });
  // 草稿：花費頁和學校頁的表單都記著（重畫、回到網頁重新載入時不會不見）
  document.addEventListener('input', onDraft);
  document.addEventListener('change', onDraft);
  // 自動的報名費「沒繳」／「改回」、刪除一筆（8 秒內可以復原）
  document.addEventListener('click', e => {
    const t = e.target;
    let b;
    if ((b = t.closest('[data-mn-skip]'))) {
      const app = appById(b.dataset.mnSkip);
      closeEdit();
      if (app) act(app.id, 'setFee', {hidden: true}, {toast: `已記下：${shortName(app)} 報名費沒繳`});
    } else if ((b = t.closest('[data-mn-unskip]'))) {
      const app = appById(b.dataset.mnUnskip);
      if (app) act(app.id, 'setFee', {hidden: false}, {toast: `已記下：${shortName(app)} 有繳報名費`});
    } else if ((b = t.closest('[data-mn-del]'))) {
      const x = expenseById(b.dataset.mnDel);
      closeEdit();
      if (x) deleteExpense(x.id, {toast: `已刪除 ${x.what} ${amt(x.amount)} 元`});
    }
  });
  onEditSave('mn', saveEdit);
  onEditSave('mns', saveEdit);
  // 學校頁的「＋ 記花費」：回傳 false 表單留著（錯誤寫在表單裡）
  onEditSave('mnadd', (form, key) => {
    const ctx = key.slice(6), r = addFrom(form, ctx);
    if (!r.err) return;
    const el = form.elements[r.at];
    form.querySelectorAll('.bad').forEach(x => x.classList.remove('bad'));
    if (el) { el.classList.add('bad'); el.focus(); }
    form.querySelector('[data-err]').textContent = r.err;
    return false;
  });
}
