// 畫面共用的小零件：學校顏色、勾選框、連結、區段標題與「改」表單、小選單、對話框、日期文字。
import {$, $$, esc, colourOf, pdfAt, rerender, toTop, now} from './core.js';
import {dayLabel} from './logic.js';

const ICONS = {
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>',
};
export const icon = (name, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

/* ---------- 學校顏色 ---------- */
export const hue = app => `--hue:var(--c${colourOf(app)})`;
export const hueAttr = app => `style="${hue(app)}"`;

/* ---------- 連結 ---------- */
// 外部連結：「報名系統 ↗」（↗ 由 CSS 加）。href 空的就不畫。
export const ext = (href, label, cls = 'link') => href ? `<a class="${cls} ext" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>` : '';
// 簡章頁碼：「p.25 ↗」打開 PDF 的那一頁；沒有 PDF 或沒有頁碼就不畫。
export const pg = (app, page) => { const u = page ? pdfAt(app, page) : ''; return u ? `<a class="pg" href="${esc(u)}" target="_blank" rel="noopener">p.${esc(page)}</a>` : ''; };

/* ---------- 勾選框 ---------- */
// check({label:'繳費', checked:true, lg:true, attrs:'data-part="pay"'})；opt 是灰色後綴（選繳）。
// task：打勾後字變灰（預設開）。要「不能勾」就 disabled。
export function check({label = '', checked = false, lg = false, task = true, disabled = false, opt = '', name = '', value = '', attrs = '', html = ''} = {}) {
  return `<label class="check${lg ? ' lg' : ''}${task ? ' task' : ''}"><input type="checkbox"${name ? ` name="${esc(name)}"` : ''}${value ? ` value="${esc(value)}"` : ''}${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}${attrs ? ' ' + attrs : ''}><span>${html || esc(label)}${opt ? ` <span class="opt">${esc(opt)}</span>` : ''}</span></label>`;
}

/* ---------- 日期文字 ---------- */
const WD = '日一二三四五六';
const parse = d => { const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, dd); };
export const md = d => d ? `${d.slice(5, 7)}/${d.slice(8, 10)}` : '';
export const wd = d => d ? WD[parse(d).getDay()] : '';
export const mdw = d => d ? `${md(d)}（${wd(d)}）` : '';
// 「2026-11-19 00:00」「2026-11-19」→「11/19 00:00」「11/19」（簡章更新的前後值）
export const fmtVal = v => String(v ?? '').replace(/(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/g, (_, y, m, d, t) => `${m}/${d}${t ? ' ' + t : ''}`);
// 範圍型的截止（報名、報到）還沒開始：「今天 09:00 起」「週五 11/06 起」「12/21 10:00 起」。各畫面同一個寫法。
export const fromAhead = (from, fromTime, n = now()) => !!from && `${from}T${fromTime || '00:00'}` > n;
export function fromText(from, fromTime, n = now()) {
  const lab = dayLabel(from, n);
  return `${/^(今天|明天|後天|週)/.test(lab) ? lab : md(from)}${fromTime ? ' ' + fromTime : ''} 起`;
}

/* ---------- 簡章的幾個常用字 ---------- */
// 甄選方式：「書面審查 50%・面試 50%」
export const methodText = p => ((p && p.it) || []).filter(i => i && i[0]).map(([n, w]) => w != null && w !== '' ? `${n} ${w}%` : n).join('・');
// 報名費：「600 元」；簡章寫的不只是數字（初試 900；複試 600、免收）就照抄
export function feeText(f) {
  const s = String(f ?? '').trim(), m = /^(\d[\d,]*)\s*元?$/.exec(s);
  return m ? `${m[1]} 元` : s.replace(/(\d)元/g, '$1 元');
}

/* ---------- 區段標題，右邊一個「改」 ---------- */
// secHead('時程', {count:'0／4', edit:'sched:'+app.id})：按「改」會呼叫 openEdit('sched:<id>')。
export function secHead(title, {count = '', edit = '', right = '', tag = 'h3'} = {}) {
  return `<div class="sec-h"><${tag}>${esc(title)}</${tag}>${count !== '' && count != null ? `<span class="count">${esc(count)}</span>` : ''}${right ? `<span class="right">${right}</span>` : ''}${edit ? `<button class="link edit" type="button" data-edit="${esc(edit)}">改</button>` : ''}</div>`;
}

/* ---------- 「改」表單 ---------- */
// 同一時間只有一個區段在改。key 例如 'sched:<appId>'；冒號前面那段用來找 onEditSave 註冊的存檔函式。
// 打開時 document.body.dataset.editing = key：回到網頁不重新載入、快速鍵停用。
const E = {key: '', focus: false};
const saveFns = new Map();
export const editKey = () => E.key;
export const isEditing = key => key == null ? !!E.key : E.key === key;
export function openEdit(key) {
  E.key = key; E.focus = true;
  document.body.dataset.editing = key;
  rerender();
}
export function closeEdit() {
  if (!E.key) return false;
  E.key = '';
  delete document.body.dataset.editing;
  rerender();
  return true;
}
// onEditSave('sched', (form, key) => { ...mutate...; })：回傳 false 表示有錯、表單留著。可以是 async。
export const onEditSave = (prefix, fn) => saveFns.set(prefix, fn);
// 表單外框：inner 是欄位；extra 是放在 儲存／取消 後面的連結（例如 還原、＋新增日期）。
export function editForm(key, inner, {extra = '', cls = ''} = {}) {
  return `<form class="edit-form${cls ? ' ' + cls : ''}" data-edit-form="${esc(key)}" novalidate autocomplete="off">${inner}<div class="edit-acts"><button class="btn primary sm" type="submit">儲存</button><button class="btn sm" type="button" data-edit-cancel>取消</button>${extra}</div></form>`;
}
// 時間欄用文字框：瀏覽器的 type=time 在有些語系會變成「下午 03:30」，這裡一律 24 小時制。讀值用 normTime()。
export const timeInput = (name, value = '', attrs = '') => `<input type="text" class="tm" name="${esc(name)}" value="${esc(value)}" inputmode="numeric" maxlength="5" placeholder="17:00" autocomplete="off"${attrs ? ' ' + attrs : ''}>`;
// '1730'、'17:30'、'9:30'、'17：30' → '17:30'；空白 → ''；看不懂 → null（畫面在旁邊寫 .form-err）
export function normTime(v) {
  const s = String(v ?? '').trim().replace(/[：.．]/g, ':');
  if (!s) return '';
  const m = /^(\d{1,2}):?(\d{2})$/.exec(s);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}
// 重畫時保留表單裡打到一半的字（欄位數量一樣才還原；會增減欄位的表單請自己記草稿）。
export function snapshotEdit() {
  const f = E.key && $(`[data-edit-form="${CSS.escape(E.key)}"]`);
  if (!f) return null;
  const els = [...f.elements];
  const a = document.activeElement, fi = els.indexOf(a);
  let sel = null;
  try { if (fi >= 0 && a.selectionStart != null) sel = [a.selectionStart, a.selectionEnd]; } catch { /* date/time 沒有 selection */ }
  return {key: E.key, n: els.length, vals: els.map(el => el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value), fi, sel};
}
export function restoreEdit(s) {
  if (!s || s.key !== E.key) return;
  const f = $(`[data-edit-form="${CSS.escape(s.key)}"]`);
  if (!f) return;
  const els = [...f.elements];
  if (els.length !== s.n) return;
  els.forEach((el, i) => { if (el.type === 'checkbox' || el.type === 'radio') el.checked = s.vals[i]; else if (el.type !== 'submit' && el.type !== 'button') el.value = s.vals[i]; });
  if (s.fi >= 0 && els[s.fi]) { els[s.fi].focus({preventScroll: true}); try { if (s.sel) els[s.fi].setSelectionRange(...s.sel); } catch { /* ignore */ } }
  E.focus = false;
}
// 剛打開的表單：游標放在第一個欄位。
export function afterRender() {
  if (!E.focus || !E.key) return;
  E.focus = false;
  const f = $(`[data-edit-form="${CSS.escape(E.key)}"]`);
  const el = f && f.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea');
  if (el) { el.focus({preventScroll: true}); if (el.select && el.type === 'text') el.select(); }
  if (f) f.scrollIntoView({block: 'nearest'});
}
export function wireEdit() {
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-edit]');
    if (o) { e.preventDefault(); openEdit(o.dataset.edit); return; }
    if (e.target.closest('[data-edit-cancel]')) { e.preventDefault(); closeEdit(); }
  });
  // 輸入法選字按的 Enter 不要送出表單
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229) && e.target.closest && e.target.closest('[data-edit-form]')) e.preventDefault();
  }, true);
  document.addEventListener('submit', async e => {
    const f = e.target.closest('[data-edit-form]');
    if (!f) return;
    e.preventDefault();
    const key = f.dataset.editForm, fn = saveFns.get(key.split(':')[0]);
    if (!fn) { closeEdit(); return; }
    let ok;
    try { ok = await fn(f, key); } catch (err) { console.error(err); ok = false; }
    if (ok !== false && E.key === key) closeEdit();
  });
}

