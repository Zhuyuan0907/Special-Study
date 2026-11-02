// 設定（#dlg-settings）：左邊七項，右邊一次一頁。
// 行事曆訂閱・每日提醒・Google 試算表・我的條件・備份與匯出・問 AI（ai.js 畫、ai.js 處理）・外觀；底下一行簡章資料的來源與日期。
// 文字欄位按「儲存」才存；勾選、配色一改就存。結果寫在按鈕旁邊（錯誤用 .form-err），不用提示。
import {S, P, $, $$, esc, request, toast, copyText, saveProfile, refresh, setTheme, theme, CONDITIONS, COND_BY_ID} from './core.js';
import {openDialog, timeInput, normTime, md} from './ui.js';
import {settingsPane as aiPane} from './ai.js';

const PANES = [['ics', '行事曆訂閱'], ['notify', '每日提醒'], ['sheets', 'Google 試算表'], ['cond', '我的條件'], ['export', '備份與匯出'], ['ai', '問 AI'], ['look', '外觀']];
// 第二張工作表「花費」在 d.extra；舊版的程式不認得 extra，照樣只寫總表
const APPS_SCRIPT = `function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [{sheet: d.sheet, headers: d.headers, rows: d.rows}].concat(d.extra || []).forEach(function (t) {
    var sh = ss.getSheetByName(t.sheet) || ss.insertSheet(t.sheet);
    sh.clearContents();
    var rows = [t.headers].concat(t.rows);
    sh.getRange(1, 1, rows.length, t.headers.length).setValues(rows);
    sh.setFrozenRows(1);
  });
  return ContentService.createTextOutput(JSON.stringify({ok: true, rows: d.rows.length}))
    .setMimeType(ContentService.MimeType.JSON);
}`;
let pane = 'ics';
// 每一頁按鈕旁邊的結果：{text, err}；imp：選好的備份檔，等確認「會取代 N 間學校」
const st = {};
let imp = null, preview = '';
const dlg = () => $('#dlg-settings');
const say = (k, text, err = false) => { st[k] = text ? {text, err} : null; const el = $(`[data-status="${k}"]`); if (el) { el.textContent = text || ''; el.className = 'set-status' + (err ? ' form-err' : ''); } };
const status = k => `<span class="set-status${st[k] && st[k].err ? ' form-err' : ''}" data-status="${k}" role="status">${esc(st[k] ? st[k].text : '')}</span>`;
const row = (k, v, cls = '') => `<div class="set-row${cls ? ' ' + cls : ''}"><span class="set-k">${k}</span><div class="set-v">${v}</div></div>`;
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/i;
const when = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('zh-TW', {timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}); };

