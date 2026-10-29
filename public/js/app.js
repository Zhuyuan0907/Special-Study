// 啟動：載入資料、接上五個畫面、快速鍵、列印。
import {S, P, KINDS, esc, todayKey, diffDays, fmtDate, wdShort, onChange, loadRecords, loadPrograms, upcoming, liveEvents, saving, toast, deptMain, firstDate, appName, activeApp} from './core.js';
import {go, onView, fromHash, route} from './router.js';
import {renderWeek, wireWeek} from './home.js';
import {renderSchools, selectSchool, wireSchools, currentId, refreshSheet} from './schools.js';
import {renderDocs, wireDocs} from './docs.js';
import {renderCalendar, wireCalendar, closePop} from './calendar.js';
import {renderFinder, renderProgEmpty, openProgram, wireFinder, fd} from './finder.js';
import {wireWizard, openWizard} from './wizard.js';
import {openSettings, wireSettings} from './settings.js';
import {icon, shortName} from './ui.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- 畫面切換 ---------- */
function showView(view, params = {}) {
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + view));
  $$('#tabs [data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  closePop();
  if (view === 'week') renderWeek();
  if (view === 'schools') { selectSchool(params.id || currentId() || (S.apps[0] && S.apps[0].id), {sec: params.sec}); if (!currentId()) renderSchools(); }
  if (view === 'docs') renderDocs();
  if (view === 'calendar') renderCalendar();
  if (view === 'finder') { renderFinder(); if (params.id && P.byId.has(params.id)) openProgram(params.id); else renderProgEmpty(); if (params.q != null) { fd.q = params.q; $('#q').value = params.q; } if (!params.id) setTimeout(() => $('#q').focus(), 0); }
}
onView(showView);
function renderActive() {
  updateTitle();
  if (route.view === 'week') renderWeek();
  else if (route.view === 'schools') renderSchools();
  else if (route.view === 'docs') renderDocs();
  else if (route.view === 'calendar') renderCalendar();
  else if (route.view === 'finder') renderFinder();
}
onChange(renderActive);

/* ---------- 分頁標題倒數 ---------- */
function updateTitle() {
  const next = upcoming(liveEvents())[0];
  if (!next) { document.title = '我的特選紀錄'; return; }
  const f = next.date >= todayKey() ? next.date : next.last, n = diffDays(f);
  document.title = `${n === 0 ? '今天' : n === 1 ? '明天' : n + ' 天'}｜${shortName(next.app)} ${KINDS[next.kind].label} · 特選`;
}

