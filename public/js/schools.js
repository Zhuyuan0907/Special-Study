// 學校：左邊一排學校，右邊是選到的那一間。右邊依流程分段：報名與日期 → 備審 → 面試 → 結果 → 簡章重點 → 基本資料。
import {S, P, STATUS, KINDS, METHODS, DEFAULT_KIT, COMMON_QUESTIONS, STAGE_ORDER, esc, clone, uid, todayKey, diffDays, md, fmtDate, cdText, appName, deptMain, schoolLinks, pdfUrl, firstDate, nextEventOf, activeApp, upsertApp, removeApp, nextStep, blankApp, numOrNull, isKey, composing, debounce, saveHooks, toast, fmtMoney, rlText, itemClass, docListHtml, programDates, regStepsFor} from './core.js';
import {icon, hueStyle, stateHtml, shortName, whenText, mdw, countdownHtml} from './ui.js';
import {go} from './router.js';

export const sv = {id: null, sec: {}};
let cur = null, delArmed = false, delTimer = null, pickResult = false;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SECS = [['reg', '報名與日期'], ['docs', '備審資料'], ['interview', '面試'], ['result', '放榜與結果'], ['brochure', '簡章重點'], ['info', '基本資料']];

function defaultSec(a) {
  const t = todayKey(), left = (a.docs || []).filter(d => !d.done).length;
  switch (a.status) {
    case 'prep': case 'skipped': return 'reg';
    case 'applied': { const iv = firstDate(a, ['interview', 'exam', 'window']); return left ? 'docs' : iv && iv.date >= t && diffDays(iv.date) <= 14 ? 'interview' : 'docs'; }
    case 'interview': return 'interview';
    default: return 'result';
  }
}
const openSet = a => sv.sec[a.id] || (sv.sec[a.id] = new Set([defaultSec(a)]));

/* ---------- 選擇與載入 ---------- */
export function selectSchool(id, opts = {}) {
  const a = id ? S.apps.find(x => x.id === id) : null;
  if (!a && id !== 'new') { sv.id = null; cur = null; renderSchools(); return; }
  cur = a ? clone(a) : blankApp();
  sv.id = cur.id;
  cur.dates = (cur.dates || []).map(d => ({id: d.id || uid(), kind: KINDS[d.kind] ? d.kind : 'other', date: d.date || '', end: d.end || '', time: d.time || '', note: d.note || ''})).sort((x, y) => (x.date || '9').localeCompare(y.date || '9'));
  cur.docs = (cur.docs || []).map(d => ({id: d.id || uid(), name: d.name || '', done: !!d.done}));
  if (!Array.isArray(cur.kit)) cur.kit = DEFAULT_KIT.map(n => ({id: uid(), name: n, done: false}));
  if (!Array.isArray(cur.waitLog)) cur.waitLog = [];
  if (!Array.isArray(cur.regSteps)) cur.regSteps = regStepsFor((cur.programId && P.byId.get(cur.programId)) || null);
  pickResult = false;
  disarmDelete();
  if (opts.sec) openSet(cur).add(opts.sec);
  if (!a) openSet(cur).add('info');
  renderSchools();
  renderSheet();
  if (opts.sec) { const el = $(`#sheet .sec[data-sec="${opts.sec}"]`); if (el) el.scrollIntoView({block: 'nearest'}); }
  if (!a) { const inp = $('#i-school'); if (inp) inp.focus(); }
}
export const currentId = () => sv.id;
// 科系資料晚到時，重畫目前這間學校（簡章重點、報名系統連結、報名步驟要用到）。正在輸入就不打擾。
export function refreshSheet() {
  if (!cur) return;
  commitSoon.flush();
  if ($('#sheet').contains(document.activeElement)) return;
  if (S.apps.some(a => a.id === cur.id)) selectSchool(cur.id); else renderSheet();
}