/* ---------- 各頁 ---------- */
// 手機要訂閱，網址得是這台電腦在區域網路上的位址；用 localhost 開的網頁就改用 /api/meta 的 lan。
function icsHosts() {
  const m = S.meta || {}, port = m.port || location.port;
  // 伺服器用 HOST=127.0.0.1 開的：只有這台電腦連得到
  if (m.host && LOCAL.test(m.host)) return {hosts: LOCAL.test(location.hostname) ? [location.host] : [], local: true, loopback: true};
  if (!LOCAL.test(location.hostname)) return {hosts: [location.host], local: false};
  const lan = Array.isArray(m.lan) ? m.lan.filter(Boolean) : [];
  return {hosts: lan.map(ip => `${ip}${port ? ':' + port : ''}`), local: true};
}
function paneIcs() {
  const {hosts, local, loopback} = icsHosts();
  const urls = hosts.map(h => `webcal://${h}/api/calendar.ics`);
  const lanIps = hosts.map(h => h.replace(/:\d+$/, '')).join('、');
  const warn = loopback ? '<p class="form-err">伺服器是用 HOST=127.0.0.1 啟動的，只有這台電腦訂閱得到；手機要訂閱請用 HOST=0.0.0.0 重新啟動</p>'
    : !urls.length ? '<p class="form-err">這台電腦沒有區域網路位址，手機訂閱不到</p>'
    : local ? `<p class="set-warn">這個網頁是用 ${esc(location.hostname)} 開的；手機要和這台電腦連同一個 Wi-Fi，才連得到 ${esc(lanIps)}</p>` : '';
  return `<h3 class="set-h">行事曆訂閱</h3>
    ${urls.map((u, i) => row(i ? '' : '訂閱網址', `<code class="set-url">${esc(u)}</code><button class="btn sm" type="button" data-copy="${esc(u)}">複製</button>`)).join('') || row('訂閱網址', '<span class="muted">沒有</span>')}
    ${warn}
    <div class="set-sep"></div>
    ${row('iPhone', '<span class="set-path">設定 › App › 行事曆 › 行事曆帳號 › 加入帳號 › 其他 › 加入已訂閱的行事曆</span>')}
    ${row('Mac', '<span class="set-path">行事曆 › 檔案 › 新增行事曆訂閱</span>')}
    ${row('Google 日曆', `<a class="btn sm" href="/api/calendar.ics" download="special-study.ics">下載 .ics</a><span class="set-path">Google 日曆 › 設定 › 匯入及匯出 › 匯入</span>`)}`;
}
function paneNotify() {
  const n = S.profile.notify || {};
  const days = Number(n.days) || 7;
  return `<h3 class="set-h">每日提醒</h3>
    <form class="set-form" data-form="notify" novalidate autocomplete="off">
      ${row('<label for="n-discord">Discord</label>', `<input type="url" id="n-discord" name="discord" value="${esc(n.discord || '')}" placeholder="https://discord.com/api/webhooks/…"><span class="set-path">頻道設定 › 整合 › Webhook › 新 Webhook › 複製網址</span>`)}
      ${row('<label for="n-tgtoken">Telegram</label>', `<div class="set-two"><input type="text" id="n-tgtoken" name="tgToken" value="${esc(n.tgToken || '')}" placeholder="bot token" aria-label="Telegram bot token"><input type="text" id="n-tgchat" name="tgChat" value="${esc(n.tgChat || '')}" placeholder="chat id" aria-label="Telegram chat id"></div><span class="set-path">@BotFather › /newbot 拿 token；對 bot 說一句話，再開 api.telegram.org/bot&lt;token&gt;/getUpdates 找 chat id</span>`)}
      ${row('<label for="n-time">時間</label>', `<div class="set-inline">${timeInput('time', n.time || '08:00', 'id="n-time"')}<select name="days" aria-label="看幾天">${[3, 7, 14].map(v => `<option value="${v}"${days === v ? ' selected' : ''}>接下來 ${v} 天</option>`).join('')}</select><label class="check"><input type="checkbox" name="skipEmpty"${n.skipEmpty === false ? '' : ' checked'}><span>沒事就不送</span></label></div>`)}
      <div class="set-acts"><button class="btn primary sm" type="submit">儲存</button><button class="btn sm" type="button" data-notify-test>送一則試試</button><button class="btn sm quiet" type="button" data-notify-preview>預覽</button>${status('notify')}</div>
    </form>
    ${preview ? `<pre class="set-pre scroll">${esc(preview)}</pre>` : ''}`;
}
function paneSheets() {
  const sh = S.profile.sheets || {};
  const last = sh.lastError ? {text: '上次失敗：' + sh.lastError, err: true} : sh.lastSync ? {text: '上次同步 ' + when(sh.lastSync)} : null;
  if (!st.sheets && last) st.sheets = last;
  return `<h3 class="set-h">Google 試算表</h3>
    <ol class="set-steps">
      <li>開一份新的 Google 試算表 › 擴充功能 › Apps Script</li>
      <li>把編輯器的內容換成下面這段，存檔 <button class="link" type="button" data-copy-script>複製程式</button></li>
      <li>部署 › 新增部署作業 › 網頁應用程式；執行身分「我」，存取權「所有人」</li>
      <li>把結尾是 /exec 的網址貼在下面</li>
    </ol>
    <pre class="set-pre set-code scroll">${esc(APPS_SCRIPT)}</pre>
    <form class="set-form" data-form="sheets" novalidate autocomplete="off">
      ${row('<label for="gs-url">網址</label>', `<input type="url" id="gs-url" name="url" value="${esc(sh.url || '')}" placeholder="https://script.google.com/macros/s/…/exec">`)}
      ${row('<label for="gs-sheet">工作表</label>', `<div class="set-inline"><input type="text" id="gs-sheet" name="sheet" value="${esc(sh.sheet || '特選紀錄')}"><label class="check"><input type="checkbox" name="auto"${sh.auto ? ' checked' : ''}><span>紀錄有變就自動同步</span></label></div>`)}
      <div class="set-acts"><button class="btn primary sm" type="submit">儲存</button><button class="btn sm" type="button" data-sheets-sync>立即同步</button>${status('sheets')}</div>
    </form>`;
}
function paneCond() {
  const tags = new Set((S.profile.tags || []).filter(id => COND_BY_ID.has(id)));
  return `<h3 class="set-h">我的條件<span class="count">${tags.size ? `${tags.size} 項` : ''}</span>${tags.size ? '<button class="link" type="button" data-cond-clear>全部取消</button>' : ''}</h3>
    <div class="set-cond">${CONDITIONS.map(g => `<section><h4>${esc(g.group)}</h4>${g.items.map(c => `<label class="check"><input type="checkbox" data-cond value="${esc(c.id)}"${tags.has(c.id) ? ' checked' : ''}><span>${esc(c.label)}</span></label>`).join('')}</section>`).join('')}</div>`;
}
function paneExport() {
  let confirm = '';
  if (imp) {
    const add = Math.max(0, imp.apps - imp.replace);
    const what = imp.err ? '' : !imp.apps ? '' : (imp.replace ? `會取代 ${imp.replace} 間學校${add ? `，新增 ${add} 間` : ''}` : `會新增 ${add} 間學校`) + (imp.expenses ? `，花費 ${imp.expenses} 筆` : '');
    confirm = `<div class="set-import">
      <div class="set-import-f">${esc(imp.name)}</div>
      ${imp.err ? `<p class="form-err">${esc(imp.err)}</p>` : !imp.apps ? '<p class="form-err">這個檔案裡沒有學校</p>' : `<p class="set-import-w">${esc(what)}</p>`}
      <div class="set-acts">${!imp.err && imp.apps ? '<button class="btn sm" type="button" data-import-go>匯入</button>' : ''}<button class="btn sm quiet" type="button" data-import-cancel>取消</button></div>
    </div>`;
  }
  return `<h3 class="set-h">備份與匯出</h3>
    ${row('備份', `<a class="btn sm" href="/api/export" download>下載備份（JSON）</a><button class="btn sm" type="button" data-import-pick>從備份匯入…</button><input type="file" id="set-import-file" accept="application/json,.json" hidden>`)}
    ${confirm}
    ${row('總表', `<a class="btn sm" href="/api/table.csv" download>下載 CSV</a><button class="btn sm" type="button" data-copy-table>複製總表</button>`)}
    ${row('花費', '<a class="btn sm" href="/api/expenses.csv" download>下載 CSV</a>')}
    ${status('export')}`;
}
function paneLook() {
  const t = theme() || '';
  const hide = !!S.profile.hideExams;
  return `<h3 class="set-h">外觀</h3>
    ${row('配色', `<div class="set-inline" role="radiogroup" aria-label="配色">${[['', '跟著系統'], ['light', '淺色'], ['dark', '深色']].map(([v, l]) => `<label class="check"><input type="radio" name="theme" value="${v}"${t === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>`)}
    ${row('大考日期', `<label class="check"><input type="checkbox" data-exams${hide ? '' : ' checked'}><span>行事曆顯示學測、分科測驗的日期</span></label>`)}
    ${row('快速鍵', '<span class="set-keys"><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> 切換分頁　<kbd>N</kbd> 加學校　<kbd>Esc</kbd> 關閉</span>')}`;
}
const BODY = {ics: paneIcs, notify: paneNotify, sheets: paneSheets, cond: paneCond, export: paneExport, ai: aiPane, look: paneLook};

function foot() {
  const src = String(P.source || '');
  const name = src.split(/\s+/)[0] || '';
  const url = (/https?:\/\/[^\s（）()]+/.exec(src) || [''])[0];
  const fetched = P.fetched ? `${md(P.fetched)} 擷取` : '';
  if (!name && !fetched) return '';
  return `<div class="modal-foot set-foot"><span>簡章資料：${url ? `<a class="link ext" href="${esc(url)}" target="_blank" rel="noopener">${esc(name || url)}</a>` : esc(name)}${fetched ? `（${esc(fetched)}）` : ''}</span></div>`;
}
export function render() {
  const body = $('#settings-body');
  if (!body) return;
  const top = ($('.set-pane', body) || {}).scrollTop || 0;
  const same = body.dataset.shown === pane;
  $('#set-title').textContent = '設定';
  body.innerHTML = `<div class="set">
    <nav class="set-nav" role="tablist" aria-label="設定">${PANES.map(([k, l]) => `<button type="button" role="tab" data-pane="${k}" aria-selected="${pane === k}">${l}</button>`).join('')}</nav>
    <div class="set-pane scroll" role="tabpanel" data-pane-body="${pane}">${BODY[pane]()}</div>
  </div>${foot()}`;
  body.dataset.shown = pane;
  if (same) $('.set-pane', body).scrollTop = top;
}
export function open(p) {
  if (p && BODY[p]) pane = p;
  render();
  openDialog(dlg());
  const b = $(`.set-nav [data-pane="${pane}"]`);
  if (b) b.focus({preventScroll: true});
}

/* ---------- 動作 ---------- */
async function saveNotify(f) {
  const t = normTime(f.elements.time.value);
  if (t === null || t === '') { say('notify', '時間寫成 08:00', true); f.elements.time.focus(); return false; }
  const discord = f.elements.discord.value.trim();
  if (discord && !/^https:\/\/(\w+\.)?discord(app)?\.com\/api\/webhooks\//.test(discord)) { say('notify', 'Discord 網址要是 https://discord.com/api/webhooks/…', true); f.elements.discord.focus(); return false; }
  const notify = {...(S.profile.notify || {}), discord, tgToken: f.elements.tgToken.value.trim(), tgChat: f.elements.tgChat.value.trim(), time: t, days: Number(f.elements.days.value) || 7, skipEmpty: f.elements.skipEmpty.checked};
  f.elements.time.value = t;
  say('notify', '儲存中…');
  const ok = await saveProfile({notify});
  say('notify', ok ? '已儲存' : '沒有存到', !ok);
  return ok;
}
function sheetsFrom(f) { return {...(S.profile.sheets || {}), url: f.elements.url.value.trim(), sheet: f.elements.sheet.value.trim() || '特選紀錄', auto: f.elements.auto.checked}; }
async function saveSheets(f) {
  const url = f.elements.url.value.trim();
  if (url && !/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(url)) { say('sheets', '網址要是 https://script.google.com/…/exec', true); f.elements.url.focus(); return false; }
  say('sheets', '儲存中…');
  const ok = await saveProfile({sheets: sheetsFrom(f)});
  say('sheets', ok ? '已儲存' : '沒有存到', !ok);
  return ok;
}
async function pickImport(file) {
  imp = null;
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { imp = {name: file.name, err: '這不是備份檔（JSON 讀不懂）', apps: 0, replace: 0}; render(); return; }
  if (Array.isArray(data)) data = {apps: data};
  try {
    const r = await request('POST', '/api/import?dry=1', data);
    imp = {name: file.name, data, apps: Number(r.apps) || 0, replace: Number(r.replace) || 0, expenses: Number(r.expenses) || 0};
  } catch (e) { imp = {name: file.name, err: e.status === 0 ? '連不到伺服器' : e.message, apps: 0, replace: 0}; }
  render();
}
async function doImport() {
  if (!imp || !imp.data) return;
  const btn = $('[data-import-go]');
  if (btn) btn.disabled = true;
  try {
    const r = await request('POST', '/api/import', imp.data);
    imp = null;
    st.export = null;
    await refresh({force: true});
    render();
    toast(`已匯入 ${r.imported} 間學校${r.expenses ? `、${r.expenses} 筆花費` : ''}`);
  } catch (e) {
    imp = {...imp, err: '匯入失敗：' + (e.status === 0 ? '連不到伺服器' : e.message)};
    render();
  }
}
export function init() {
  const d = dlg();
  d.addEventListener('click', async e => {
    const t = e.target;
    const pb = t.closest('.set-nav [data-pane]');
    if (pb) { pane = pb.dataset.pane; render(); const b = $(`.set-nav [data-pane="${pane}"]`); if (b) b.focus({preventScroll: true}); return; }
    const cp = t.closest('[data-copy]');
    if (cp) { copyText(cp.dataset.copy, '已複製，到行事曆 App 貼上'); return; }
    if (t.closest('[data-copy-script]')) { copyText(APPS_SCRIPT, '已複製程式'); return; }
    if (t.closest('[data-notify-test]')) {
      say('notify', '送出中…');
      try { const r = await request('POST', '/api/notify/test'); say('notify', `已送到 ${(r.sent || []).join('、')}${r.errors && r.errors.length ? '；' + r.errors.join('；') : ''}`); }
      catch (err) { say('notify', err.status === 0 ? '連不到伺服器' : (err.data && err.data.errors && err.data.errors.length ? err.data.errors.join('；') : err.message), true); }
      return;
    }
    if (t.closest('[data-notify-preview]')) {
      const f = $('[data-form="notify"]');
      try { const r = await request('GET', `/api/digest?days=${f ? f.elements.days.value : 7}`); preview = r.text || ''; say('notify', ''); }
      catch (err) { preview = ''; say('notify', err.message, true); }
      // 預覽只換下面那塊，表單裡打到一半的字不要被重畫掉
      const old = $('.set-pre:not(.set-code)');
      if (old) old.remove();
      if (preview && f) f.insertAdjacentHTML('afterend', `<pre class="set-pre scroll">${esc(preview)}</pre>`);
      return;
    }
    if (t.closest('[data-sheets-sync]')) {
      const f = $('[data-form="sheets"]');
      if (f && await saveSheets(f) === false) return;
      say('sheets', '同步中…');
      try { const r = await request('POST', '/api/sheets/sync'); say('sheets', `已同步 ${r.rows} 列`); refresh({force: true}); }
      catch (err) { say('sheets', err.status === 0 ? '連不到伺服器' : err.message, true); }
      return;
    }
    if (t.closest('[data-cond-clear]')) { saveProfile({tags: []}); render(); return; }
    if (t.closest('[data-import-pick]')) { const fi = $('#set-import-file'); if (fi) fi.click(); return; }
    if (t.closest('[data-import-cancel]')) { imp = null; render(); return; }
    if (t.closest('[data-import-go]')) { doImport(); return; }
    if (t.closest('[data-copy-table]')) {
      try {
        const tb = await request('GET', '/api/table');
        const tsv = [tb.headers, ...tb.rows].map(r => r.map(c => String(c ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
        say('export', '');
        copyText(tsv, '已複製，到試算表貼上');
      } catch (err) { say('export', err.status === 0 ? '連不到伺服器' : err.message, true); }
    }
  });
  d.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'set-import-file') { const f = t.files && t.files[0]; t.value = ''; pickImport(f); return; }
    if (t.matches('[data-cond]')) {
      const tags = $$('[data-cond]:checked', d).map(i => i.value);
      saveProfile({tags});
      const h = $('.set-h', d);
      if (h) { const tmp = document.createElement('div'); tmp.innerHTML = paneCond(); h.replaceWith(tmp.firstElementChild); }
      return;
    }
    if (t.name === 'theme' && t.type === 'radio') { setTheme(t.value); return; }
    if (t.matches('[data-exams]')) { saveProfile({hideExams: !t.checked}); return; }
  });
  d.addEventListener('submit', async e => {
    const f = e.target.closest('[data-form]');
    if (!f) return;
    e.preventDefault();
    if (f.dataset.form === 'notify') await saveNotify(f);
    else if (f.dataset.form === 'sheets') await saveSheets(f);
  });
  d.addEventListener('close', () => { imp = null; preview = ''; for (const k of Object.keys(st)) st[k] = null; });
}
