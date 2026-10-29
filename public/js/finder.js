// 找科系：左邊搜尋與結果，右邊是選到的系組（簡章重點與原文）。
import {S, P, SUGGEST, REGION_NAME, KINDS, esc, todayKey, diffDays, fmtDate, request, debounce, composing, mine, regKey, needsLetter, matchedConds, COND_BY_ID, mergeRows, bySchool, progMeta, regText, weightText, qualPills, itemClass, rlText, docListHtml, pdfUrl, schoolLinks, normName, toast} from './core.js';
import {go} from './router.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const fd = {q: '', region: '', open: false, nopf: false, norl: false, sort: 'smart', sortChosen: false, all: false, limit: 40, search: null, searching: false, match: false, pid: null, pages: null, scrollToMark: false};

/* ---------- 結果 ---------- */
function passes(p) {
  const t = todayKey(), r = p._reg;
  if (fd.region && p._region !== fd.region) return false;
  if (fd.open && !(r && r.end >= t)) return false;
  if (fd.nopf && p.pf === 'Y') return false;
  if (fd.norl && needsLetter(p)) return false;
  return true;
}
const matchOn = () => fd.match && (S.profile.tags || []).length > 0;
function results() {
  const byMatch = (a, b) => matchedConds(b).length - matchedConds(a).length;
  if (fd.q.trim() && fd.search && !fd.search.error) {
    const score = new Map(fd.search.programs.map(r => [r.id, r]));
    let list = fd.search.programs.map(r => P.byId.get(r.id)).filter(Boolean).filter(passes);
    if (matchOn()) list = list.filter(p => matchedConds(p).length);
    const cmp = {
      smart: (a, b) => score.get(b.i).score - score.get(a.i).score || regKey(a).localeCompare(regKey(b)),
      match: (a, b) => byMatch(a, b) || score.get(b.i).score - score.get(a.i).score || regKey(a).localeCompare(regKey(b)),
      deadline: (a, b) => regKey(a).localeCompare(regKey(b)),
      quota: (a, b) => (b.q || 0) - (a.q || 0),
    }[fd.sort] || ((a, b) => regKey(a).localeCompare(regKey(b)));
    return {list: list.sort(cmp), hits: score};
  }
  if (matchOn()) {
    const list = P.programs.filter(passes).filter(p => matchedConds(p).length);
    const cmp = {quota: (a, b) => (b.q || 0) - (a.q || 0), deadline: (a, b) => regKey(a).localeCompare(regKey(b))}[fd.sort] || ((a, b) => byMatch(a, b) || regKey(a).localeCompare(regKey(b)));
    return {list: list.sort(cmp), hits: new Map()};
  }
  if (fd.all) return {list: P.programs.filter(passes).sort(fd.sort === 'quota' ? (a, b) => (b.q || 0) - (a.q || 0) : (a, b) => regKey(a).localeCompare(regKey(b))), hits: new Map()};
  return null;
}
const snippetHtml = s => s ? `${esc(s.before)}<mark>${esc(s.match)}</mark>${esc(s.after)}` : '';
const snippetKey = s => s ? normName(s.before + s.match + s.after) : '';
function rowSnippet(items, hits, seen) {
  const p = items.find(x => hits.get(x.i) && hits.get(x.i).snippet);
  if (!p) return '';
  const h = hits.get(p.i), key = snippetKey(h.snippet);
  if (seen.has(key)) return `<div class="rrow-snip"><span class="pg">簡章 p.${h.page}</span>條件和上面的「${esc(seen.get(key))}」相同</div>`;
  seen.set(key, p._main);
  return `<div class="rrow-snip"><span class="pg">簡章 p.${h.page}</span>${snippetHtml(h.snippet)}</div>`;
}
const fitText = items => { if (!matchOn()) return ''; const labels = [...new Set(items.flatMap(p => matchedConds(p).map(c => c.label.split('（')[0])))]; return labels.length ? `<span class="fit">符合 ${labels.map(esc).join('・')}</span>` : ''; };
function rowHtml(r, hits, seen) {
  if (r.items.length === 1) {
    const p = r.items[0];
    return `<button class="rrow ${fd.pid === p.i ? 'on' : ''}" type="button" data-prog="${esc(p.i)}">
      <div class="rrow-t">${esc(r.main)}${qualPills(p._quals)}${fitText([p])}${mine(p.i) ? '<span class="mine">已加入</span>' : ''}</div>
      <div class="rrow-m">${progMeta(p).map(b => `<span>${b}</span>`).join('')}</div>
      ${rowSnippet(r.items, hits, seen)}
    </button>`;
  }
  const first = r.items[0];
  return `<div class="rrow">
    <div class="rrow-t">${esc(r.main)}${fitText(r.items)}<span class="muted small" style="font-weight:400">${r.items.length} 個招生組別</span></div>
    <div class="rrow-m">${progMeta(first, false).map(b => `<span>${b}</span>`).join('')}</div>
    <div class="rrow-groups">${r.items.map(p => `<button class="btn xs ${fd.pid === p.i ? 'fill' : ''}" type="button" data-prog="${esc(p.i)}">${esc(p._quals.join('・') || '一般')}<small>名額 ${p.q ?? '—'}</small>${mine(p.i) ? '<small class="ok">已加入</small>' : ''}</button>`).join('')}</div>
    ${rowSnippet(r.items, hits, seen)}
  </div>`;
}
function renderCondBar() {
  const tags = (S.profile.tags || []).map(id => COND_BY_ID.get(id)).filter(Boolean);
  const bar = $('#cond-bar');
  if (!tags.length) { bar.innerHTML = `<button class="btn sm ghost" type="button" data-settings="cond">依我的條件找</button>`; return; }
  bar.innerHTML = `<label class="toggle"><input type="checkbox" id="f-match" ${fd.match ? 'checked' : ''}>符合我的條件（${tags.length}）</label><button class="btn xs ghost" type="button" data-settings="cond">改條件</button>`;
}
export function renderFinder() {
  const box = $('#results'), meta = $('#result-meta');
  renderCondBar();
  if (!P.programs.length) { meta.innerHTML = ''; box.innerHTML = '<div class="empty">正在載入科系資料…</div>'; return; }
  if (fd.searching) { meta.innerHTML = '<span>搜尋中…</span>'; return; }
  const res = results();
  if (!res) {
    meta.innerHTML = `<span>${P.programs.length} 個系組・${P.schools.length} 間學校</span><button class="link" type="button" id="show-all">列出全部</button>`;
    box.innerHTML = `<div class="sugg">
      <div><b>常用</b>${SUGGEST.map(s => `<button class="link" type="button" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <div><b>學群</b>${P.groups.slice(0, 18).map(([g, n]) => `<button class="link" type="button" data-q="${esc(g)}">${esc(g)} <span class="muted">${n}</span></button>`).join('')}</div>
      <div class="muted">也可以搜簡章裡的字，例如「AIS3」「金盾獎」「APCS」，會列出報名資格有提到的系。</div>
    </div>`;
    return;
  }
  if (fd.search && fd.search.error) { meta.innerHTML = ''; box.innerHTML = '<div class="empty">搜尋失敗，請確認伺服器還在執行。</div>'; return; }
  const {list, hits} = res;
  if (!fd.q.trim() && fd.sort === 'smart') fd.sort = matchOn() ? 'match' : 'deadline';
  if (fd.sort === 'match' && !matchOn()) fd.sort = fd.q.trim() ? 'smart' : 'deadline';
  const open = list.filter(p => p._reg && p._reg.end >= todayKey()).length;
  const sorts = [['match', '最符合我的條件'], ['smart', '最相關'], ['deadline', '截止最近'], ['quota', '名額最多']].filter(([v]) => (v !== 'smart' || fd.q.trim()) && (v !== 'match' || matchOn()));
  meta.innerHTML = `<span>${list.length} 個系組・${new Set(list.map(p => p.s)).size} 校・還能報名 ${open}</span><select id="sort" aria-label="排序">${sorts.map(([v, l]) => `<option value="${v}" ${fd.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const rows = mergeRows(list), shown = rows.slice(0, fd.limit);
  let html = bySchool(shown).map(g => { const seen = new Map(); return `<div class="r-school"><span>${esc(g.school)}</span><span>${g.rows.reduce((s, r) => s + r.items.length, 0)}</span></div>${g.rows.map(r => rowHtml(r, hits, seen)).join('')}`; }).join('');
  if (rows.length > shown.length) html += `<div style="padding:10px 0;text-align:center"><button class="btn sm" type="button" id="show-more">再顯示 ${Math.min(40, rows.length - shown.length)} 個（還有 ${rows.length - shown.length}）</button></div>`;
  if (!list.length) html = `<div class="empty">${fd.q.trim() ? `沒有「${esc(fd.q.trim())}」的結果。` : '沒有符合的系組。'}試試更短的字，或取消篩選。</div>`;
  const general = fd.q.trim() && fd.search ? fd.search.general.filter(g => !fd.region || (P.schools.find(s => s.code === g.code) || {}).region === fd.region) : [];
  if (general.length) html += `<div class="general"><h4>簡章其他頁面也有</h4>${general.slice(0, 10).map(g => { const u = pdfUrl(g.code, g.page); const inner = `<b>${esc(g.school)} p.${g.page}</b>${snippetHtml(g.snippet)}`; return u ? `<a href="${u}" target="_blank" rel="noopener">${inner}</a>` : `<div>${inner}</div>`; }).join('')}</div>`;
  box.innerHTML = html;
}
let ctl = null;
async function runSearch() {
  const q = fd.q.trim();
  fd.limit = 40;
  if (!q) { fd.search = null; fd.searching = false; renderFinder(); return; }
  if (ctl) ctl.abort();
  ctl = new AbortController();
  fd.searching = true; renderFinder();
  try { const res = await fetch('/api/search?q=' + encodeURIComponent(q), {signal: ctl.signal}); fd.search = await res.json(); if (!fd.sortChosen) fd.sort = 'smart'; }
  catch (e) { if (e.name === 'AbortError') return; fd.search = {error: true}; }
  fd.searching = false;
  $('#results').scrollTop = 0;
  renderFinder();
}
const runSearchSoon = debounce(runSearch, 200);
export function setQuery(q) { fd.q = q; $('#q').value = q; fd.all = false; runSearch(); }

/* ---------- 右邊：一個系組 ---------- */
function highlightRe() {
  const toks = fd.q.trim().split(/\s+/).filter(t => t.length >= 2 || /[A-Za-z0-9]/.test(t));
  if (!toks.length) return null;
  const part = t => [...t].map(ch => ch === '台' || ch === '臺' ? '[台臺]' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  return new RegExp(toks.map(part).join('|'), 'gi');
}
function markText(text, re) {
  if (!re) return esc(text);
  let out = '', last = 0;
  text.replace(re, (m, at) => { out += esc(text.slice(last, at)) + `<mark>${esc(m)}</mark>`; last = at + m.length; return m; });
  return out + esc(text.slice(last));
}
function weightHtml(p) {
  const its = (p.it || []).filter(i => i[0]);
  if (!its.length) return '<p class="small muted">簡章資料沒有列出甄選項目。</p>';
  const hasW = its.some(i => i[1] != null), total = hasW ? its.reduce((s, i) => s + (i[1] || 0), 0) || 1 : its.length;
  return `<div class="weight"><div class="wbar">${its.map(([n, w]) => `<i class="w-${itemClass(n)}" style="width:${((hasW ? (w || 0) : 1) / total * 100).toFixed(1)}%"></i>`).join('')}</div><div class="witems">${its.map(([n, w, st]) => `<span><i class="w-${itemClass(n)}"></i>${esc(n)}${w != null ? ` ${w}%` : ''}${st ? `（${esc(st)}）` : ''}</span>`).join('')}</div></div>`;
}
export async function openProgram(pid) {
  const p = P.byId.get(pid);
  if (!p) return;
  fd.pid = pid;
  $$('#results .on').forEach(el => el.classList.remove('on'));
  const re = highlightRe(), t = todayKey();
  const sib = P.programs.filter(x => x.s === p.s && x._main === p._main);
  const m = mine(p.i), r = p._reg;
  const dl = r ? (t < r.start ? {n: diffDays(r.start), label: '開始報名', hot: false} : r.end >= t ? {n: diffDays(r.end), label: '報名截止', hot: diffDays(r.end) <= 7} : {n: null, label: '已截止', hot: false}) : null;
  const L = schoolLinks(p.school) || {};
  const links = [L.apply && [L.apply, '網路報名系統'], L.adm && [L.adm, '學校招生網'], p.u && [p.u, '系所網站／簡章連結'], p.du && [p.du, '學系網站'], [`https://sta-tw.org/bochures/program/${encodeURIComponent(p.i)}/`, '特殊選才網'], pdfUrl(p.code) && [pdfUrl(p.code), '整份簡章 PDF']].filter(Boolean).filter(([u]) => /^https?:\/\/|^\//.test(u));
  const facts = [['報名費減免', p.fr], ['推薦信', p.rl ? rlText(p.rl) + (p.rld && p.rl !== 'N' ? `（${fmtDate(p.rld)} 前）` : '') : ''], ['作品集', p.pf === 'Y' ? '需要' + (p.pfd ? `（${fmtDate(p.pfd)} 前）` : '') : p.pf === 'N' ? '不需要' : ''], ['同校可報', p.mx && p.mx !== 'X' ? p.mx : ''], ['優先錄取', p.pr && p.pr !== 'N' ? p.pr.replace(/^Y\//, '') : ''], ['考試地點', p.loc], ['諮詢', [p.ph, p.em, p.ct].filter(Boolean).join('・')]].filter(([, v]) => v);
  const events = (p.ev || []).map(([k, sd, ed, st, et, name]) => `<li class="${(ed || sd) < t ? 'past' : ''}"><span>${esc(name)}</span><span class="when">${fmtDate(sd)}${st ? ' ' + st : ''}${ed ? ` – ${fmtDate(ed)}${et ? ' ' + et : ''}` : ''}</span></li>`).join('');
  const pages = p.pg || [];
  $('#prog').innerHTML = `<div class="prog">
    <div class="prog-head">
      <div style="min-width:0"><h2>${esc(p.school)} ${esc(p._main)}${qualPills(p._quals)}</h2>
        <div class="sub">${[p.g && esc(p.g), REGION_NAME[p._region]].filter(Boolean).join('・')}${sib.length > 1 ? `<span>組別：${sib.map(x => `<button class="btn xs ${x.i === p.i ? 'fill' : ''}" type="button" data-prog="${esc(x.i)}">${esc(x._quals.join('・') || '一般')}</button>`).join(' ')}</span>` : ''}</div></div>
      <div class="sheet-tools">${m ? `<button class="btn sm" type="button" data-open-app="${esc(m.id)}">已在我的學校 · 打開</button>` : `<button class="btn sm fill" type="button" data-add-prog="${esc(p.i)}">＋ 加入我的學校</button>`}</div>
    </div>
    <div class="prog-facts">
      <div class="fact"><b>${p.q ?? '—'}</b><span>名額</span></div>
      ${dl ? `<div class="fact ${dl.hot ? 'hot' : ''}"><b>${dl.n == null ? '已截止' : dl.n === 0 ? '今天' : `${dl.n} 天`}</b><span>${dl.label}${r.end ? ` ${fmtDate(r.end)}${r.time ? ' ' + r.time : ''}` : ''}</span></div>` : ''}
      ${p.fee ? `<div class="fact"><b>${esc(String(p.fee).replace(/元$/, ''))}</b><span>報名費（元）</span></div>` : ''}
      ${weightText(p) ? `<div class="fact"><b style="font-size:15px;line-height:1.6">${esc(weightText(p))}</b><span>甄選方式</span></div>` : ''}
    </div>
    <div class="prog-body">
      <div class="prog-col"><div class="scroll">
        <div class="p-sec"><h4>報名資格${p.qxp ? `<span class="src">簡章第 ${p.qxp} 頁</span>` : ''}</h4><p class="qual">${p.qx ? markText(p.qx, re) : p.tgt ? markText(p.tgt, re) : '<span class="muted">沒有找到，請看右邊的簡章原文。</span>'}</p></div>
        ${p.deb || p.deo ? `<div class="p-sec"><h4>不同教育資歷</h4><p class="small">${esc([p.deb, p.deo].filter(Boolean).join(' '))}</p></div>` : ''}
        <div class="p-sec"><h4>甄選方式</h4>${weightHtml(p)}</div>
        ${docListHtml(p)}
        ${p.fmt ? `<div class="p-sec"><h4>格式規定<span class="src">自動節錄</span></h4><ul class="hint-q">${p.fmt.map(s => `<li>・${esc(s)}</li>`).join('')}</ul></div>` : ''}
        ${p.ivn ? `<div class="p-sec"><h4>面試注意<span class="src">自動節錄</span></h4><ul class="hint-q">${p.ivn.map(s => `<li>・${esc(s)}</li>`).join('')}</ul></div>` : ''}
        ${facts.length ? `<dl class="kv" style="margin-bottom:14px">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
        ${events ? `<div class="p-sec"><h4>時程</h4><ul class="prog-events">${events}</ul></div>` : ''}
        ${p.cw ? `<div class="p-sec"><h4>報到與遞補</h4><p class="small">${esc(p.cw)}</p></div>` : ''}
        <div class="p-sec"><h4>連結</h4><div class="links-row">${links.map(([u, l]) => `<a class="btn sm ext" href="${esc(u)}" target="_blank" rel="noopener">${l}</a>`).join('')}</div></div>
      </div></div>
      <div class="prog-col">
        <div class="page-tabs" id="p-tabs"><b>簡章原文</b>${pages.map(n => `<button class="page-tab" type="button" data-page="${n}" aria-selected="false">第 ${n} 頁</button>`).join('')}</div>
        <div class="brochure scroll" id="p-text">${pages.length ? '載入簡章中…' : `這個系組沒有對應到簡章的特定頁面。${pdfUrl(p.code) ? `<a href="${pdfUrl(p.code)}" target="_blank" rel="noopener">開啟整份簡章 PDF</a>` : '可以到「特殊選才網」連結查看。'}`}</div>
      </div>
    </div>
  </div>`;
  const hit = fd.q.trim() && fd.search && fd.search.programs ? fd.search.programs.find(x => x.id === pid) : null;
  fd.scrollToMark = !!(hit && hit.page);
  fd.pages = null;
  if (!pages.length) return;
  try {
    const data = await request('GET', `/api/brochure/${encodeURIComponent(p.code)}?pages=${pages.join(',')}`);
    if (fd.pid !== pid) return;
    fd.pages = {code: p.code, list: data.pages};
    showPage(hit && pages.includes(hit.page) ? hit.page : pages[0]);
  } catch (e) { const el = $('#p-text'); if (el) el.textContent = `簡章全文載入失敗：${e.message}`; }
}
function showPage(n) {
  const data = fd.pages;
  if (!data) return;
  const pg = data.list.find(x => x.page === n);
  $$('#p-tabs .page-tab').forEach(b => b.setAttribute('aria-selected', String(Number(b.dataset.page) === n)));
  const box = $('#p-text');
  box.innerHTML = `${markText(pg ? pg.text : '', highlightRe())}${pdfUrl(data.code, n) ? `\n\n<a href="${pdfUrl(data.code, n)}" target="_blank" rel="noopener">在 PDF 開啟第 ${n} 頁 →</a>` : ''}`;
  box.scrollTop = 0;
  const mk = fd.scrollToMark && box.querySelector('mark');
  if (mk) box.scrollTop = Math.max(0, mk.offsetTop - box.offsetTop - 60);
}
export function renderProgEmpty() {
  if (fd.pid && P.byId.get(fd.pid)) return;
  if (!P.programs.length) { $('#prog').innerHTML = '<div class="empty">載入科系資料中…</div>'; return; }
  $('#prog').innerHTML = `<div class="empty"><b>選一個系組</b>左邊搜尋後點一個系，這裡會顯示報名資格、甄選方式、要繳的資料和簡章原文。</div>`;
}

export function wireFinder() {
  const q = $('#q');
  q.addEventListener('input', e => { fd.q = e.target.value; fd.all = false; if (!composing(e)) runSearchSoon(); });
  q.addEventListener('compositionend', e => { fd.q = e.target.value; runSearchSoon(); });
  q.addEventListener('keydown', e => { if (composing(e)) return; if (e.key === 'Enter') runSearchSoon.flush(); if (e.key === 'Escape') { e.target.value = ''; fd.q = ''; runSearch(); } });
  $('#f-region').addEventListener('change', e => { fd.region = e.target.value; fd.limit = 40; renderFinder(); });
  for (const [id, key] of [['#f-open', 'open'], ['#f-nopf', 'nopf'], ['#f-norl', 'norl']]) $(id).addEventListener('change', e => { fd[key] = e.target.checked; fd.limit = 40; renderFinder(); });
  $('#cond-bar').addEventListener('change', e => { if (e.target.id === 'f-match') { fd.match = e.target.checked; fd.sort = fd.match ? 'match' : (fd.q.trim() ? 'smart' : 'deadline'); fd.limit = 40; renderFinder(); } });
  $('#result-meta').addEventListener('change', e => { if (e.target.id === 'sort') { fd.sort = e.target.value; fd.sortChosen = true; renderFinder(); } });
  $('#result-meta').addEventListener('click', e => { if (e.target.closest('#show-all')) { fd.all = true; fd.sort = 'deadline'; renderFinder(); } });
  $('#results').addEventListener('click', e => {
    const chip = e.target.closest('[data-q]');
    if (chip) { setQuery(chip.dataset.q); return; }
    if (e.target.closest('#show-more')) { fd.limit += 40; renderFinder(); return; }
    const r = e.target.closest('[data-prog]');
    if (r) { openProgram(r.dataset.prog); r.classList.add('on'); }
  });
  $('#prog').addEventListener('click', e => {
    const pg = e.target.closest('[data-page]'); if (pg) { showPage(Number(pg.dataset.page)); return; }
    const sw = e.target.closest('[data-prog]'); if (sw) { openProgram(sw.dataset.prog); return; }
    const add = e.target.closest('[data-add-prog]'); if (add) { document.dispatchEvent(new CustomEvent('open-wizard', {detail: {pid: add.dataset.addProg}})); return; }
    const op = e.target.closest('[data-open-app]'); if (op) go('schools', {id: op.dataset.openApp});
  });
}