/* ---------- 左欄 ---------- */
export function renderSchools() {
  const t = todayKey();
  const apps = [...S.apps].sort((a, b) => {
    const oa = activeApp(a) ? 0 : 1, ob = activeApp(b) ? 0 : 1;
    const na = nextEventOf(a), nb = nextEventOf(b);
    return oa - ob || (na ? na.date : '9').localeCompare(nb ? nb.date : '9') || (STAGE_ORDER[a.status] ?? 9) - (STAGE_ORDER[b.status] ?? 9);
  });
  $('#rail-count').textContent = S.apps.length || '';
  const fee = S.apps.filter(a => !['prep', 'skipped'].includes(a.status)).reduce((s, a) => s + (Number(a.fee) || 0), 0);
  $('#rail-fee').textContent = fee ? `已繳報名費 ${fmtMoney(fee)} 元` : '';
  $('#rail').innerHTML = apps.length ? apps.map(a => {
    const nx = nextEventOf(a), f = nx ? (nx.date >= t ? nx.date : nx.last) : null;
    return `<button class="ritem ${a.id === sv.id ? 'on' : ''} ${a.status === 'prep' ? 'dashed' : ''} ${activeApp(a) ? '' : 'off'}" type="button" ${hueStyle(a)} data-app="${esc(a.id)}">
      <span class="bar"></span>
      <span><span class="n">${esc(shortName(a) || '（新學校）')}${stateHtml(a)}</span><span class="d">${esc(deptMain(a) || '（還沒填學系）')}${nx && activeApp(a) ? ` · ${KINDS[nx.kind].label} ${md(f)}` : ''}</span></span>
    </button>`;
  }).join('') : S.loaded ? '<div class="empty"><b>還沒有學校</b>按下面的「新增學校」</div>' : '<div class="empty">載入中…</div>';
  if (cur) renderSheetMeta();
  else if (!S.loaded) $('#sheet').innerHTML = '';
  else if (!S.apps.length) $('#sheet').innerHTML = '<div class="empty"><b>從簡章選學校和系</b>日期、備審清單、報名系統連結都會自動帶進來</div>';
  else if (!sv.id) $('#sheet').innerHTML = '<div class="empty">左邊選一間學校</div>';
}

