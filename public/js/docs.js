// 備審：所有學校一張表。列是學校（照繳件截止排），欄是資料的種類（自傳、讀書計畫、證明…），格子裡是那間學校自己的項目。
import {S, esc, clone, uid, todayKey, diffDays, cdText, deptMain, firstDate, activeApp, upsertApp, KINDS} from './core.js';
import {hueStyle, shortName, whenText} from './ui.js';
import {go} from './router.js';

const $ = s => document.querySelector(s);
export const dv = {undone: false};
// 項目名稱 → 種類
const CATS = [
  ['form', '報名表・切結', /報名表|審核表|切結|同意書|聲明|基本資料表|資料表|報名資料/],
  ['bio', '自傳・動機', /自傳|個人陳述|自我介紹|申請動機|動機|個人簡介/],
  ['plan', '讀書計畫', /讀書計畫|學習計畫|修業計畫|未來規劃|生涯/],
  ['grade', '成績・學歷證明', /成績|學歷|畢業|在學|在校|歷程|學習歷程檔案/],
  ['proof', '特殊表現證明', /證明|成果|競賽|獲獎|得獎|檢定|證照|表現|事蹟|經歷/],
  ['letter', '推薦信', /推薦/],
  ['portfolio', '作品集', /作品|專題|創作/],
  ['other', '其他', /./],
];
const catOf = name => (CATS.find(([, , re]) => re.test(name)) || CATS[CATS.length - 1])[0];

export function renderDocs() {
  const t = todayKey();
  const apps = S.apps.filter(a => activeApp(a) && (a.docs || []).length).map(a => ({a, due: firstDate(a, ['upload', 'letter']) || firstDate(a, ['reg'])}))
    .sort((x, y) => (x.due && x.due.date >= t ? x.due.date : '9' + (x.due ? x.due.date : '')).localeCompare(y.due && y.due.date >= t ? y.due.date : '9' + (y.due ? y.due.date : '')));
  const total = apps.reduce((s, x) => s + x.a.docs.length, 0), done = apps.reduce((s, x) => s + x.a.docs.filter(d => d.done).length, 0);
  $('#docs-sub').textContent = apps.length ? `${apps.length} 間學校・${total} 項，完成 ${done} 項。勾完會立刻存檔，名稱到「學校」裡改。` : '';
  $('#docs-tools').innerHTML = `<label class="toggle"><input type="checkbox" id="docs-undone" ${dv.undone ? 'checked' : ''}>只看沒完成的</label><span class="mtotal ${done === total && total ? 'ok' : ''}"><b>${done}</b> / ${total}</span>`;
  const box = $('#matrix');
  if (!apps.length) { box.innerHTML = '<div class="empty"><b>還沒有備審項目</b>加入學校後，簡章要求的資料會自動列在這裡。</div>'; return; }
  const used = CATS.filter(([k]) => apps.some(x => x.a.docs.some(d => catOf(d.name) === k && (!dv.undone || !d.done))));
  box.innerHTML = `<table class="matrix"><thead><tr><th class="first">學校・繳件截止</th>${used.map(([, label]) => `<th class="cat">${label}</th>`).join('')}</tr></thead><tbody>
    ${apps.map(({a, due}) => {
      const n = due ? diffDays(due.date) : null;
      const dn = a.docs.filter(d => d.done).length;
      const rowsDocs = a.docs.filter(d => !dv.undone || !d.done);
      if (!rowsDocs.length) return '';
      return `<tr data-app="${esc(a.id)}">
        <td class="first"><div class="rowhead" ${hueStyle(a)}><b><span class="dot"></span><button class="link" type="button" data-open="${esc(a.id)}" style="text-decoration:none;font-size:15px;font-weight:600;color:inherit">${esc(shortName(a))}</button><span class="muted small">${dn}/${a.docs.length}</span></b><span>${esc(deptMain(a))}</span>
          <span class="due ${n != null && n >= 0 && n <= 7 ? 'hot' : ''} ${dn === a.docs.length ? 'ok' : ''}">${dn === a.docs.length ? '全部完成' : due ? `${KINDS[due.kind].label} ${whenText(due)}${n != null && n >= 0 ? `（${cdText(n)}）` : '（已過）'}` : '沒有繳件日期'}</span></div></td>
        ${used.map(([k]) => { const items = rowsDocs.filter(d => catOf(d.name) === k); return `<td><div class="cell">${items.length ? items.map(d => `<label class="check ${d.done ? 'done' : ''}"><input type="checkbox" data-doc="${esc(d.id)}" ${d.done ? 'checked' : ''}><span>${esc(d.name)}</span></label>`).join('') : '<span class="none">—</span>'}</div></td>`; }).join('')}
      </tr>`;
    }).join('')}</tbody></table>`;
}
export function wireDocs() {
  const view = $('#view-docs');
  view.addEventListener('change', e => {
    if (e.target.id === 'docs-undone') { dv.undone = e.target.checked; renderDocs(); return; }
    if (!e.target.dataset.doc) return;
    const tr = e.target.closest('tr'), a = S.apps.find(x => x.id === tr.dataset.app);
    if (!a) return;
    const next = clone(a), d = next.docs.find(x => x.id === e.target.dataset.doc);
    if (!d) return;
    d.done = e.target.checked;
    delete next.example;
    upsertApp(next);
  });
  view.addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) go('schools', {id: b.dataset.open, sec: 'docs'}); });
}
