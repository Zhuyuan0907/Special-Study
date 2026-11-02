// 問 AI：工具的參數檢查、兩種接法（假的 claude、假的 Anthropic API）、API Key 不外洩、對話存檔、一次只跑一個。
// 不連網路：claude 用 test/fixtures/fake-claude，API 用這裡開的假伺服器（ANTHROPIC_BASE_URL）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {ROOT, PD2} from './helpers.mjs';
import {renderMd} from '../public/js/md.js';

const require = createRequire(import.meta.url);
const {validate, TOOLS} = require('../server-ai.js');
const FAKE = path.join(ROOT, 'test/fixtures/fake-claude');
const W = {'X-Client': '3', 'Content-Type': 'application/json'};
const KEY = 'sk-ant-api03-' + 'x'.repeat(40) + 'WXYZ';

const md = k => `${k.slice(5, 7)}/${k.slice(8, 10)}`;
const DL = new Set(['reg', 'pay', 'upload', 'letter', 'confirm', 'giveup', 'review']);
function v2App(id, programId, extra = {}) {
  const p = PD2.programs.find(x => x.i === programId);
  const dates = p.ev.filter(e => e[0] !== 'other').map(([kind, sd, ed, st, et, name, note], i) => DL.has(kind) && ed
    ? {id: `${id}-d${i}`, kind, date: ed, end: '', time: et || '', note: `${name}（${md(sd)}${st ? ' ' + st : ''} 起）${note ? '・' + note : ''}`}
    : {id: `${id}-d${i}`, kind, date: sd, end: ed || '', time: st || '', note: name + (note ? '・' + note : '')});
  return {id, school: PD2.schools[p.s].name, dept: p.n, programId, status: 'prep', methods: [], fee: 0, quota: 3, url: '', dates, docs: [], notes: '', prep: '', asked: '', choice: '', waitNo: null, confirmDone: false, giveupDone: false, createdAt: 1793092149350, updatedAt: '2026-11-01T17:33:00.000Z', ...extra};
}
const RECORDS = {version: 2, apps: [v2App('xd', '116-006-052'), v2App('yl', '116-022-026', {createdAt: 1793092149351}), v2App('fj', '116-056-015', {createdAt: 1793092149352})], todos: [], profile: {}, notifyLastSent: '', updatedAt: '2026-11-01T17:33:00.000Z'};

function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'special-study-ai-test-'));
  fs.writeFileSync(path.join(dir, 'programs.json'), JSON.stringify(PD2));
  for (const f of ['search-terms.json', 'school-links.json', 'season.json', 'records.example.json']) fs.copyFileSync(path.join(ROOT, 'data', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'records.json'), JSON.stringify(RECORDS));
  // 假的中興簡章：p.10 總則（面試攜帶），p.64 資安組
  const pages = Array.from({length: 70}, (_, i) => `第 ${i + 1} 頁 招生簡章 內容`);
  pages[9] = '四、參加面試考生應先列印「甄試資格審核通知」。面試時請攜帶「甄試資格審核通知」、身分證件正本，依規定時間到場應試。';
  pages[63] = '資訊工程學系資安組 招生名額 3 名 篩選條件 APCS 程式實作 4 級 面試 12 月 4 日';
  fs.mkdirSync(path.join(dir, 'brochures/text'), {recursive: true});
  fs.mkdirSync(path.join(dir, 'brochures/pdf'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'brochures/text/006.json'), JSON.stringify({code: '006', school: '國立中興大學', year: 116, source: 'test', pages}));
  fs.writeFileSync(path.join(dir, 'brochures/pdf/006.pdf'), '%PDF-1.4\n');
  return dir;
}
function start(dir, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {cwd: ROOT, env: {...process.env, ANTHROPIC_API_KEY: '', CLAUDE_BIN: FAKE, DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', ...env}, stdio: ['ignore', 'pipe', 'pipe']});
    let out = '';
    child.stdout.on('data', d => { out += d; const m = /已啟動：http:\/\/localhost:(\d+)/.exec(out); if (m) resolve({child, base: `http://127.0.0.1:${m[1]}`, log: () => out}); });
    child.stderr.on('data', d => { out += d; });
    child.on('exit', code => reject(new Error(`server exited ${code}\n${out}`)));
    setTimeout(() => reject(new Error('server did not start\n' + out)), 10000);
  });
}
const stop = s => new Promise(r => { s.child.removeAllListeners('exit'); s.child.on('exit', r); s.child.kill(); });
const json = async (s, p, opt) => { const r = await fetch(s.base + p, opt); const t = await r.text(); let data = null; try { data = t ? JSON.parse(t) : null; } catch { data = t; } return {status: r.status, data, text: t}; };
// 問一題，收完 SSE：{events, text, status}
async function ask(s, body, {signal, onEvent} = {}) {
  const r = await fetch(s.base + '/api/ai/ask', {method: 'POST', headers: W, body: JSON.stringify({now: '2026-11-04T12:00', ...body}), signal});
  if (!r.ok) return {status: r.status, data: await r.json(), events: [], text: ''};
  const events = [];
  let buf = '', text = '';
  const dec = new TextDecoder();
  try {
    for await (const c of r.body) {
      buf += dec.decode(c, {stream: true});
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (/^event: (.*)$/m.exec(raw) || [])[1], data = (/^data: (.*)$/m.exec(raw) || [])[1];
        if (!ev) continue;
        const d = JSON.parse(data);
        events.push([ev, d]);
        if (ev === 'text') text += d.t;
        if (onEvent) onEvent(ev, d);
      }
    }
  } catch (e) { if (!signal || !signal.aborted) throw e; }
  return {status: r.status, events, text, done: (events.find(e => e[0] === 'done') || [])[1], error: (events.find(e => e[0] === 'error') || [])[1]};
}

