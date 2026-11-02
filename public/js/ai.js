// 問 AI：右邊的面板（頂欄「問 AI」或按 A）。問題送到 /api/ai/ask，回答一邊產生一邊畫。
// 在學校頁打開就帶著那一間（「關於 中興 資工」，可以拿掉）。對話存在伺服器（data/ai.json），「紀錄」可以打開、刪除。
// 設定 › 問 AI 那一頁也在這裡（settingsPane），settings.js 只負責把它放進去。
import {$, $$, esc, now, request, toast, appById, shortName} from './core.js';
import {route} from './router.js';
import {hue} from './ui.js';
import {renderMd} from './md.js';

let panel = null;
let chat = null;          // {id, title, appId, turns:[{q, a, tools, status, error}]}；null = 新對話
let ctxId = '';           // 這次要帶的學校（app id）
let mode = 'chat';        // 'chat' | 'list'
let list = [];
let live = null;          // 正在回答：{ac, turn}
let status = null;        // /api/ai/status
let stick = true;         // 捲到底的時候，新的字出來就跟著捲
const MODEL_LABEL = {'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5', 'claude-fable-5-1': 'Fable 5.1'};
const EFFORT_LABEL = {low: '低', medium: '中', high: '高', xhigh: '更高', max: '最高'};
const inField = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const isOpen = () => !!panel && !panel.hidden;

/* ---------- 面板 ---------- */
const ctxApp = () => appById(ctxId);
function turnHtml(t, i) {
  const running = live && live.turn === t;
  const st = running ? (t.a ? '' : t.tools.length ? '查資料中…' : '想一下…') : t.status === 'stopped' ? '已停止' : t.status === 'error' ? (t.error || '出錯了') : '';
  return `<div class="ai-turn" data-turn="${i}">
    <p class="ai-q">${esc(t.q)}</p>
    ${t.tools && t.tools.length ? `<p class="ai-tools">${esc(t.tools.join('・'))}</p>` : ''}
    ${t.a ? `<div class="ai-a">${renderMd(t.a)}</div>` : ''}
    ${st ? `<p class="ai-st${t.status === 'error' && !running ? ' form-err' : ''}">${esc(st)}</p>` : ''}
  </div>`;
}
function listHtml() {
  if (!list.length) return '<p class="empty ai-empty">沒有對話紀錄。</p>';
  const when = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('zh-TW', {timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}); };
  return `<div class="ai-list rows-hair">${list.map(c => `<div class="ai-li"><button class="ai-li-t" type="button" data-ai-open="${esc(c.id)}">${esc(c.title || '（沒有標題）')}</button><span class="ai-li-d">${esc(when(c.updatedAt))}</span><button class="rm" type="button" data-ai-del="${esc(c.id)}" aria-label="刪除這段對話">✕</button></div>`).join('')}</div>`;
}
function setupLine() {
  if (!status || status.active) return '';
  return `<p class="ai-setup">還沒設定 AI　<button class="link" type="button" data-ai-setup>到設定</button></p>`;
}
function render({keepInput = true} = {}) {
  if (!panel) return;
  const log = $('.ai-log', panel);
  const atBottom = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const app = ctxApp();
  $('.ai-h-list', panel).textContent = mode === 'list' ? '回到對話' : '紀錄';
  $('.ai-ctx', panel).innerHTML = mode === 'chat' && app ? `<span>關於 <span class="sch" style="${hue(app)}">${esc(shortName(app))}</span></span><button class="rm" type="button" data-ai-noctx aria-label="不限這間">✕</button>` : '';
  $('.ai-ctx', panel).hidden = !(mode === 'chat' && app);
  log.innerHTML = mode === 'list' ? listHtml() : (setupLine() + (chat && chat.turns.length ? chat.turns.map(turnHtml).join('') : ''));
  const f = $('.ai-f', panel);
  f.hidden = mode === 'list';
  const btn = $('.ai-send', panel);
  btn.textContent = live ? '停止' : '送出';
  btn.classList.toggle('primary', !live);
  btn.type = live ? 'button' : 'submit';
  if (!keepInput) $('textarea', panel).value = '';
  if (mode === 'chat' && (atBottom || stick)) log.scrollTop = log.scrollHeight;
}
// 串流中只重畫正在寫的那一回合（不要整個面板重畫，選取的字、捲動位置才不會跳）
let raf = 0;
function renderLive() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    if (!panel || !live || !chat) return;
    const i = chat.turns.indexOf(live.turn);
    const el = $(`.ai-turn[data-turn="${i}"]`, panel);
    if (!el) { render(); return; }
    const log = $('.ai-log', panel);
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    el.outerHTML = turnHtml(live.turn, i);
    if (atBottom) log.scrollTop = log.scrollHeight;
  });
}
function build() {
  panel = document.createElement('aside');
  panel.className = 'ai';
  panel.id = 'ai';
  panel.hidden = true;
  panel.setAttribute('aria-label', '問 AI');
  panel.innerHTML = `<div class="ai-h"><h2>問 AI</h2>
      <button class="link" type="button" data-ai-new>新對話</button><button class="link ai-h-list" type="button" data-ai-list>紀錄</button>
      <button class="icon-btn" type="button" data-ai-close aria-label="關閉">✕</button></div>
    <div class="ai-ctx" hidden></div>
    <div class="ai-log scroll" aria-live="polite"></div>
    <form class="ai-f" autocomplete="off"><textarea rows="1" name="q" maxlength="4000" placeholder="問一個問題" aria-label="問題"></textarea><button class="btn primary sm ai-send" type="submit">送出</button></form>`;
  document.body.append(panel);
  panel.addEventListener('click', onClick);
  panel.addEventListener('submit', e => { e.preventDefault(); send(); });
  const ta = $('textarea', panel);
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); if (!live) send(); }
  });
  $('.ai-log', panel).addEventListener('scroll', e => { const l = e.currentTarget; stick = l.scrollHeight - l.scrollTop - l.clientHeight < 40; });
}
function grow() { const ta = $('textarea', panel); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 168) + 'px'; }