/* ---------- 右欄 ---------- */
function links(a) {
  const L = schoolLinks(a.school) || {}, p = a.programId && P.byId.get(a.programId);
  return [L.apply && [L.apply, '網路報名系統'], L.adm && [L.adm, '學校招生網'], p && pdfUrl(p.code) && [pdfUrl(p.code), '簡章 PDF'], /^https?:\/\//.test(a.url || '') && [a.url, '系所網站'], p && [`https://sta-tw.org/bochures/program/${encodeURIComponent(p.i)}/`, '特殊選才網']].filter(Boolean)
    .map(([u, l]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${l} ↗</a>`).join('');
}
export function renderSheet() {
  if (!cur) return;
  const open = openSet(cur);
  $('#sheet').innerHTML = `
    <div class="sheet-head">
      <div class="sheet-title">
        <h2 ${hueStyle(cur)}><span class="dot"></span><span id="sh-name">${esc(cur.school || '新學校')}</span><span id="sh-state">${stateHtml(cur)}</span></h2>
        <div class="d" id="sh-dept">${esc(cur.dept || '在「基本資料」填學系')}</div>
        <div class="sheet-links" id="sh-links">${links(cur)}</div>
      </div>
      <div class="sheet-tools"><span class="save-state" id="sh-save">${cur.example ? '範例，修改後會變成你的紀錄' : ''}</span>
        <div class="menu" id="sh-menu"><button class="icon-btn" type="button" aria-label="更多" data-menu>${icon('more')}</button>
          <div class="menu-list"><button type="button" data-open-sec="info">基本資料</button>${cur.programId ? '<button type="button" data-view-prog>看簡章原文</button><button type="button" data-reset-dates>用簡章日期重設</button>' : ''}<button type="button" data-print-one>列印這一間</button><button type="button" class="danger-text" id="sh-delete">刪除這間學校</button></div></div></div>
    </div>
    <ol class="stepper" id="sh-stepper">${stepperHtml()}</ol>
    <div class="next" id="sh-next">${nextHtml()}</div>
    <div class="sections scroll" id="sh-secs">${SECS.map(([k, label]) => `<section class="sec ${open.has(k) ? 'open' : ''}" data-sec="${k}">
      <button class="sec-h" type="button" data-toggle="${k}">${icon('chevron', 'icon chev')}<span>${label}</span><span class="sum" id="sum-${k}">${summary(k)}</span></button>
      <div class="sec-b">${body(k)}</div>
    </section>`).join('')}</div>`;
}
// 不重建輸入欄位，只更新標題、狀態、步驟、下一步、各段摘要。
function renderSheetMeta() {
  if (!cur || !$('#sh-stepper')) return;
  $('#sh-name').textContent = cur.school || '新學校';
  $('#sh-state').innerHTML = stateHtml(cur);
  $('#sh-dept').textContent = cur.dept || '在「基本資料」填學系';
  $('#sh-links').innerHTML = links(cur);
  $('#sh-stepper').innerHTML = stepperHtml();
  $('#sh-next').innerHTML = nextHtml();
  for (const [k] of SECS) { const el = $(`#sum-${k}`); if (el) el.innerHTML = summary(k); }
}
const STEPS = [['prep', '準備中'], ['applied', '已報名'], ['interview', '通過一階'], ['waiting', '已面試'], ['result', '結果']];
const stepIndex = st => ({prep: 0, skipped: 0, applied: 1, interview: 2, waiting: 3, admitted: 4, waitlist: 4, rejected: 4, out: 2})[st] ?? 0;
function stepperHtml() {
  const idx = stepIndex(cur.status);
  const resultLabel = {admitted: '正取', waitlist: cur.waitNo ? `備取 ${cur.waitNo}` : '備取', rejected: '未錄取'}[cur.status];
  return STEPS.map(([key, label], i) => {
    let cls = i < idx ? 'done' : i === idx ? 'now' : '', text = label;
    if (i === 0 && cur.status === 'skipped') { cls = 'now bad'; text = '沒有報名'; }
    if (i === 2 && cur.status === 'out') { cls = 'now bad'; text = '一階未通過'; }
    if (i === 4 && resultLabel) { text = resultLabel; cls += cur.status === 'admitted' ? ' ok' : cur.status === 'waitlist' ? ' warn' : ' bad'; }
    return `<li class="${cls}"><button type="button" data-step="${key}">${text}</button></li>`;
  }).join('');
}
function nextHtml() {
  const n = pickResult
    ? {text: '放榜了嗎？選結果：', actions: [{label: '正取', set: {status: 'admitted'}}, {label: '備取', set: {status: 'waitlist'}}, {label: '未錄取', set: {status: 'rejected'}}, {label: '一階未通過', set: {status: 'out'}}, {label: '還沒放榜', cancel: true}]}
    : nextStep(cur);
  const box = $('#sh-next');
  if (box) { box.className = 'next' + (n.tone ? ' ' + n.tone : ''); box._actions = n.actions; }
  return `<span class="next-text">${esc(n.text)}</span><span class="next-acts">
    ${n.wait ? `<label class="check">備取第 <input type="number" min="1" id="sh-wait" value="${esc(cur.waitNo ?? '')}" aria-label="備取名次"> 名</label>` : ''}
    ${n.check ? `<label class="check"><input type="checkbox" data-check="${n.check[0]}" ${cur[n.check[0]] ? 'checked' : ''}>${n.check[1]}</label>` : ''}
    ${n.actions.map((x, i) => x.href ? `<a class="btn sm ext" href="${esc(x.href)}" target="_blank" rel="noopener">${x.label}</a>` : `<button class="btn sm ${x.primary ? 'fill' : ''}" type="button" data-act="${i}">${x.label}</button>`).join('')}</span>`;
}
const ivDate = () => cur.dates.find(d => ['interview', 'exam', 'window'].includes(d.kind) && isKey(d.date) && (d.end || d.date) >= todayKey()) || cur.dates.find(d => ['interview', 'exam', 'window'].includes(d.kind)) || null;
function summary(k) {
  const t = todayKey();
  switch (k) {
    case 'reg': {
      const reg = firstDate(cur, ['reg']), up = firstDate(cur, ['upload', 'letter', 'pay']);
      const stepsDone = cur.regSteps.filter(x => x.done).length;
      const steps = cur.regSteps.length && ['prep', 'applied'].includes(cur.status) ? `<span class="${stepsDone === cur.regSteps.length ? 'ok' : ''}">步驟 ${stepsDone}/${cur.regSteps.length}</span>` : '';
      if (!reg && !cur.dates.length) return [steps, '還沒有日期'].filter(Boolean).join('・');
      const parts = [];
      if (reg) parts.push(reg.date >= t ? `<span class="${diffDays(reg.date) <= 3 ? 'hot' : ''}">報名截止 ${whenText(reg)}（${cdText(diffDays(reg.date))}）</span>` : `報名已截止 ${whenText(reg)}`);
      if (up && up.date >= t) parts.push(`${KINDS[up.kind].label} ${whenText(up)}`);
      if (steps) parts.push(steps);
      return parts.join('・') || `${cur.dates.length} 個日期`;
    }
    case 'docs': {
      const done = cur.docs.filter(d => d.done).length, due = firstDate(cur, ['upload', 'letter']) || firstDate(cur, ['reg']);
      if (!cur.docs.length) return '沒有項目';
      return `<span class="${done === cur.docs.length ? 'ok' : ''}">${done}/${cur.docs.length} 完成</span>${due && due.date >= t && done < cur.docs.length ? `・${KINDS[due.kind].label} ${whenText(due)}` : ''}`;
    }
    case 'interview': {
      const iv = ivDate();
      if (cur.ivSkip) return '標記不參加';
      return iv && isKey(iv.date) ? `${KINDS[iv.kind].label} ${whenText(iv)}${cur.place ? '・' + esc(cur.place) : ''}` : '還沒有面試日期';
    }
    case 'result': {
      const rel = firstDate(cur, ['release']);
      const st = STATUS[cur.status];
      if (['admitted', 'waitlist', 'rejected', 'out'].includes(cur.status)) return stateHtml(cur);
      return rel ? `放榜 ${whenText(rel)}` : '還沒有放榜日期';
    }
    case 'brochure': return cur.programId ? '報名資格・甄選方式・要繳的資料' : '沒有連到簡章';
    case 'info': return [cur.fee != null && `報名費 ${fmtMoney(cur.fee)}`, cur.quota != null && `名額 ${cur.quota}`, (cur.methods || []).join('、')].filter(Boolean).join('・');
  }
  return '';
}
const kindOpts = sel => Object.entries(KINDS).filter(([k]) => k !== 'open').map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v.label}</option>`).join('');
function gcalUrl(d) {
  const ymd = k => k.replace(/-/g, '');
  let dates, tz = '';
  if (/^\d{2}:\d{2}$/.test(d.time || '')) { const [h, mi] = d.time.split(':').map(Number); dates = `${ymd(d.date)}T${String(h).padStart(2, '0')}${String(mi).padStart(2, '0')}00/${ymd(d.date)}T${String(Math.min(h + 1, 23)).padStart(2, '0')}${String(mi).padStart(2, '0')}00`; tz = '&ctz=Asia/Taipei'; }
  else { const e = new Date(d.end || d.date); e.setDate(e.getDate() + 1); dates = `${ymd(d.date)}/${ymd(e.toISOString().slice(0, 10))}`; }
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${appName(cur)}｜${KINDS[d.kind].label}`)}&dates=${dates}${tz}&details=${encodeURIComponent(d.note || '')}${cur.place ? '&location=' + encodeURIComponent(cur.place) : ''}`;
}
function body(k) {
  const t = todayKey();
  switch (k) {
    case 'reg': return `<div class="two" style="margin-bottom:12px">
        <div class="field"><label>報名步驟</label><div class="list-col" id="sh-regsteps">${cur.regSteps.map(x => `<label class="check ${x.done ? 'done' : ''}"><input type="checkbox" data-regstep="${esc(x.id)}" ${x.done ? 'checked' : ''}>${esc(x.name)}</label>`).join('')}</div></div>
        <div class="field"><label for="i-regno">報名序號／准考證號</label><input type="text" id="i-regno" value="${esc(cur.regNo || '')}" placeholder="放榜只公布准考證號，記下來才找得到自己" autocomplete="off"><span class="small muted">報名系統的登入帳號、繳費帳號也可以記在「基本資料」的筆記</span></div>
      </div>
      <div class="quiet" id="sh-dates">${cur.dates.length ? cur.dates.map(d => dateRow(d, t)).join('') : '<div class="small muted">還沒有日期</div>'}</div>
      <div class="sec-tools"><button class="btn sm" type="button" id="sh-add-date">＋ 新增日期</button></div>`;
    case 'docs': {
      const p = cur.programId && P.byId.get(cur.programId);
      return `<div class="quiet" id="sh-docs">${cur.docs.length ? cur.docs.map(docRow).join('') : '<div class="small muted">沒有項目</div>'}</div>
      <div class="sec-tools"><button class="btn sm" type="button" id="sh-add-doc">＋ 新增項目</button><span class="small muted">到「備審」分頁可以一次看所有學校</span></div>
      ${p && p.fmt ? `<div class="p-sec" style="margin-top:14px"><h4>格式規定<span class="src">簡章節錄，上傳前對照一次</span></h4><ul class="hint-q">${p.fmt.map(s => `<li>・${esc(s)}</li>`).join('')}</ul></div>` : ''}`;
    }
    case 'interview': {
      const iv = ivDate(), p = cur.programId && P.byId.get(cur.programId);
      const w = p && (p.it || []).filter(i => i[0]).map(([n, wt]) => n + (wt != null ? ` ${wt}%` : '')).join('、');
      return `<div class="iv-top">
          <div class="field"><label>面試日期</label>${iv ? `<div class="row" style="display:flex;gap:6px"><input type="date" data-ivf="date" value="${esc(iv.date)}" aria-label="面試日期"><input type="time" data-ivf="time" value="${esc(iv.time)}" aria-label="面試時間" style="width:110px"></div>` : '<button class="btn sm" type="button" id="sh-add-iv">加面試日期</button>'}</div>
          <div class="field"><label for="i-place">地點</label><div style="display:flex;gap:6px"><input type="text" id="i-place" value="${esc(cur.place || '')}" placeholder="例如：資訊館 2 樓" autocomplete="off">${cur.place ? `<a class="btn sm ext" href="https://www.google.com/maps/search/${encodeURIComponent(cur.school + ' ' + cur.place)}" target="_blank" rel="noopener">地圖</a>` : ''}</div></div>
          <div class="field"><span class="label">這場</span><div class="seg"><button type="button" data-ivskip="0" aria-pressed="${!cur.ivSkip}">會去</button><button type="button" data-ivskip="1" aria-pressed="${!!cur.ivSkip}">不參加</button></div></div>
        </div>
        ${w ? `<p class="small sub" style="margin-bottom:10px">甄選：${esc(w)}</p>` : ''}
        ${p && p.ivn ? `<div class="p-sec"><h4>簡章提到<span class="src">自動節錄，請對照簡章</span></h4><ul class="hint-q">${p.ivn.map(s => `<li>・${esc(s)}</li>`).join('')}</ul></div>` : ''}
        <div class="two">
          <div class="field"><label>當天要帶</label><div class="kit" id="sh-kit">${cur.kit.map(x => `<label class="check ${x.done ? 'done' : ''}"><input type="checkbox" data-kit="${esc(x.id)}" ${x.done ? 'checked' : ''}>${esc(x.name)}</label>`).join('')}<button class="link" type="button" id="sh-add-kit">＋ 加一項</button></div></div>
          <div class="field"><label>常被問的問題</label><ul class="hint-q">${COMMON_QUESTIONS.map(q => `<li>・${esc(q)}</li>`).join('')}</ul></div>
          <div class="field"><label for="i-prep">準備重點</label><textarea id="i-prep" rows="7" placeholder="自我介紹怎麼講、作品要怎麼說、想強調的經歷…">${esc(cur.prep || '')}</textarea></div>
          <div class="field"><label for="i-asked">面試後紀錄</label><textarea id="i-asked" rows="7" placeholder="被問了什麼、答得如何、下一場要調整什麼">${esc(cur.asked || '')}</textarea></div>
        </div>`;
    }
    case 'result': {
      const rel = firstDate(cur, ['release']), cf = firstDate(cur, ['confirm']), g = firstDate(cur, ['giveup']), wt = firstDate(cur, ['wait']);
      const R = [['admitted', '正取'], ['waitlist', '備取'], ['rejected', '未錄取'], ['out', '一階未通過']];
      return `<div class="result-row"><span class="small sub">放榜 ${rel ? whenText(rel) : '（沒有日期）'}</span><div class="seg">${R.map(([v, l]) => `<button type="button" data-result="${v}" aria-pressed="${cur.status === v}">${l}</button>`).join('')}</div>
        ${cur.status === 'waitlist' ? `<label class="check">備取第 <input type="number" min="1" id="sh-wait2" value="${esc(cur.waitNo ?? '')}" style="width:64px;height:28px"> 名</label>` : ''}</div>
        <dl class="kv" style="margin-top:12px">
          ${cf ? `<dt>報到截止</dt><dd>${whenText(cf)}${cf.note ? ` · ${esc(cf.note)}` : ''}</dd>` : ''}
          ${g ? `<dt>放棄截止</dt><dd>${whenText(g)}${g.note ? ` · ${esc(g.note)}` : ''}</dd>` : ''}
          ${wt ? `<dt>備取遞補</dt><dd>${whenText(wt)}${wt.note ? ` · ${esc(wt.note)}` : ''}</dd>` : ''}
        </dl>
        ${cur.status === 'waitlist' ? `<div class="field" style="margin-top:12px"><label>遞補紀錄</label><div class="waitlog" id="sh-waitlog">${cur.waitLog.map(x => `<span>${esc(fmtDate(x.date))} 遞補到第 ${esc(x.rank)} 名${x.note ? '・' + esc(x.note) : ''} <button class="link" type="button" data-del-wait="${esc(x.id)}">✕</button></span>`).join('')}</div>
          <form class="row" id="sh-wait-add" style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><input type="date" id="wl-date" value="${t}" aria-label="日期"><input type="number" id="wl-rank" min="1" placeholder="遞補到第幾名" style="width:140px"><input type="text" id="wl-note" placeholder="備註（公告、電話通知…）" style="flex:1;min-width:160px"><button class="btn sm" type="submit">記一筆</button></form></div>` : ''}`;
    }
    case 'brochure': {
      const p = cur.programId && P.byId.get(cur.programId);
      if (!p) return '<div class="small muted">這筆紀錄沒有連到簡章資料。用「新增學校」從清單選學校和系，就會自動連結。</div>';
      const its = (p.it || []).filter(i => i[0]);
      const hasW = its.some(i => i[1] != null), total = hasW ? its.reduce((s, i) => s + (i[1] || 0), 0) || 1 : its.length;
      const facts = [['報名費', p.fee], ['減免', p.fr], ['推薦信', p.rl ? rlText(p.rl) + (p.rld && p.rl !== 'N' ? `（${fmtDate(p.rld)} 前）` : '') : ''], ['作品集', p.pf === 'Y' ? '需要' + (p.pfd ? `（${fmtDate(p.pfd)} 前）` : '') : p.pf === 'N' ? '不需要' : ''], ['同校可報', p.mx && p.mx !== 'X' ? p.mx : ''], ['優先錄取', p.pr && p.pr !== 'N' ? p.pr.replace(/^Y\//, '') : ''], ['考試地點', p.loc], ['諮詢', [p.ph, p.em, p.ct].filter(Boolean).join('・')]].filter(([, v]) => v);
      return `<div class="p-sec"><h4>報名資格${p.qxp ? `<span class="src">簡章第 ${p.qxp} 頁</span>` : ''}</h4><p class="qual">${esc(p.qx || p.tgt || '沒有找到，請看簡章原文。')}</p></div>
        ${its.length ? `<div class="p-sec"><h4>甄選方式</h4><div class="weight"><div class="wbar">${its.map(([n, w]) => `<i class="w-${itemClass(n)}" style="width:${((hasW ? (w || 0) : 1) / total * 100).toFixed(1)}%"></i>`).join('')}</div><div class="witems">${its.map(([n, w, st]) => `<span><i class="w-${itemClass(n)}"></i>${esc(n)}${w != null ? ` ${w}%` : ''}${st ? `（${esc(st)}）` : ''}</span>`).join('')}</div></div></div>` : ''}
        ${docListHtml(p)}
        ${facts.length ? `<dl class="kv">${facts.map(([k2, v]) => `<dt>${k2}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
        ${p.cw ? `<div class="p-sec" style="margin-top:12px"><h4>報到與遞補</h4><p class="small sub">${esc(p.cw)}</p></div>` : ''}
        <div class="sec-tools"><button class="btn sm" type="button" data-view-prog>看簡章原文</button></div>`;
    }
    case 'info': return `<div class="info-grid">
        <div class="field"><label for="i-school">學校</label><input id="i-school" list="school-names" value="${esc(cur.school || '')}" autocomplete="off" placeholder="例如：輔仁大學"></div>
        <div class="field"><label for="i-dept">學系／組別</label><input id="i-dept" value="${esc(cur.dept || '')}" autocomplete="off" placeholder="例如：資訊工程學系"></div>
        <div class="field"><label for="i-fee">報名費（元）</label><input id="i-fee" type="number" min="0" value="${esc(cur.fee ?? '')}"></div>
        <div class="field"><label for="i-quota">招生名額</label><input id="i-quota" type="number" min="0" value="${esc(cur.quota ?? '')}"></div>
        <div class="field span"><span class="label">甄選方式</span><div class="kit">${METHODS.map((m, i) => `<label class="check"><input type="checkbox" data-method="${esc(m)}" ${(cur.methods || []).includes(m) ? 'checked' : ''}>${esc(m)}</label>`).join('')}</div></div>
        <div class="field span"><label for="i-url">系所網站或簡章網址</label><input id="i-url" type="url" value="${esc(cur.url || '')}" placeholder="https://" autocomplete="off"></div>
        <div class="field span"><label for="i-notes">筆記</label><textarea id="i-notes" rows="4" placeholder="承辦窗口、系所特色、想強調的經歷…">${esc(cur.notes || '')}</textarea></div>
        <div class="field span"><label>顏色</label><div class="kit">${Array.from({length: 10}, (_, i) => `<button class="icon-btn" type="button" data-color="${i}" aria-label="顏色 ${i + 1}" style="${i === (cur.color ?? -1) ? 'outline:2px solid var(--ink);outline-offset:1px' : ''}"><span class="dot" style="background:var(--c${i});width:14px;height:14px"></span></button>`).join('')}</div></div>
      </div>
      <datalist id="school-names">${P.schools.map(s => `<option value="${esc(s.name)}"></option>`).join('')}</datalist>`;
  }
  return '';
}
const dateRow = (d, t) => `<div class="date-row ${isKey(d.date) && (d.end || d.date) < t ? 'past' : ''}" data-id="${esc(d.id)}">
  <select data-f="kind" aria-label="類型">${kindOpts(d.kind)}</select>
  <input type="date" data-f="date" value="${esc(d.date)}" aria-label="日期">
  <input type="time" data-f="time" value="${esc(d.time)}" aria-label="時間">
  <input type="text" data-f="note" value="${esc(d.note)}" placeholder="備註" aria-label="備註">
  ${isKey(d.date) && (d.end || d.date) >= t ? `<a class="gcal" href="${gcalUrl(d)}" target="_blank" rel="noopener" title="加到 Google 日曆">${icon('calendar')}</a>` : '<span></span>'}
  <button class="icon-btn" type="button" data-del-date="${esc(d.id)}" aria-label="刪除">✕</button>
</div>`;
const docRow = d => `<div class="doc-row ${d.done ? 'done' : ''}" data-id="${esc(d.id)}"><input type="checkbox" data-f="done" ${d.done ? 'checked' : ''} aria-label="完成"><input type="text" data-f="name" value="${esc(d.name)}" placeholder="項目名稱" aria-label="項目名稱"><button class="icon-btn" type="button" data-del-doc="${esc(d.id)}" aria-label="刪除">✕</button></div>`;

/* ---------- 儲存 ---------- */
function setSave(id, state) {
  if (!cur || cur.id !== id) return;
  const el = $('#sh-save'); if (!el) return;
  el.classList.toggle('err', state === 'error');
  el.textContent = {saving: '儲存中…', saved: '已儲存', error: '儲存失敗'}[state] || '';
}
saveHooks.state = setSave;
const commitSoon = debounce(() => commit(), 450);
function commit() {
  if (!cur || !cur.school.trim()) return;
  delete cur.example;
  const body = clone(cur);
  body.school = body.school.trim(); body.dept = (body.dept || '').trim();
  upsertApp(body);
}
function applyStatus(patch) {
  Object.assign(cur, patch);
  if (patch.choice === 'attend') for (const a of S.apps) if (a.id !== cur.id && a.choice === 'attend') upsertApp({...clone(a), choice: ''});
  if (patch.status && !['admitted', 'waitlist'].includes(patch.status)) cur.choice = '';
  pickResult = false;
  if (patch.status) { const s = openSet(cur); s.clear(); s.add(defaultSec(cur)); }
  commit();
  renderSheet();
}
function disarmDelete() { delArmed = false; clearTimeout(delTimer); const b = $('#sh-delete'); if (b) { b.classList.remove('armed'); b.textContent = '刪除這間學校'; } }
const refreshSec = k => { const el = $(`#sheet .sec[data-sec="${k}"] .sec-b`); if (el) el.innerHTML = body(k); };

/* ---------- 事件 ---------- */
export function wireSchools() {
  $('#rail').addEventListener('click', e => { const b = e.target.closest('[data-app]'); if (b) selectSchool(b.dataset.app); });
  $('#rail-add').addEventListener('click', () => document.dispatchEvent(new CustomEvent('open-wizard')));
  const sheet = $('#sheet');
  document.addEventListener('click', e => { if (!e.target.closest('#sh-menu')) { const m = $('#sh-menu'); if (m) m.classList.remove('open'); } });
  sheet.addEventListener('click', e => {
    if (!cur) return;
    if (e.target.closest('[data-menu]')) { $('#sh-menu').classList.toggle('open'); return; }
    const tog = e.target.closest('[data-toggle]');
    if (tog) { const s = openSet(cur), k = tog.dataset.toggle; s.has(k) ? s.delete(k) : s.add(k); tog.closest('.sec').classList.toggle('open', s.has(k)); return; }
    const os = e.target.closest('[data-open-sec]');
    if (os) { openSet(cur).add(os.dataset.openSec); $(`#sheet .sec[data-sec="${os.dataset.openSec}"]`).classList.add('open'); $('#sh-menu').classList.remove('open'); return; }
    if (e.target.closest('[data-view-prog]')) { go('finder', {id: cur.programId}); return; }
    if (e.target.closest('[data-reset-dates]')) {
      $('#sh-menu').classList.remove('open');
      const p = cur.programId && P.byId.get(cur.programId);
      if (!p) return;
      if (!confirm('把這間學校的日期換成簡章目前的日期？你自己改過或加的日期會被蓋掉。')) return;
      cur.dates = programDates(p).sort((x, y) => (x.date || '9').localeCompare(y.date || '9'));
      commit(); renderSheet(); toast('已用簡章日期重設');
      return;
    }
    if (e.target.closest('[data-print-one]')) { document.dispatchEvent(new CustomEvent('print-one', {detail: cur.id})); $('#sh-menu').classList.remove('open'); return; }
    const step = e.target.closest('[data-step]');
    if (step) { if (step.dataset.step === 'result') { pickResult = true; openSet(cur).add('result'); renderSheet(); } else applyStatus({status: step.dataset.step}); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      const x = $('#sh-next')._actions[Number(act.dataset.act)];
      if (!x) return;
      if (x.cancel) { pickResult = false; $('#sh-next').innerHTML = nextHtml(); return; }
      if (x.tab) { openSet(cur).add(x.tab); $(`#sheet .sec[data-sec="${x.tab}"]`).classList.add('open'); $(`#sheet .sec[data-sec="${x.tab}"]`).scrollIntoView({block: 'nearest'}); return; }
      applyStatus(x.set); return;
    }
    const res = e.target.closest('[data-result]');
    if (res) { applyStatus({status: res.dataset.result}); return; }
    const skip = e.target.closest('[data-ivskip]');
    if (skip) { cur.ivSkip = skip.dataset.ivskip === '1'; commit(); refreshSec('interview'); return; }
    const col = e.target.closest('[data-color]');
    if (col) { cur.color = Number(col.dataset.color); commit(); refreshSec('info'); renderSheetMeta(); return; }
    if (e.target.closest('#sh-add-date')) { cur.dates.push({id: uid(), kind: 'interview', date: '', end: '', time: '', note: ''}); refreshSec('reg'); const rows = $$('#sh-dates .date-row'); $('input[type="date"]', rows[rows.length - 1]).focus(); return; }
    if (e.target.closest('#sh-add-iv')) { cur.dates.push({id: uid(), kind: 'interview', date: '', end: '', time: '', note: '面試'}); refreshSec('interview'); refreshSec('reg'); return; }
    const dd = e.target.closest('[data-del-date]');
    if (dd) { cur.dates = cur.dates.filter(d => d.id !== dd.dataset.delDate); commit(); refreshSec('reg'); renderSheetMeta(); return; }
    if (e.target.closest('#sh-add-doc')) { cur.docs.push({id: uid(), name: '', done: false}); refreshSec('docs'); const rows = $$('#sh-docs .doc-row'); $('input[type="text"]', rows[rows.length - 1]).focus(); return; }
    const dc = e.target.closest('[data-del-doc]');
    if (dc) { cur.docs = cur.docs.filter(d => d.id !== dc.dataset.delDoc); commit(); refreshSec('docs'); renderSheetMeta(); return; }
    if (e.target.closest('#sh-add-kit')) { const n = prompt('要帶的東西'); if (n && n.trim()) { cur.kit.push({id: uid(), name: n.trim(), done: false}); commit(); refreshSec('interview'); } return; }
    const dw = e.target.closest('[data-del-wait]');
    if (dw) { cur.waitLog = cur.waitLog.filter(x => x.id !== dw.dataset.delWait); commit(); refreshSec('result'); return; }
    if (e.target.closest('#sh-delete')) {
      const b = $('#sh-delete');
      if (!delArmed) { delArmed = true; b.classList.add('armed'); b.textContent = '確定刪除？'; delTimer = setTimeout(disarmDelete, 4000); return; }
      const id = cur.id; disarmDelete(); cur = null; sv.id = null;
      removeApp(id); toast('已刪除'); return;
    }
  });
  sheet.addEventListener('input', e => {
    if (!cur) return;
    const t = e.target;
    const row = t.closest('.date-row');
    if (row) { const d = cur.dates.find(x => x.id === row.dataset.id); if (d) { d[t.dataset.f] = t.value; if (!composing(e)) commitSoon(); } return; }
    const drow = t.closest('.doc-row');
    if (drow && t.dataset.f === 'name') { const d = cur.docs.find(x => x.id === drow.dataset.id); if (d) { d.name = t.value; if (!composing(e)) commitSoon(); } return; }
    if (t.dataset.ivf) { const iv = ivDate(); if (iv) { iv[t.dataset.ivf] = t.value; commitSoon(); } return; }
    const map = {'i-school': 'school', 'i-dept': 'dept', 'i-url': 'url', 'i-notes': 'notes', 'i-prep': 'prep', 'i-asked': 'asked', 'i-place': 'place', 'i-regno': 'regNo'};
    if (map[t.id]) { cur[map[t.id]] = t.value; if (t.id === 'i-school' || t.id === 'i-dept') renderSheetMeta(); if (!composing(e)) commitSoon(); return; }
    if (t.id === 'i-fee') { cur.fee = numOrNull(t.value); commitSoon(); return; }
    if (t.id === 'i-quota') { cur.quota = numOrNull(t.value); commitSoon(); return; }
    if (t.id === 'sh-wait' || t.id === 'sh-wait2') { cur.waitNo = numOrNull(t.value); $('#sh-stepper').innerHTML = stepperHtml(); commitSoon(); }
  });
  sheet.addEventListener('compositionend', e => { if (cur && e.target.matches('input, textarea')) commitSoon(); });
  sheet.addEventListener('change', e => {
    if (!cur) return;
    const t = e.target;
    if (t.closest('.date-row') && ['kind', 'date', 'time'].includes(t.dataset.f)) { commitSoon.flush(); commit(); renderSheetMeta(); refreshSec('interview'); return; }
    if (t.dataset.ivf) { commit(); renderSheetMeta(); refreshSec('reg'); return; }
    const drow = t.closest('.doc-row');
    if (drow && t.dataset.f === 'done') { const d = cur.docs.find(x => x.id === drow.dataset.id); if (d) { d.done = t.checked; drow.classList.toggle('done', d.done); commit(); renderSheetMeta(); } return; }
    if (t.dataset.kit) { const x = cur.kit.find(k => k.id === t.dataset.kit); if (x) { x.done = t.checked; t.closest('.check').classList.toggle('done', x.done); commit(); } return; }
    if (t.dataset.regstep) { const x = cur.regSteps.find(k => k.id === t.dataset.regstep); if (x) { x.done = t.checked; t.closest('.check').classList.toggle('done', x.done); commit(); renderSheetMeta(); } return; }
    if (t.dataset.check) { cur[t.dataset.check] = t.checked; commit(); renderSheetMeta(); return; }
    if (t.dataset.method) { cur.methods = $$('#sheet [data-method]:checked').map(i => i.dataset.method); commit(); renderSheetMeta(); return; }
    if (t.id === 'i-place') { refreshSec('interview'); renderSheetMeta(); }
  });
  sheet.addEventListener('submit', e => {
    if (e.target.id !== 'sh-wait-add') return;
    e.preventDefault();
    const date = $('#wl-date').value, rank = numOrNull($('#wl-rank').value);
    if (!isKey(date) || !rank) { toast('請填日期和名次'); return; }
    cur.waitLog.push({id: uid(), date, rank, note: $('#wl-note').value.trim()});
    cur.waitNo = rank;
    commit(); refreshSec('result'); renderSheetMeta();
  });
}