test('工具參數檢查：多的、少的、型別不對的都擋', () => {
  assert.equal(TOOLS.length, 7);
  assert.equal(validate('my_schools', {}), '');
  assert.match(validate('my_schools', {x: 1}), /不認得/);
  assert.match(validate('school_detail', {}), /缺少/);
  assert.match(validate('school_detail', {school: 3}), /文字/);
  assert.match(validate('upcoming', {days: 0}), /整數/);
  assert.match(validate('upcoming', {days: 1.5}), /整數/);
  assert.equal(validate('upcoming', {days: 30}), '');
  assert.match(validate('read_brochure_pages', {school: '006', pages: []}), /頁碼/);
  assert.match(validate('read_brochure_pages', {school: '006', pages: [1, 2, 3, 4, 5]}), /頁碼/);
  assert.match(validate('read_brochure_pages', {school: '006', pages: ['1']}), /頁碼/);
  assert.equal(validate('read_brochure_pages', {school: '006', pages: [10, 64]}), '');
  assert.match(validate('nope', {}), /沒有這個工具/);
  assert.match(validate('find_programs', null), /物件/);
  assert.match(validate('find_programs', {query: 'x'.repeat(201)}), /200/);
  for (const t of TOOLS) assert.equal(t.input_schema.additionalProperties, false, t.name);
});