async function loadStatus() {
  try { status = await request('GET', '/api/ai/status'); } catch { status = status || null; }
  if (isOpen()) render();
  const pane = $('[data-pane-body="ai"]');
  if (pane) pane.innerHTML = settingsPane();
}
export function open({fresh = false} = {}) {
  if (!panel) build();
  // 從學校頁打開：新對話就帶著那一間
  const here = route.view === 'schools' && route.id && appById(route.id) ? route.id : '';
  if (!chat || fresh) { chat = null; ctxId = here; mode = 'chat'; }
  panel.hidden = false;
  document.body.classList.add('ai-on');
  const b = $('#btn-ai'); if (b) b.setAttribute('aria-expanded', 'true');
  render();
  loadStatus();
  $('textarea', panel).focus({preventScroll: true});
}
export function close() {
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  document.body.classList.remove('ai-on');
  const b = $('#btn-ai'); if (b) { b.setAttribute('aria-expanded', 'false'); b.focus({preventScroll: true}); }
}
const toggle = () => isOpen() ? close() : open();

async function showList() {
  mode = 'list';
  render();
  try { list = await request('GET', '/api/ai/chats'); } catch (e) { list = []; toast(e.message); }
  if (mode === 'list') render();
}
async function openChat(id) {
  try { chat = await request('GET', `/api/ai/chats/${encodeURIComponent(id)}`); } catch (e) { toast(e.message); return; }
  ctxId = chat.appId && appById(chat.appId) ? chat.appId : '';
  mode = 'chat'; stick = true;
  render({keepInput: false});
  $('textarea', panel).focus({preventScroll: true});
}
// 刪除：先從清單拿掉，8 秒內可以復原，之後才真的刪
function delChat(id) {
  const i = list.findIndex(c => c.id === id);
  if (i < 0) return;
  const gone = list.splice(i, 1)[0];
  if (chat && chat.id === id) chat = null;
  render();
  let undone = false;
  const t = setTimeout(() => { if (!undone) request('DELETE', `/api/ai/chats/${encodeURIComponent(id)}`).catch(e => toast(`沒有刪掉：${e.message}`)); }, 8000);
  toast('已刪除對話', {undo: () => { undone = true; clearTimeout(t); list.splice(Math.min(i, list.length), 0, gone); render(); }});
}
function onClick(e) {
  const t = e.target;
  if (t.closest('[data-ai-close]')) { close(); return; }
  if (t.closest('[data-ai-new]')) { if (live) return; chat = null; ctxId = route.view === 'schools' && appById(route.id) ? route.id : ''; mode = 'chat'; render({keepInput: false}); $('textarea', panel).focus(); return; }
  if (t.closest('[data-ai-list]')) { if (mode === 'list') { mode = 'chat'; render(); } else showList(); return; }
  if (t.closest('[data-ai-noctx]')) { ctxId = ''; render(); $('textarea', panel).focus(); return; }
  if (t.closest('[data-ai-setup]')) { import('./settings.js').then(m => m.open('ai')); return; }
  const o = t.closest('[data-ai-open]'); if (o) { openChat(o.dataset.aiOpen); return; }
  const d = t.closest('[data-ai-del]'); if (d) { delChat(d.dataset.aiDel); return; }
  if (t.closest('.ai-send') && live) { stop(); return; }
  // 回答裡的站內連結（#schools/…）由 app.js 接手；PDF 另開分頁
}
function stop() {
  if (!live) return;
  live.ac.abort();
  request('POST', '/api/ai/stop').catch(() => {});
}

