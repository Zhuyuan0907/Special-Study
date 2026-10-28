// 設定：外觀、我的條件、提醒、Google Sheets、匯出與備份、特選須知。
import {S, P, CONDITIONS, KINDS, esc, request, toast, copyText, download, saveProfile, allEvents, appName, todayKey, loadRecords} from './core.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const PANES = [['look', '外觀'], ['cond', '我的條件'], ['notify', '每日提醒'], ['sheets', 'Google 試算表'], ['export', '匯出・行事曆・備份'], ['guide', '特選須知']];
const APPS_SCRIPT = `function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(d.sheet) || ss.insertSheet(d.sheet);
  sh.clearContents();
  var rows = [d.headers].concat(d.rows);
  sh.getRange(1, 1, rows.length, d.headers.length).setValues(rows);
  sh.setFrozenRows(1);
  return ContentService.createTextOutput(JSON.stringify({ok: true, rows: d.rows.length}))
    .setMimeType(ContentService.MimeType.JSON);
}`;
let pane = 'look';

export function openSettings(p) {
  if (p) pane = p;
  render();
  const d = $('#dlg-settings');
  if (!d.open) d.showModal();
}
function render() {
  const n = S.profile.notify || {}, sh = S.profile.sheets || {};
  const theme = (() => { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } })();
  const icsHttp = `${location.origin}/api/calendar.ics`, icsWebcal = `webcal://${location.host}/api/calendar.ics`;
  $('#settings').innerHTML = `<nav class="settings-nav">${PANES.map(([k, l]) => `<button type="button" data-pane="${k}" aria-selected="${pane === k}">${l}</button>`).join('')}</nav>
  <div class="settings-pane ${pane === 'look' ? 'on' : ''}" data-pane-body="look">
    <h3>外觀</h3>
    <div class="row"><span class="small sub">配色</span><div class="seg" id="theme-seg">${[['auto', '跟著系統'], ['light', '淺色'], ['dark', '深色']].map(([v, l]) => `<button type="button" data-theme="${v}" aria-pressed="${theme === v}">${l}</button>`).join('')}</div></div>
    <label class="check"><input type="checkbox" id="opt-exams" ${S.profile.hideExams ? '' : 'checked'}>在本週和行事曆顯示學測、分科測驗的日期</label>
    <p>畫面是照 MacBook 13 吋（1440×900）設計的，不需要捲動頁面。手機打開會改成單欄。</p>
    <h3 style="margin-top:8px">快速鍵</h3>
    <p><kbd>1</kbd>–<kbd>5</kbd> 切換畫面　<kbd>N</kbd> 新增學校　<kbd>/</kbd> 搜尋科系　<kbd>Esc</kbd> 關閉視窗</p>
  </div>
  <div class="settings-pane ${pane === 'cond' ? 'on' : ''}" data-pane-body="cond">
    <h3>我的條件</h3>
    <p>勾選你有的經歷或身分，「找科系」會列出簡章報名資格有提到的系，並標出符合哪幾項。比對的是簡章文字，只是起點。</p>
    <div class="cond-groups" id="cond-groups">${CONDITIONS.map(g => `<section class="cond-group"><h4>${esc(g.group)}</h4><div class="cond-list">${g.items.map(c => `<label class="check"><input type="checkbox" value="${c.id}" ${(S.profile.tags || []).includes(c.id) ? 'checked' : ''}>${esc(c.label)}</label>`).join('')}</div></section>`).join('')}</div>
    <div class="row"><button class="btn fill sm" type="button" id="cond-save">儲存</button><button class="btn sm ghost" type="button" id="cond-clear">全部取消</button><span class="status" id="cond-status"></span></div>
  </div>
  <div class="settings-pane ${pane === 'notify' ? 'on' : ''}" data-pane-body="notify">
    <h3>每日提醒</h3>
    <p>伺服器每天在設定的時間，把接下來幾天的日期和待辦送到 Discord 或 Telegram。電腦睡著就不會送；醒來後當天補送。</p>
    <div class="field"><label for="n-discord">Discord webhook 網址</label><input type="url" id="n-discord" value="${esc(n.discord || '')}" placeholder="https://discord.com/api/webhooks/…" autocomplete="off"></div>
    <p>Discord：伺服器 → 頻道設定 → 整合 → Webhook → 新 Webhook → 複製網址。</p>
    <div class="two"><div class="field"><label for="n-tgtoken">Telegram bot token</label><input type="text" id="n-tgtoken" value="${esc(n.tgToken || '')}" placeholder="123456:ABC…" autocomplete="off"></div><div class="field"><label for="n-tgchat">Telegram chat id</label><input type="text" id="n-tgchat" value="${esc(n.tgChat || '')}" placeholder="例如 123456789" autocomplete="off"></div></div>
    <p>Telegram：跟 @BotFather 說 /newbot 拿 token，對你的 bot 說一句話，再開 <code>https://api.telegram.org/bot&lt;token&gt;/getUpdates</code> 找 chat id。</p>
    <div class="row"><label class="small sub">時間 <input type="time" id="n-time" value="${esc(n.time || '08:00')}" style="width:110px"></label><label class="small sub">看幾天 <select id="n-days" style="height:32px">${[3, 7, 14].map(v => `<option value="${v}" ${Number(n.days || 7) === v ? 'selected' : ''}>${v} 天</option>`).join('')}</select></label><label class="check small"><input type="checkbox" id="n-empty" ${n.skipEmpty === false ? '' : 'checked'}>沒事就不送</label></div>
    <div class="row"><button class="btn fill sm" type="button" id="n-save">儲存</button><button class="btn sm" type="button" id="n-test">現在送一則試試</button><button class="btn sm ghost" type="button" id="n-preview">預覽內容</button><span class="status" id="n-status"></span></div>
    <pre id="n-pre" hidden></pre>
  </div>
  <div class="settings-pane ${pane === 'sheets' ? 'on' : ''}" data-pane-body="sheets">
    <h3>同步到 Google 試算表</h3>
    <p>每次紀錄有變動，伺服器就把所有學校的總表（學校、系組、狀態、各個截止、備審進度…）寫進你自己的 Google 試算表。不用申請任何 API，只要在試算表貼一段程式。</p>
    <ol class="steps">
      <li><b>1</b><span>開一份新的 Google 試算表 → 上方「擴充功能」→「Apps Script」。</span></li>
      <li><b>2</b><span>把編輯器裡的內容全部換成下面這段，存檔。<button class="link" type="button" id="gs-copy">複製程式</button></span></li>
      <li><b>3</b><span>右上「部署」→「新增部署作業」→ 類型選「網頁應用程式」，執行身分「我」，存取權「所有人」→ 部署（第一次要授權，選「進階」→「前往」）。</span></li>
      <li><b>4</b><span>複製結尾是 <code>/exec</code> 的網址，貼到下面，按「立即同步」。</span></li>
    </ol>
    <pre>${esc(APPS_SCRIPT)}</pre>
    <div class="field"><label for="gs-url">Apps Script 網址</label><input type="url" id="gs-url" value="${esc(sh.url || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></div>
    <div class="row"><label class="small sub">工作表名稱 <input type="text" id="gs-sheet" value="${esc(sh.sheet || '特選紀錄')}" style="width:140px"></label><label class="check small"><input type="checkbox" id="gs-auto" ${sh.auto ? 'checked' : ''}>紀錄變動就自動同步</label></div>
    <div class="row"><button class="btn fill sm" type="button" id="gs-save">儲存</button><button class="btn sm" type="button" id="gs-sync">立即同步</button><span class="status ${sh.lastError ? 'err' : sh.lastSync ? 'ok' : ''}" id="gs-status">${sh.lastError ? '上次失敗：' + esc(sh.lastError) : sh.lastSync ? '上次同步 ' + esc(new Date(sh.lastSync).toLocaleString('zh-TW')) : ''}</span></div>
    <p>只會從這裡寫到試算表，不會把試算表的修改讀回來。網址就是密碼，不要公開。</p>
  </div>
  <div class="settings-pane ${pane === 'export' ? 'on' : ''}" data-pane-body="export">
    <h3>貼到試算表、匯出</h3>
    <div class="row"><button class="btn sm" type="button" id="x-tsv">複製總表（貼到 Google 試算表會自動分格）</button><a class="btn sm" href="/api/table.csv" download>下載 CSV</a><a class="btn sm" href="/api/export.md" download>下載 Markdown（Notion、HackMD）</a></div>
    <h3 style="margin-top:6px">行事曆</h3>
    <p><b>iPhone / Mac：訂閱</b>（會自動更新，截止前一天和三小時前提醒）。iPhone：設定 → App → 行事曆 → 帳號 → 加入帳號 → 其他 → 加入已訂閱的行事曆，貼這個網址。Mac：行事曆 → 檔案 → 新增行事曆訂閱，位置選「我的 Mac」。只有在家裡的 Wi-Fi 才能更新。</p>
    <div class="row"><code class="ics-url" id="ics-url">${esc(icsWebcal)}</code><button class="btn sm" type="button" id="ics-copy">複製網址</button></div>
    <p><b>Google 日曆：匯入檔案</b>（Google 的伺服器連不到家裡的電腦，所以用下載再匯入）。在電腦開 Google 日曆 → 設定 → 匯入及匯出 → 選檔案 → 匯入。建議先建一個「特選」日曆再匯入，日期變了就把那個日曆清掉重新匯入。</p>
    <div class="row"><a class="btn sm" href="${esc(icsHttp)}" download="special-study.ics">下載 .ics</a><button class="btn sm" type="button" id="x-gcsv">下載 Google 日曆 CSV</button></div>
    <h3 style="margin-top:6px">備份</h3>
    <div class="row"><a class="btn sm" href="/api/export" download>下載備份（JSON）</a><button class="btn sm" type="button" id="x-import">從備份還原</button><span class="small sub">紀錄都在伺服器的 data/records.json</span></div>
  </div>
  <div class="settings-pane ${pane === 'guide' ? 'on' : ''}" data-pane-body="guide">
    <h3>特選須知</h3>
    <div class="guide-cols">
      <div>
        <h4>特殊選才是什麼</h4><p>各大學依教育部「大學辦理特殊選才招生計畫」自己辦理的招生管道，給有特殊才能、經歷、成就或不同教育資歷（實驗教育、境外臺生、新住民子女、經濟弱勢…）的學生。不採計學測與分科測驗。</p>
        <h4>${P.year || ''} 學年度</h4><p>${P.schools.length} 校、${P.programs.length} 個系組。報名多在 9 月底到 12 月初，面試多在 11、12 月，放榜多在 11 月底到隔年 1 月。每間學校、每個系都不一樣。</p>
        <h4 class="danger">錄取但不去讀，一定要辦放棄</h4><p>沒在學校規定期限內放棄入學資格的人，不能參加當學年度的繁星推薦、個人申請、分發入學。期限多在隔年 2 月底到 3 月初，各校不同。</p>
      </div>
      <div>
        <h4>一個系的流程</h4>
        <ol><li>讀簡章、確認報名資格與同校可報幾系</li><li>網路報名、繳費（有的學校繳費截止比上傳早；ATM 轉帳要等入帳）</li><li>上傳備審、按「確認」；推薦函多為暗推，要提早請老師</li><li>一階書審、名單公布（面試時段常在系網公告，不另行通知）</li><li>面試、筆試或實作；准考證多半自己列印</li><li>放榜：正取、備取、未錄取；成績複查窗口很短</li><li>聲明就讀或放棄；備取要登記遞補意願</li></ol>
        <h4>資料來源</h4><p>系組資料與簡章：<a href="https://sta-tw.org/bochures/" target="_blank" rel="noopener">特殊選才網</a>（${esc((P.fetched || '').replace(/-/g, '/'))} 擷取）。報名資格、繳交資料、面試注意事項是用程式從簡章節錄的，報名前請對照簡章。</p>
      </div>
    </div>
  </div>`;
}
function setTheme(v) {
  try { if (v === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', v); } catch { /* ignore */ }
  if (v === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
}
function googleCsv() {
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const us = k => { const [y, m, d] = k.split('-'); return `${m}/${d}/${y}`; };
  const pad = n => String(n).padStart(2, '0');
  const t12 = t => { let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${pad(h)}:${pad(m)} ${ap}`; };
  const rows = [['Subject', 'Start Date', 'Start Time', 'End Date', 'End Time', 'All Day Event', 'Description', 'Location']];
  for (const ev of allEvents({live: true})) {
    if (ev.derived) continue;
    const timed = /^\d{2}:\d{2}$/.test(ev.time || '');
    const endT = timed ? `${pad(Math.min(+ev.time.slice(0, 2) + 1, 23))}:${ev.time.slice(3)}` : '';
    rows.push([`${appName(ev.app)}｜${KINDS[ev.kind].label}`, us(ev.date), timed ? t12(ev.time) : '', us(ev.last), timed ? t12(endT) : '', timed ? 'False' : 'True', ev.note || '', ev.app.place || '']);
  }
  download(`特選行事曆-${todayKey()}.csv`, '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
export function wireSettings() {
  const d = $('#dlg-settings');
  d.addEventListener('click', async e => {
    const pb = e.target.closest('[data-pane]'); if (pb) { pane = pb.dataset.pane; render(); return; }
    const th = e.target.closest('[data-theme]'); if (th) { setTheme(th.dataset.theme); $$('#theme-seg button').forEach(b => b.setAttribute('aria-pressed', String(b === th))); return; }
    if (e.target.closest('#cond-clear')) { $$('#cond-groups input').forEach(i => { i.checked = false; }); return; }
    if (e.target.closest('#cond-save')) { const tags = $$('#cond-groups input:checked').map(i => i.value); await saveProfile({tags}); $('#cond-status').textContent = `已儲存 ${tags.length} 項`; document.dispatchEvent(new CustomEvent('profile-changed')); return; }
    if (e.target.closest('#n-save')) {
      const notify = {...(S.profile.notify || {}), discord: $('#n-discord').value.trim(), tgToken: $('#n-tgtoken').value.trim(), tgChat: $('#n-tgchat').value.trim(), time: $('#n-time').value || '08:00', days: Number($('#n-days').value) || 7, skipEmpty: $('#n-empty').checked};
      await saveProfile({notify}); $('#n-status').className = 'status ok'; $('#n-status').textContent = '已儲存'; return;
    }
    if (e.target.closest('#n-test')) {
      const st = $('#n-status'); st.className = 'status'; st.textContent = '送出中…';
      try { const r = await request('POST', '/api/notify/test'); st.className = 'status ok'; st.textContent = `已送到 ${r.sent.join('、')}${r.errors.length ? '；' + r.errors.join('；') : ''}`; }
      catch (err) { st.className = 'status err'; st.textContent = err.message; }
      return;
    }
    if (e.target.closest('#n-preview')) { const pre = $('#n-pre'); try { const r = await request('GET', `/api/digest?days=${$('#n-days').value}`); pre.textContent = r.text; pre.hidden = false; } catch (err) { toast(err.message); } return; }
    if (e.target.closest('#gs-copy')) { copyText(APPS_SCRIPT, '已複製程式，到 Apps Script 貼上'); return; }
    if (e.target.closest('#gs-save')) { await saveProfile({sheets: {...(S.profile.sheets || {}), url: $('#gs-url').value.trim(), sheet: $('#gs-sheet').value.trim() || '特選紀錄', auto: $('#gs-auto').checked}}); $('#gs-status').className = 'status ok'; $('#gs-status').textContent = '已儲存'; return; }
    if (e.target.closest('#gs-sync')) {
      const st = $('#gs-status'); st.className = 'status'; st.textContent = '同步中…';
      await saveProfile({sheets: {...(S.profile.sheets || {}), url: $('#gs-url').value.trim(), sheet: $('#gs-sheet').value.trim() || '特選紀錄', auto: $('#gs-auto').checked}});
      try { const r = await request('POST', '/api/sheets/sync'); st.className = 'status ok'; st.textContent = `已同步 ${r.rows} 列`; await loadRecords(); }
      catch (err) { st.className = 'status err'; st.textContent = err.message; }
      return;
    }
    if (e.target.closest('#x-tsv')) { try { const t = await request('GET', '/api/table'); const tsv = [t.headers, ...t.rows].map(r => r.map(c => String(c ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n'); copyText(tsv, '已複製，到 Google 試算表按 ⌘V'); } catch (err) { toast(err.message); } return; }
    if (e.target.closest('#ics-copy')) { copyText($('#ics-url').textContent, '已複製，到行事曆 App 貼上就能訂閱'); return; }
    if (e.target.closest('#x-gcsv')) { googleCsv(); return; }
    if (e.target.closest('#x-import')) { $('#import-file').click(); return; }
  });
  d.addEventListener('change', async e => { if (e.target.id === 'opt-exams') { await saveProfile({hideExams: !e.target.checked}); document.dispatchEvent(new CustomEvent('profile-changed')); } });
  $('#import-file').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch { toast('這不是有效的備份檔'); return; }
    try { const r = await request('POST', '/api/import', data); await loadRecords(); toast(`已還原 ${r.imported} 間學校`); } catch (err) { toast('還原失敗：' + err.message); }
  });
  document.addEventListener('click', e => { const b = e.target.closest('[data-settings]'); if (b) openSettings(b.dataset.settings); });
}
