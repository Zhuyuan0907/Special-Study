// 新增學校：選學校 → 選系組 → 確認 → 完成。
import {S, P, KINDS, REGION_NAME, REGION_ORDER, esc, todayKey, diffDays, fmtDate, cdText, appName, normName, composing, debounce, mine, regKey, mergeRows, progMeta, qualPills, weightText, appFromProgram, upsertApp, nextStep, upcoming, allEvents, splitName, deptMain} from './core.js';
import {whenText} from './ui.js';
import {go} from './router.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const dlg = () => $('#dlg-add');
const wiz = {step: 1, school: null, pid: null, q: '', open: false, active: 0, choices: [], applied: false, addedId: null};

export function openWizard(opts = {}) {
  Object.assign(wiz, {step: 1, school: null, pid: null, q: '', open: false, active: 0, applied: false, addedId: null}, opts);
  if (opts.pid) { const p = P.byId.get(opts.pid); if (p) { wiz.school = p.school; wiz.step = 3; } }
  render();
  if (!dlg().open) dlg().showModal();
  focusWiz();
}
function focusWiz() { const el = $('#add-q') || $('#add-confirm') || $('#add-finish'); if (el) el.focus(); }
function setStep(step, extra = {}) { Object.assign(wiz, {step, q: '', active: 0}, extra); render(); focusWiz(); }
function schoolMatches(s, q) { const n = normName(s.name), k = normName(q); return !k || n.includes(k) || P.terms.aliases[k] === s.name; }
function deptMatches(p, q) {
  const k = normName(q);
  if (!k) return true;
  const n = normName(p.n);
  if (n.includes(k)) return true;
  const syn = P.terms.synonyms[k];
  if (syn) return syn.some(s => n.includes(normName(s)));
  if (k.length < 2) return false;
  let best = Infinity;
  for (let i = n.indexOf(k[0]); i !== -1; i = n.indexOf(k[0], i + 1)) { let j = i, c = 1; for (; c < k.length; c++) { j = n.indexOf(k[c], j + 1); if (j === -1) break; } if (c === k.length) best = Math.min(best, j - i + 1); }
  return best <= k.length * 3;
}
function render() {
  $$('#add-steps li').forEach(li => { const n = Number(li.dataset.step); li.className = wiz.step > 3 || n < wiz.step ? 'done' : n === wiz.step ? 'now' : ''; });
  const body = $('#add-body');
  if (wiz.step === 1) body.innerHTML = `<div class="add-step">
      <p class="add-lead">要報名哪一間學校？</p>
      <div class="add-search"><input type="search" id="add-q" placeholder="學校名稱或簡稱，例如：輔仁、清大" autocomplete="off" aria-label="搜尋學校"></div>
      <div class="pick-list scroll" id="add-list" role="listbox"></div>
      <div class="modal-foot" style="padding:12px 0 0"><span class="small muted">清單裡沒有？</span><button class="btn sm" type="button" id="add-manual">手動新增</button></div>
    </div>`;
  else if (wiz.step === 2) {
    const progs = P.programs.filter(p => p.school === wiz.school), open = progs.filter(p => p._reg && p._reg.end >= todayKey()).length;
    body.innerHTML = `<div class="add-step">
      <div class="add-lead"><button class="back" type="button" data-back="1">‹ 換學校</button><span>${esc(wiz.school)}：哪個系？</span><span class="small">${progs.length} 個系組，還能報名 ${open} 個</span></div>
      <div class="add-search"><input type="search" id="add-q" placeholder="篩選系組，例如：資工、醫資" autocomplete="off" aria-label="篩選系組"><label class="toggle"><input type="checkbox" id="add-open" ${wiz.open ? 'checked' : ''}>只看還能報名</label></div>
      <div class="pick-list scroll" id="add-list" role="listbox"></div>
    </div>`;
  } else if (wiz.step === 3) body.innerHTML = confirmHtml(P.byId.get(wiz.pid));
  else body.innerHTML = doneHtml();
  if (wiz.step <= 2) renderList();
}
function renderList() {
  const list = $('#add-list'); if (!list) return;
  const t = todayKey();
  if (wiz.step === 1) {
    const schools = P.schools.filter(s => schoolMatches(s, wiz.q)).sort((a, b) => (REGION_ORDER[a.region] ?? 9) - (REGION_ORDER[b.region] ?? 9));
    wiz.choices = schools.map(s => ({type: 'school', value: s.name}));
    list.innerHTML = schools.length ? schools.map((s, i) => {
      const progs = P.programs.filter(p => p.school === s.name), open = progs.filter(p => p._reg && p._reg.end >= t).length, added = S.apps.filter(a => a.school === s.name).length;
      return `<div class="pick ${i === wiz.active ? 'active' : ''}" role="option" aria-selected="${i === wiz.active}" data-choice="${i}">
        <div class="pick-main"><div class="pick-title">${esc(s.name)}${added ? `<span class="tag">已加入 ${added} 個系</span>` : ''}</div><div class="pick-sub">${REGION_NAME[s.region] || ''}・${progs.length} 個系組・${open ? `<span class="st-open">還能報名 ${open} 個</span>` : '報名都已截止'}</div></div><span class="pick-go">›</span></div>`;
    }).join('') : `<div class="pick-empty">找不到「${esc(wiz.q)}」。可以按下面的「手動新增」。</div>`;
  } else {
    const progs = P.programs.filter(p => p.school === wiz.school && deptMatches(p, wiz.q) && (!wiz.open || (p._reg && p._reg.end >= t))).sort((a, b) => regKey(a).localeCompare(regKey(b)));
    const rows = mergeRows(progs);
    wiz.choices = [];
    list.innerHTML = rows.map(r => {
      if (r.items.length === 1) {
        const p = r.items[0], i = wiz.choices.push({type: 'prog', value: p.i}) - 1, m = mine(p.i);
        return `<div class="pick ${m ? 'taken' : ''} ${i === wiz.active ? 'active' : ''}" role="option" aria-selected="${i === wiz.active}" data-choice="${i}"><div class="pick-main"><div class="pick-title">${esc(r.main)}${qualPills(p._quals)}${m ? '<span class="tag">已加入</span>' : ''}</div><div class="pick-sub">${progMeta(p).join('・')}</div></div><span class="pick-go">›</span></div>`;
      }
      return `<div class="pick-multi"><div class="pick-main"><div class="pick-title">${esc(r.main)}<span class="small muted" style="font-weight:400">${r.items.length} 個招生組別，選一個</span></div><div class="pick-sub">${progMeta(r.items[0], false).join('・')}</div></div>
        <div class="pick-groups">${r.items.map(p => { const i = wiz.choices.push({type: 'prog', value: p.i}) - 1, m = mine(p.i); return `<button class="btn sm ${i === wiz.active ? 'active' : ''}" type="button" data-choice="${i}" role="option" aria-selected="${i === wiz.active}">${esc(p._quals.join('・') || '一般')}<small class="muted">名額 ${p.q ?? '—'}</small>${m ? '<small class="ok">已加入</small>' : ''}</button>`; }).join('')}</div></div>`;
    }).join('') || `<div class="pick-empty">${esc(wiz.school)} 沒有符合「${esc(wiz.q)}」的系組。</div>`;
  }
  const act = list.querySelector('.active'); if (act) act.scrollIntoView({block: 'nearest'});
}
function choose(i) {
  const c = wiz.choices[i]; if (!c) return;
  if (c.type === 'school') { setStep(2, {school: c.value, open: false}); return; }
  const m = mine(c.value);
  if (m) { dlg().close(); go('schools', {id: m.id}); return; }
  setStep(3, {pid: c.value, applied: false});
}
function confirmHtml(p) {
  const t = todayKey(), src = appFromProgram(p), r = p._reg, closed = r && r.end < t;
  const key = src.dates.filter(d => ['reg', 'letter', 'upload', 'stage1', 'interview', 'exam', 'release', 'confirm'].includes(d.kind)).slice(0, 6);
  const endText = `${fmtDate(r ? r.end : '')}${r && r.time ? ' ' + r.time : ''}`;
  const statusText = !r ? '' : t < r.start ? `<span class="state info">${fmtDate(r.start)} 開始報名</span>` : !closed ? `<span class="state ok">報名中，${diffDays(r.end) === 0 ? '今天' : `剩 ${diffDays(r.end)} 天`}，${endText} 截止</span>` : `<span class="state muted">報名已在 ${endText} 截止</span>`;
  const same = S.apps.filter(a => a.school === p.school && a.status !== 'skipped'), mx = parseInt(p.mx, 10), warns = [];
  if (Number.isFinite(mx) && same.length >= mx) warns.push(`<b>${esc(p.school)}規定同校最多報 ${mx} 個系組</b>，你已經加了 ${same.length} 個（${same.map(a => esc(deptMain(a))).join('、')}）。請確認簡章。`);
  if (closed) warns.push(`這個系的報名已在 <b>${endText}</b> 截止。已經報名的話，勾下面的「我已經報名了」；沒報名的話，加進來只能當參考。`);
  return `<div class="add-step">
    <div class="add-lead"><button class="back" type="button" data-back="2">‹ 換系組</button></div>
    <div class="scroll" style="flex:1;min-height:0;display:flex;flex-direction:column;gap:16px">
      <div class="confirm-card"><div class="pick-main"><div class="pick-title">${esc(p.school)} ${esc(p._main)}${qualPills(p._quals)}</div><div class="pick-sub">${[p.q != null && `名額 ${p.q}`, p.fee && `報名費 ${esc(p.fee)}`].filter(Boolean).join('・')}</div></div>${statusText}</div>
      ${warns.map(w => `<div class="warn-box">${w}</div>`).join('')}
      <div class="confirm-grid">
        <section class="confirm-box"><h3>加入後會幫你建立</h3><ul class="will">
          <li><span><b>${src.dates.length} 個日期</b>，排進本週、行事曆和提醒<ul class="mini-dates">${key.map(d => `<li><span class="d">${fmtDate(d.date)}</span><span>${KINDS[d.kind].label}${d.time ? ' ' + esc(d.time) : ''}</span></li>`).join('')}</ul></span></li>
          <li><span><b>${src.docs.length} 項備審清單</b>：${src.docs.map(d => esc(d.name)).join('、')}</span></li>
          <li><span><b>甄選方式</b>：${esc(weightText(p) || '簡章未列')}</span></li>
          ${p.loc ? `<li><span><b>考試地點</b>：${esc(p.loc)}</span></li>` : ''}</ul></section>
        <section class="confirm-box"><h3>報名資格${p.qxp ? `（簡章第 ${p.qxp} 頁）` : ''}</h3><p class="qual-short">${esc(p.qx || p.tgt || '整理資料沒有列出，請看簡章原文。')}</p><button class="link" type="button" data-view-prog="${esc(p.i)}">看完整簡章</button></section>
      </div>
    </div>
    <div class="modal-foot" style="padding:12px 0 0"><label class="check ${closed ? 'warn' : ''}"><input type="checkbox" id="add-applied" ${wiz.applied ? 'checked' : ''}>我已經報名了</label><span class="spacer"></span><button class="btn" type="button" data-back="2">上一步</button><button class="btn fill" type="button" id="add-confirm">加入我的學校</button></div>
  </div>`;
}
function doneHtml() {
  const a = S.apps.find(x => x.id === wiz.addedId);
  if (!a) return '<div class="add-step add-done"><p>已加入。</p></div>';
  const n = upcoming(allEvents().filter(ev => ev.app.id === a.id))[0];
  return `<div class="add-step add-done">
    <h3>已加入 ${esc(appName(a))}</h3>
    <p>${a.dates.length} 個日期已排進時程${n ? `，最近的是 ${fmtDate(n.date)} ${KINDS[n.kind].label}（${cdText(diffDays(n.date))}）` : ''}。</p>
    <p class="small">下一步：${esc(nextStep(a).text)}</p>
    <div class="modal-foot" style="border:0;justify-content:center;padding:8px 0 0"><button class="btn" type="button" id="add-same">同一間再加一個系</button><button class="btn" type="button" id="add-other">加別間學校</button><button class="btn fill" type="button" id="add-finish">打開這間學校</button></div>
  </div>`;
}
function confirmAdd() {
  const p = P.byId.get(wiz.pid); if (!p) return;
  const ex = mine(p.i); if (ex) { dlg().close(); go('schools', {id: ex.id}); return; }
  const app = appFromProgram(p);
  if (wiz.applied) app.status = 'applied';
  upsertApp(app);
  wiz.addedId = app.id; wiz.step = 4; render(); focusWiz();
}
export function wireWizard() {
  const d = dlg();
  const refresh = debounce(() => { wiz.active = 0; renderList(); }, 80);
  d.addEventListener('input', e => { if (e.target.id === 'add-q') { wiz.q = e.target.value; if (!composing(e)) refresh(); } });
  d.addEventListener('compositionend', e => { if (e.target.id === 'add-q') { wiz.q = e.target.value; refresh(); } });
  d.addEventListener('keydown', e => {
    if (e.target.id !== 'add-q' || composing(e)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!wiz.choices.length) return; wiz.active = (wiz.active + (e.key === 'ArrowDown' ? 1 : -1) + wiz.choices.length) % wiz.choices.length; renderList(); }
    else if (e.key === 'Enter') { e.preventDefault(); refresh.flush(); if (wiz.choices.length) choose(Math.min(wiz.active, wiz.choices.length - 1)); }
  });
  d.addEventListener('change', e => { if (e.target.id === 'add-open') { wiz.open = e.target.checked; wiz.active = 0; renderList(); } if (e.target.id === 'add-applied') wiz.applied = e.target.checked; });
  d.addEventListener('click', e => {
    const c = e.target.closest('[data-choice]'); if (c) { choose(Number(c.dataset.choice)); return; }
    const back = e.target.closest('[data-back]'); if (back) { setStep(Number(back.dataset.back)); return; }
    const v = e.target.closest('[data-view-prog]'); if (v) { d.close(); go('finder', {id: v.dataset.viewProg}); return; }
    if (e.target.closest('#add-manual')) { d.close(); go('schools', {id: 'new'}); return; }
    if (e.target.closest('#add-confirm')) { confirmAdd(); return; }
    if (e.target.closest('#add-same')) { setStep(2, {pid: null, open: false}); return; }
    if (e.target.closest('#add-other')) { setStep(1, {school: null, pid: null}); return; }
    if (e.target.closest('#add-finish')) { const id = wiz.addedId; d.close(); go('schools', {id}); }
  });
  document.addEventListener('open-wizard', e => openWizard(e.detail || {}));
}