/* ---------- 列印 ---------- */
function printAll() {
  const t = todayKey();
  const w = d => d ? `${fmtDate(d.date)}${d.time ? ' ' + d.time : ''}` : '';
  const apps = S.apps.filter(activeApp);
  const rows = apps.map(a => `<tr><td>${esc(a.school)}<br><small>${esc(a.dept || '')}</small></td><td>${esc(({prep: '準備中', applied: '已報名', interview: '待面試', waiting: '等放榜', admitted: '正取', waitlist: '備取' + (a.waitNo ? ' ' + a.waitNo : '')})[a.status] || '')}</td><td>${w(firstDate(a, ['reg']))}</td><td>${w(firstDate(a, ['upload', 'letter']))}</td><td>${w(firstDate(a, ['interview', 'exam', 'window']))}</td><td>${w(firstDate(a, ['release']))}</td><td>${w(firstDate(a, ['confirm']))}</td><td>${w(firstDate(a, ['giveup']))}</td><td>${(a.docs || []).filter(d => d.done).length}/${(a.docs || []).length}</td></tr>`).join('');
  const up = upcoming(liveEvents()).filter(ev => diffDays(ev.date >= t ? ev.date : ev.last) <= 60).slice(0, 40);
  $('#print').innerHTML = `<h1>我的特選紀錄</h1><div class="pmeta">${fmtDate(t)}（週${wdShort(t)}）列印・${apps.length} 間學校</div>
    <table><thead><tr><th>學校／系組</th><th>狀態</th><th>報名截止</th><th>繳件截止</th><th>面試</th><th>放榜</th><th>報到截止</th><th>放棄截止</th><th>備審</th></tr></thead><tbody>${rows}</tbody></table>
    <h2>接下來 60 天</h2><table><tbody>${up.map(ev => `<tr><td style="width:110px">${fmtDate(ev.date)}（${wdShort(ev.date)}）${ev.time ? ' ' + esc(ev.time) : ''}</td><td>${esc(shortName(ev.app))} ${esc(deptMain(ev.app))}</td><td>${KINDS[ev.kind].label}${ev.note ? ' · ' + esc(ev.note) : ''}</td></tr>`).join('')}</tbody></table>
    <div class="pcols">${apps.map(a => `<div><h2>${esc(appName(a))}</h2><ul>${(a.docs || []).map(d => `<li>${d.done ? '☑' : '☐'} ${esc(d.name)}</li>`).join('')}</ul></div>`).join('')}</div>`;
  window.print();
}
function printOne(id) {
  const a = S.apps.find(x => x.id === id); if (!a) return;
  const dates = (a.dates || []).filter(d => d.date).sort((x, y) => x.date.localeCompare(y.date));
  $('#print').innerHTML = `<h1>${esc(appName(a))}</h1><div class="pmeta">${fmtDate(todayKey())} 列印${a.place ? '・面試地點：' + esc(a.place) : ''}</div>
    <div class="pcols"><div><h2>日期</h2><table><tbody>${dates.map(d => `<tr><td style="width:120px">${fmtDate(d.date)}（${wdShort(d.date)}）${d.time ? ' ' + esc(d.time) : ''}</td><td>${KINDS[d.kind] ? KINDS[d.kind].label : ''}</td><td>${esc(d.note || '')}</td></tr>`).join('')}</tbody></table></div>
    <div><h2>備審</h2><ul>${(a.docs || []).map(d => `<li>${d.done ? '☑' : '☐'} ${esc(d.name)}</li>`).join('')}</ul><h2>面試當天要帶</h2><ul>${(a.kit || []).map(d => `<li>☐ ${esc(d.name)}</li>`).join('')}</ul></div></div>
    ${a.prep ? `<h2>準備重點</h2><p style="white-space:pre-wrap;font-size:11px">${esc(a.prep)}</p>` : ''}${a.notes ? `<h2>筆記</h2><p style="white-space:pre-wrap;font-size:11px">${esc(a.notes)}</p>` : ''}`;
  window.print();
}

/* ---------- 接線 ---------- */
$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); });
$('#btn-add').addEventListener('click', () => openWizard());
$('#btn-settings').innerHTML = `${icon('settings')}設定`;
$('#btn-settings').addEventListener('click', () => openSettings());
$('#rail-print').addEventListener('click', printAll);
document.addEventListener('print-all', printAll);
document.addEventListener('print-one', e => printOne(e.detail));
document.addEventListener('profile-changed', renderActive);
$$('dialog').forEach(d => { d.addEventListener('click', e => { if (e.target === d) d.close(); }); $$('[data-close]', d).forEach(b => b.addEventListener('click', () => d.close())); });
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return;
  if (document.querySelector('dialog[open]')) return;
  const views = ['week', 'schools', 'docs', 'calendar', 'finder'];
  if (/^[1-5]$/.test(e.key)) { e.preventDefault(); go(views[Number(e.key) - 1]); }
  else if (e.key === '/') { e.preventDefault(); go('finder'); }
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openWizard(); }
});
window.addEventListener('hashchange', () => { const r = fromHash(); if (r.view !== route.view || r.params.id !== route.params.id) go(r.view, r.params); });
window.addEventListener('focus', () => { if (document.querySelector('dialog[open]') || saving() || route.view === 'schools') return; loadRecords().catch(() => {}); });
setInterval(() => { if (!document.querySelector('dialog[open]') && route.view === 'week') renderWeek(); }, 60 * 1000);

wireWeek(); wireSchools(); wireDocs(); wireCalendar(); wireFinder(); wireWizard(); wireSettings();

/* ---------- 啟動 ---------- */
// 先把網址指定的畫面顯示出來，資料到了再補上。科系資料（programs.json）比較大，網路慢時要好幾秒，
// 不能等它下載完才顯示畫面。
const first = fromHash();
go(first.view, first.params);
loadRecords()
  .then(() => { if (route.view === 'schools' && !currentId()) selectSchool(route.params.id || (S.apps[0] && S.apps[0].id), {sec: route.params.sec}); })
  .catch(e => toast('無法連到伺服器：' + e.message));
loadPrograms()
  .then(() => {
    if (P.year) $('#brand-year').textContent = `${P.year} 學年度`;
    if (route.view === 'finder' && route.params.id && fd.pid !== route.params.id) openProgram(route.params.id);
    if (route.view === 'schools') refreshSheet();
  })
  .catch(e => toast('科系資料載入失敗：' + e.message));