/* ---------- 小選單（狀態選單、⋯） ---------- */
// popMenu(按鈕, [{id:'applied', label:'已報名', checked:true}, '-', {head:'改正'}, {id:'del', label:'刪除這間學校', danger:true}], id => …)
let menuEl = null, menuAnchor = null;
export function closeMenu() {
  if (!menuEl) return false;
  menuEl.remove(); menuEl = null;
  if (menuAnchor) { menuAnchor.setAttribute('aria-expanded', 'false'); if (document.activeElement === document.body) menuAnchor.focus({preventScroll: true}); }
  menuAnchor = null;
  return true;
}
export function popMenu(anchor, items, onPick) {
  const again = menuAnchor === anchor;
  closeMenu();
  if (again) return;
  const m = document.createElement('div');
  m.className = 'menu'; m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : it.head ? `<div class="menu-h">${esc(it.head)}</div>`
    : `<button type="button" role="${it.checked != null ? 'menuitemradio' : 'menuitem'}" data-i="${i}"${it.checked ? ' aria-checked="true"' : ''}${it.danger ? ' class="danger"' : ''}${it.disabled ? ' disabled' : ''}>${it.html || esc(it.label)}</button>`).join('');
  ($$('dialog[open]').pop() || document.body).append(m);
  menuEl = m; menuAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  const r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  m.style.top = (r.bottom + 4 + h > innerHeight - 8 && r.top - 4 - h > 8 ? r.top - 4 - h : r.bottom + 4) + 'px';
  m.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    closeMenu();
    onPick(it.id !== undefined ? it.id : it, it);
  });
  m.addEventListener('keydown', e => {
    const bs = $$('button:not([disabled])', m), i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus(); }
    else if (e.key === 'Tab') closeMenu();
  });
  (m.querySelector('[aria-checked="true"]') || m.querySelector('button:not([disabled])') || m).focus({preventScroll: true});
}
document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target) && !(menuAnchor && menuAnchor.contains(e.target))) closeMenu(); }, true);
addEventListener('resize', () => closeMenu());
document.addEventListener('scroll', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);

/* ---------- 對話框 ---------- */
// 用這個打開，提示和提示列才會跟著搬到最上層。
export function openDialog(d) {
  if (!d.open) d.showModal();
  toTop($('#toast')); toTop($('#bar'));
}