async function send() {
  const ta = $('textarea', panel);
  const q = ta.value.trim();
  if (!q || live) return;
  if (status && !status.active) { render(); return; }
  if (!chat) chat = {id: '', title: q.slice(0, 40), appId: ctxId, turns: []};
  const turn = {q, a: '', tools: [], status: 'running', error: ''};
  chat.turns.push(turn);
  const ac = new AbortController();
  live = {ac, turn};
  stick = true;
  ta.value = ''; grow();
  render();
  let res;
  try {
    res = await fetch('/api/ai/ask', {method: 'POST', signal: ac.signal, headers: {'Content-Type': 'application/json', 'X-Client': '3'}, body: JSON.stringify({question: q, chatId: chat.id || '', appId: ctxId, now: now()})});
  } catch {
    finish(turn, ac.signal.aborted ? {status: 'stopped'} : {status: 'error', error: '連不到伺服器'});
    return;
  }
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* not json */ }
    finish(turn, {status: 'error', error: msg});
    return;
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', ended = false;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream: true});
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (/^event: (.*)$/m.exec(raw) || [])[1];
        const data = (/^data: (.*)$/m.exec(raw) || [])[1];
        if (!ev || !data) continue;
        let d; try { d = JSON.parse(data); } catch { continue; }
        if (ev === 'start') { if (!chat.id) { chat.id = d.chatId; chat.title = d.title; } }
        else if (ev === 'tool') { turn.tools.push(d.label); renderLive(); }
        else if (ev === 'text') { turn.a += d.t; renderLive(); }
        else if (ev === 'error') { turn.error = d.message; if (d.setup) { status = {...(status || {}), active: ''}; } }
        else if (ev === 'done') { Object.assign(turn, d.turn); ended = true; }
      }
    }
  } catch { /* 停止或斷線 */ }
  if (ended) finish(turn, {});
  else finish(turn, ac.signal.aborted ? {status: 'stopped'} : {status: turn.error ? 'error' : 'stopped', error: turn.error});
}
function finish(turn, patch) {
  Object.assign(turn, patch);
  if (turn.status === 'running') turn.status = turn.error ? 'error' : 'done';
  live = null;
  render();
}