test('回答的 Markdown：跳脫 HTML，只收安全的連結', () => {
  assert.equal(renderMd('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(renderMd('[點](javascript:alert(1))'), '<p>[點](javascript:alert(1))</p>');
  assert.equal(renderMd('[x](/etc/passwd)'), '<p>[x](/etc/passwd)</p>');
  assert.equal(renderMd('[x" onmouseover="a](https://a.b)'), '<p><a class="link ext" href="https://a.b" target="_blank" rel="noopener">x&quot; onmouseover=&quot;a</a></p>');
  assert.equal(renderMd('要帶**身分證**（[中興 p.10](/data/brochures/pdf/006.pdf#page=10)）'),
    '<p>要帶<strong>身分證</strong>（<a class="link ext" href="/data/brochures/pdf/006.pdf#page=10" target="_blank" rel="noopener">中興 p.10</a>）</p>');
  assert.equal(renderMd('[中興](#schools/abc)'), '<p><a class="link" href="#schools/abc">中興</a></p>');
  assert.equal(renderMd('看 https://recruit.nchu.edu.tw/x?a=1&b=2。'), '<p>看 <a class="link ext" href="https://recruit.nchu.edu.tw/x?a=1&amp;b=2" target="_blank" rel="noopener">https://recruit.nchu.edu.tw/x?a=1&amp;b=2</a>。</p>');
  assert.equal(renderMd('[a](https://x/**y**)'), '<p><a class="link ext" href="https://x/**y**" target="_blank" rel="noopener">a</a></p>');
  assert.equal(renderMd('一\n二\n\n- 甲\n- 乙\n1. 丙'), '<p>一<br>二</p><ul><li>甲</li><li>乙</li></ul><ol><li>丙</li></ol>');
  assert.equal(renderMd('`<b>`'), '<p><code>&lt;b&gt;</code></p>');
  assert.equal(renderMd('```\n<i>x</i>\n```'), '<pre>&lt;i&gt;x&lt;/i&gt;</pre>');
  assert.equal(renderMd('## 標題'), '<p><strong>標題</strong></p>');
});

test('Claude Code 接法：鎖住的參數、MCP 工具查到紀錄和簡章、對話接著問', async t => {
  const dir = makeDir();
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    const st = await json(s, '/api/ai/status');
    assert.equal(st.status, 200);
    assert.deepEqual([st.data.cli.found, st.data.cli.loggedIn, st.data.active, st.data.settings.model, st.data.settings.effort], [true, true, 'cli', 'claude-opus-5-5', 'xhigh']);
    assert.equal(st.data.key.set, false);

    const q = ['ECHOARGS', 'CALL my_schools {}', 'CALL school_detail {"school": "中興"}', 'CALL search_brochure {"query": "面試 攜帶", "school": "中興"}',
      'CALL read_brochure_pages {"school": "006", "pages": [64]}', 'CALL find_programs {"query": "逢甲 資訊"}', 'CALL program_info {"program_id": "116-056-015"}',
      'CALL upcoming {"days": 40}', 'CALL school_detail {"school": "不存在"}', 'CALL read_brochure_pages {"school": "006", "pages": [999]}'].join('\n');
    const r = await ask(s, {question: q, appId: 'xd'});
    assert.equal(r.status, 200);
    assert.equal(r.events[0][0], 'start');
    assert.equal(r.events[0][1].backend, 'cli');
    assert.ok(r.done, JSON.stringify(r.events.slice(-3)));
    assert.equal(r.done.turn.status, 'done');
    // 鎖住：沒有內建工具、只有我們的 MCP、不問權限、不留紀錄
    const args = JSON.parse(/ARGS (.*)\n/.exec(r.text)[1]);
    const val = k => args[args.indexOf(k) + 1];
    assert.equal(val('--tools'), '');
    for (const f of ['-p', '--strict-mcp-config', '--restricted', '--no-session-persistence', '--disable-slash-commands']) assert.ok(args.includes(f), f);
    assert.equal(val('--permission-mode'), 'dontAsk');
    assert.equal(val('--allowedTools'), 'mcp__tracker');
    assert.equal(val('--model'), 'claude-opus-5-5');
    assert.equal(val('--effort'), 'xhigh');
    assert.ok(!args.some(a => /dangerously|bypass/i.test(a)));
    assert.deepEqual(Object.keys(JSON.parse(val('--mcp-config')).mcpServers), ['tracker']);
    // 工具結果
    assert.match(r.text, /工具 7 個/);
    assert.match(r.text, /同一天的面試：12\/04（五） [^\n]*、[^\n]*、/, '中興、宜大、逢甲 12/04 同一天面試');
    assert.match(r.text, /app_id=xd/);
    assert.match(r.text, /p\.10 \/data\/brochures\/pdf\/006\.pdf#page=10】\n[^\n]*身分證件正本/);
    assert.match(r.text, /【read_brochure_pages】\n[\s\S]*p\.64 \/data\/brochures\/pdf\/006\.pdf#page=64】\n資訊工程學系資安組/);
    assert.match(r.text, /116-056-015｜逢甲/);
    assert.match(r.text, /【program_info】\n116-056-015｜逢甲大學 資訊工程學系｜簡章代碼 056｜使用者已加入/);
    assert.match(r.text, /【upcoming】\n現在：2026-11-04 12:00/);
    assert.match(r.text, /【school_detail 錯誤】\n使用者的學校裡沒有「不存在」/);
    assert.match(r.text, /【read_brochure_pages 錯誤】/);
    const labels = r.events.filter(e => e[0] === 'tool').map(e => e[1].label);
    assert.equal(labels.length, 9);
    assert.ok(labels.includes('讀了 興大 簡章 p.64') || labels.some(l => /讀了 \S+ 簡章 p\.64/.test(l)), labels.join('|'));

    // 存起來了；網頁拿到的對話沒有內部欄位
    const chats = await json(s, '/api/ai/chats');
    assert.equal(chats.data.length, 1);
    const id = r.done.chatId;
    const c = await json(s, `/api/ai/chats/${id}`);
    assert.equal(c.data.turns.length, 1);
    assert.equal(c.data.appId, 'xd');
    assert.deepEqual(Object.keys(c.data.turns[0]).sort(), ['a', 'at', 'backend', 'error', 'model', 'q', 'status', 'tools']);
    // 接著問：前一題和答案放在提示裡，網站附註寫今天和正在看的學校
    const r2 = await ask(s, {question: 'PROMPTECHO 第二題', chatId: id});
    const prompt = JSON.parse(/PROMPT (.*)\n/.exec(r2.text)[1]);
    assert.match(prompt, /<使用者>\nECHOARGS/);
    assert.match(prompt, /<助理>\n伺服器 tracker/);
    assert.match(prompt, /〔網站附註：現在 2026-11-04 12:00（台北）。使用者正在看「[^」]+」（app_id=xd）。〕\nPROMPTECHO 第二題$/);
    assert.equal((await json(s, `/api/ai/chats/${id}`)).data.turns.length, 2);

    // 工具的入口：沒有正在跑的回答、沒有 token、不是本機，一律 403
    assert.equal((await json(s, '/api/ai/tool', {method: 'POST', headers: W, body: JSON.stringify({op: 'list'})})).status, 403);
    assert.equal((await json(s, '/api/ai/tool', {method: 'POST', headers: {...W, 'X-AI-Token': 'a'.repeat(48)}, body: JSON.stringify({op: 'list'})})).status, 403);
    // 寫入都要 X-Client
    assert.equal((await json(s, '/api/ai/ask', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"question":"x"}'})).status, 409);
    assert.equal((await json(s, '/api/ai/settings', {method: 'PUT', headers: W, body: '{"model":"gpt"}'})).status, 400);
    assert.equal((await json(s, '/api/ai/ask', {method: 'POST', headers: W, body: JSON.stringify({question: ''})})).status, 400);
    assert.equal((await json(s, '/api/ai/ask', {method: 'POST', headers: W, body: JSON.stringify({question: 'x'.repeat(4001)})})).status, 400);
    assert.equal((await json(s, '/api/ai/ask', {method: 'POST', headers: W, body: JSON.stringify({question: 'x', chatId: '../etc'})})).status, 400);
    assert.equal((await json(s, '/api/ai/chats/../../records', {method: 'DELETE', headers: W})).status, 404);

    // Claude Code 開了別的工具：停掉
    const bad = await ask(s, {question: 'EXTRATOOLS'});
    assert.match(bad.error.message, /不該開的工具/);
    // 錯誤的結果
    const fail = await ask(s, {question: 'FAIL'});
    assert.match(fail.error.message, /Claude Code 出錯了/);
  } finally { await stop(s); }
});

test('一次只回答一題；停止後存下已經寫出來的部分', async t => {
  const dir = makeDir();
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    const ac = new AbortController();
    let started;
    const gotText = new Promise(r => { started = r; });
    const first = ask(s, {question: 'SLOW 慢慢答'}, {signal: ac.signal, onEvent: ev => { if (ev === 'text') started(); }});
    await gotText;
    const second = await ask(s, {question: '第二題'});
    assert.equal(second.status, 429);
    assert.match(second.data.error, /還在回答/);
    ac.abort();
    await first;
    // 伺服器收尾、存檔
    let list;
    for (let i = 0; i < 40; i++) { list = (await json(s, '/api/ai/chats')).data; if (list.length) break; await new Promise(r => setTimeout(r, 100)); }
    const c = (await json(s, `/api/ai/chats/${list[0].id}`)).data;
    assert.equal(c.turns[0].status, 'stopped');
    assert.ok(c.turns[0].a.length > 0, '停止前寫出來的字要留著');
    assert.equal((await json(s, '/api/ai/status')).data.busy, false);
    // 刪除
    assert.equal((await json(s, `/api/ai/chats/${c.id}`, {method: 'DELETE', headers: W})).status, 204);
    assert.equal((await json(s, `/api/ai/chats/${c.id}`)).status, 404);
  } finally { await stop(s); }
});

// 假的 Anthropic API：記下每一次請求，照劇本回 SSE
function mockApi(script) {
  const reqs = [];
  const sse = events => events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      const body = JSON.parse(b);
      reqs.push({headers: req.headers, body, url: req.url});
      const step = script[reqs.length - 1] || script[script.length - 1];
      res.writeHead(200, {'content-type': 'text/event-stream'});
      res.end(sse(step(body)));
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({srv, reqs, url: `http://127.0.0.1:${srv.address().port}`})));
}
const msg = (blocks, stop) => {
  const ev = [{type: 'message_start', message: {id: 'msg_1', model: 'claude-opus-5-5', usage: {input_tokens: 5, output_tokens: 0}}}];
  blocks.forEach((b, index) => {
    if (b.type === 'thinking') { ev.push({type: 'content_block_start', index, content_block: {type: 'thinking', thinking: '', signature: ''}}, {type: 'content_block_delta', index, delta: {type: 'signature_delta', signature: b.signature}}); }
    if (b.type === 'text') { ev.push({type: 'content_block_start', index, content_block: {type: 'text', text: ''}}); for (const t of b.text.match(/[\s\S]{1,5}/g)) ev.push({type: 'content_block_delta', index, delta: {type: 'text_delta', text: t}}); }
    if (b.type === 'tool_use') { ev.push({type: 'content_block_start', index, content_block: {type: 'tool_use', id: b.id, name: b.name, input: {}}}, {type: 'content_block_delta', index, delta: {type: 'input_json_delta', partial_json: JSON.stringify(b.input).slice(0, 3)}}, {type: 'content_block_delta', index, delta: {type: 'input_json_delta', partial_json: JSON.stringify(b.input).slice(3)}}); }
    ev.push({type: 'content_block_stop', index});
  });
  ev.push({type: 'message_delta', delta: {stop_reason: stop}, usage: {output_tokens: 7}}, {type: 'message_stop'});
  return ev;
};

test('API Key 接法：請求的樣子、thinking 原封不動送回去、只往後接；Key 不會出現在任何回應裡', async t => {
  const dir = makeDir();
  const api = await mockApi([
    () => msg([{type: 'thinking', signature: 'SIG-ONE'}, {type: 'tool_use', id: 'tu_1', name: 'search_brochure', input: {query: '面試 攜帶', school: '中興'}}], 'tool_use'),
    () => msg([{type: 'thinking', signature: 'SIG-TWO'}, {type: 'text', text: '要帶身分證件正本（[中興 p.10](/data/brochures/pdf/006.pdf#page=10)）。'}], 'end_turn'),
    () => msg([{type: 'text', text: '第二題的答案'}], 'end_turn'),
    () => msg([], 'refusal'),
  ]);
  t.after(() => { api.srv.close(); fs.rmSync(dir, {recursive: true, force: true}); });
  const s = await start(dir, {ANTHROPIC_BASE_URL: api.url});
  try {
    assert.equal((await json(s, '/api/ai/settings', {method: 'PUT', headers: W, body: JSON.stringify({backend: 'api'})})).data.active, '', '還沒有 Key');
    const none = await ask(s, {question: '有 Key 嗎'});
    assert.match(none.error.message, /還沒設定/);
    assert.equal((await json(s, '/api/ai/key', {method: 'PUT', headers: W, body: JSON.stringify({key: 'abc'})})).status, 400);
    const put = await json(s, '/api/ai/key', {method: 'PUT', headers: W, body: JSON.stringify({key: KEY})});
    assert.equal(put.status, 200);
    assert.deepEqual(put.data.key, {set: true, source: 'file', hint: '…WXYZ'});
    assert.equal(put.data.active, 'api');
    assert.equal(fs.statSync(path.join(dir, 'secrets.json')).mode & 0o777, 0o600);

    const r = await ask(s, {question: '中興面試要帶什麼', appId: 'xd'});
    assert.equal(r.done && r.done.turn.status, 'done', JSON.stringify(r.events.slice(-2)));
    assert.equal(r.text, '要帶身分證件正本（[中興 p.10](/data/brochures/pdf/006.pdf#page=10)）。');
    assert.deepEqual(r.events.filter(e => e[0] === 'tool').map(e => e[1].label), ['在 中興 簡章找「面試 攜帶」']);
    assert.equal(api.reqs.length, 2);
    const [a, b] = api.reqs;
    assert.equal(a.url, '/v1/messages');
    assert.equal(a.headers['x-api-key'], KEY);
    assert.equal(a.headers['anthropic-version'], '2026-10-21');
    assert.match(a.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(a.body.model, 'claude-opus-5-5');
    assert.deepEqual(a.body.output_config, {effort: 'xhigh'});
    assert.deepEqual(a.body.thinking, {type: 'adaptive'});
    assert.equal(a.body.stream, true);
    assert.equal(a.body.fallbacks, 'default');
    assert.ok(!('temperature' in a.body) && !('tool_choice' in a.body));
    assert.ok(a.body.tools.every(x => x.eager_input_streaming === true));
    assert.match(a.body.messages[0].content[0].text, /^〔網站附註：現在 2026-11-04 12:00（台北）。使用者正在看「[^」]+」（app_id=xd）。〕\n中興面試要帶什麼$/);
    // 第二次：第一次的訊息原封不動，接上 thinking（簽章不變）＋tool_use，再接 tool_result
    assert.deepEqual(b.body.messages.slice(0, 1), a.body.messages);
    assert.deepEqual(b.body.messages[1].content[0], {type: 'thinking', thinking: '', signature: 'SIG-ONE'});
    assert.deepEqual(b.body.messages[1].content[1], {type: 'tool_use', id: 'tu_1', name: 'search_brochure', input: {query: '面試 攜帶', school: '中興'}});
    assert.equal(b.body.messages[2].content[0].type, 'tool_result');
    assert.equal(b.body.messages[2].content[0].tool_use_id, 'tu_1');
    assert.match(b.body.messages[2].content[0].content, /身分證件正本/);
    assert.equal(b.body.system, a.body.system);
    assert.deepEqual(b.body.tools, a.body.tools);

    // 接著問：前面的訊息一個字都不改（append-only），最後的回答也接上去
    const r2 = await ask(s, {question: '第二題', chatId: r.done.chatId});
    assert.equal(r2.text, '第二題的答案');
    const c = api.reqs[2].body.messages;
    assert.deepEqual(c.slice(0, 3), b.body.messages);
    assert.deepEqual(c[3].content.map(x => x.type), ['thinking', 'text']);
    assert.equal(c[3].content[0].signature, 'SIG-TWO');
    assert.equal(c[4].role, 'user');

    // 被安全機制擋下：寫錯誤，歷史不動
    const r3 = await ask(s, {question: '第三題', chatId: r.done.chatId});
    assert.match(r3.error.message, /安全機制/);
    const after = (await json(s, `/api/ai/chats/${r.done.chatId}`)).data;
    assert.deepEqual(after.turns.map(x => x.status), ['done', 'done', 'error']);

    // Key 不會從任何地方出去
    for (const p of ['/api/ai/status', '/api/records', '/api/export', `/api/ai/chats/${r.done.chatId}`, '/api/ai/chats', '/data/secrets.json', '/data/ai.json', '/data/../secrets.json']) {
      const x = await json(s, p);
      assert.ok(!x.text.includes(KEY) && !x.text.includes(KEY.slice(10, 40)), `${p} 不能有 Key`);
    }
    assert.equal((await json(s, '/data/secrets.json')).status, 403);
    assert.equal((await json(s, '/data/ai.json')).status, 403);
    assert.ok(!fs.readFileSync(path.join(dir, 'records.json'), 'utf8').includes(KEY));
    assert.ok(!fs.readFileSync(path.join(dir, 'ai.json'), 'utf8').includes(KEY));
    // 刪 Key
    const del = await json(s, '/api/ai/key', {method: 'DELETE', headers: W});
    assert.deepEqual([del.data.key.set, del.data.active], [false, '']);
    assert.ok(!fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8').includes(KEY));
  } finally { await stop(s); }
});