/* ---------- 設定 › 問 AI ---------- */
const row = (k, v) => `<div class="set-row"><span class="set-k">${k}</span><div class="set-v">${v}</div></div>`;
export function settingsPane() {
  if (!status) { loadStatus(); return '<h3 class="set-h">問 AI</h3><p class="muted">讀取中…</p>'; }
  const s = status.settings || {}, cli = status.cli || {}, key = status.key || {};
  const opt = (v, l) => `<label class="check"><input type="radio" name="ai-backend" value="${v}"${s.backend === v ? ' checked' : ''}><span>${l}</span></label>`;
  const cliText = !cli.found ? '找不到 claude 指令' : cli.loggedIn ? '已登入' : '沒有登入：在這台電腦的終端機跑 claude 登入';
  const keyText = key.source === 'env' ? `用環境變數 ANTHROPIC_API_KEY（${esc(key.hint)}）` : key.set ? `已設定（${esc(key.hint)}），存在這台電腦的 data/secrets.json` : '';
  const using = status.active === 'cli' ? '這台電腦的 Claude Code' : status.active === 'api' ? 'API Key' : '沒有可以用的';
  return `<h3 class="set-h">問 AI</h3>
    ${row('用哪個', `<div class="set-inline" role="radiogroup" aria-label="用哪個">${opt('auto', '自動')}${opt('cli', '這台電腦的 Claude Code')}${opt('api', 'API Key')}${opt('off', '關閉')}</div><span class="set-path">現在：${using}</span>`)}
    ${row('Claude Code', `<span class="${cli.loggedIn ? '' : 'muted'}">${cliText}</span><button class="btn sm quiet" type="button" data-ai-recheck>重新檢查</button>`)}
    ${row('<label for="ai-key">API Key</label>', `<form class="set-inline ai-keyf" data-ai-key novalidate autocomplete="off"><input type="password" id="ai-key" name="key" placeholder="sk-ant-…" autocomplete="off" spellcheck="false"${key.source === 'env' ? ' disabled' : ''}><button class="btn sm" type="submit"${key.source === 'env' ? ' disabled' : ''}>儲存</button>${key.source === 'file' ? '<button class="btn sm quiet danger" type="button" data-ai-key-del>刪除</button>' : ''}</form>${keyText ? `<span class="set-path">${keyText}</span>` : ''}`)}
    ${row('<label for="ai-model">模型</label>', `<div class="set-inline"><select id="ai-model" data-ai-set="model">${(status.models || []).map(m => `<option value="${esc(m)}"${s.model === m ? ' selected' : ''}>${esc(MODEL_LABEL[m] || m)}</option>`).join('')}</select><label class="set-inline"><span class="set-k">思考</span><select data-ai-set="effort" aria-label="思考">${(status.efforts || []).map(v => `<option value="${esc(v)}"${s.effort === v ? ' selected' : ''}>${esc(EFFORT_LABEL[v] || v)}</option>`).join('')}</select></label></div>`)}
    ${row('對話紀錄', `<span>${status.chats ? `${status.chats} 段` : '沒有'}</span>${status.chats ? '<button class="btn sm quiet danger" type="button" data-ai-clear>全部刪除</button>' : ''}`)}
    <span class="set-status" data-status="ai" role="status"></span>`;
}
const sayAi = (text, err = false) => { const el = $('[data-status="ai"]'); if (el) { el.textContent = text; el.className = 'set-status' + (err ? ' form-err' : ''); } };
async function saveSettings(patch) {
  try { const r = await request('PUT', '/api/ai/settings', patch); status = {...status, settings: r.settings, active: r.active}; sayAi('已儲存'); }
  catch (e) { sayAi(e.message, true); }
  const pane = $('[data-pane-body="ai"]');
  if (pane) { const msg = $('[data-status="ai"]', pane); const keep = msg ? [msg.textContent, msg.className] : null; pane.innerHTML = settingsPane(); if (keep) { const m2 = $('[data-status="ai"]', pane); m2.textContent = keep[0]; m2.className = keep[1]; } }
}
function wireSettings() {
  const d = $('#dlg-settings');
  if (!d) return;
  d.addEventListener('change', e => {
    const t = e.target;
    if (t.name === 'ai-backend') saveSettings({backend: t.value});
    else if (t.dataset && t.dataset.aiSet) saveSettings({[t.dataset.aiSet]: t.value});
  });
  d.addEventListener('submit', async e => {
    const f = e.target.closest('[data-ai-key]');
    if (!f) return;
    e.preventDefault();
    const key = f.elements.key.value.trim();
    if (!/^sk-ant-/.test(key)) { sayAi('API Key 的格式是 sk-ant-…', true); return; }
    sayAi('儲存中…');
    try { const r = await request('PUT', '/api/ai/key', {key}); status = {...status, key: r.key, active: r.active}; f.elements.key.value = ''; await saveSettings({}); sayAi('已儲存'); }
    catch (err) { sayAi(err.message, true); }
  });
  d.addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('[data-ai-recheck]')) { sayAi('檢查中…'); try { status = await request('GET', '/api/ai/status?fresh=1'); } catch (err) { sayAi(err.message, true); return; } const pane = $('[data-pane-body="ai"]'); if (pane) pane.innerHTML = settingsPane(); return; }
    if (t.closest('[data-ai-key-del]')) { try { const r = await request('DELETE', '/api/ai/key'); status = {...status, key: r.key, active: r.active}; await saveSettings({}); sayAi('已刪除 API Key'); } catch (err) { sayAi(err.message, true); } return; }
    const clr = t.closest('[data-ai-clear]');
    if (clr) {
      // 全部刪除沒辦法復原：按第一次先換成「再按一次」，4 秒內再按才刪
      if (!clr.dataset.armed) { clr.dataset.armed = '1'; clr.textContent = '再按一次就全部刪除'; setTimeout(() => { if (clr.isConnected) { delete clr.dataset.armed; clr.textContent = '全部刪除'; } }, 4000); return; }
      try { await request('DELETE', '/api/ai/chats'); status = {...status, chats: 0}; chat = null; list = []; if (isOpen()) render(); await saveSettings({}); sayAi('已刪除全部對話'); } catch (err) { sayAi(err.message, true); }
    }
  });
}

export function init() {
  const b = $('#btn-ai');
  if (b) b.addEventListener('click', toggle);
  wireSettings();
  // A：打開／關上（和其他快速鍵一樣：輸入框裡、對話框開著、「改」表單開著時不作用）
  document.addEventListener('keydown', e => {
    // Esc：app.js 先關小選單、取消「改」（那時 defaultPrevented）；對話框開著時由對話框自己關。都沒有才關面板。
    if (e.key === 'Escape') { if (isOpen() && !e.defaultPrevented && !document.querySelector('dialog[open]')) { e.preventDefault(); close(); } return; }
    if (e.key !== 'a' && e.key !== 'A') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229 || inField(document.activeElement) || document.querySelector('dialog[open]') || document.body.dataset.editing) return;
    e.preventDefault();
    toggle();
  });
}
