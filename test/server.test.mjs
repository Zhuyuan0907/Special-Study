// 伺服器整合測試：在暫存資料夾開一台伺服器（DATA_DIR），測遷移備份、409、壞檔救回、/data 白名單、.ics、同步、匯入。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {ROOT, PD} from './helpers.mjs';

const md = k => `${k.slice(5, 7)}/${k.slice(8, 10)}`;
const DL = new Set(['reg', 'pay', 'upload', 'letter', 'confirm', 'giveup', 'review']);
// 舊版（v2）存的樣子：截止類收成截止日、開始日寫在備註裡；備審是通用清單
function v2App(id, programId, extra = {}) {
  const p = PD.programs.find(x => x.i === programId);
  const dates = p.ev.filter(e => e[0] !== 'other').map(([kind, sd, ed, st, et, name, note], i) => DL.has(kind) && ed
    ? {id: `${id}-d${i}`, kind, date: ed, end: '', time: et || '', note: `${name}（${md(sd)}${st ? ' ' + st : ''} 起）${note ? '・' + note : ''}`}
    : {id: `${id}-d${i}`, kind, date: sd, end: ed || '', time: st || '', note: name + (note ? '・' + note : '')});
  const docs = ['自傳／個人陳述', '讀書計畫', '特殊表現證明文件', '系所指定其他資料'].map((n, i) => ({id: `${id}-k${i}`, name: n, done: false}));
  return {id, school: PD.schools[p.s].name, dept: p.n, programId, status: 'prep', methods: ['資料審查'], fee: 600, quota: 3, url: '', dates, docs, notes: '甄選：書面審查 100%', prep: '', asked: '', choice: '', waitNo: null, confirmDone: false, giveupDone: false, createdAt: 1793092149350, updatedAt: '2026-11-01T17:33:00.000Z', ...extra};
}
const V2 = {version: 2, apps: [
  v2App('tp', '116-032-005', {regSteps: [{id: 's1', name: '網路報名完成', done: true}, {id: 's2', name: '備審上傳完成，並按「確認送出」', done: false}]}),
  v2App('fj', '116-051-027', {status: 'applied', createdAt: 1793036647589}),
], todos: [], profile: {}, notifyLastSent: '', updatedAt: '2026-11-01T17:33:00.000Z'};

function makeDir(records, {programs = PD} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'special-study-test-'));
  fs.writeFileSync(path.join(dir, 'programs.json'), JSON.stringify(programs));
  for (const f of ['search-terms.json', 'school-links.json', 'season.json', 'records.example.json']) fs.copyFileSync(path.join(ROOT, 'data', f), path.join(dir, f));
  if (records !== undefined) fs.writeFileSync(path.join(dir, 'records.json'), typeof records === 'string' ? records : JSON.stringify(records, null, 2));
  return dir;
}
function start(dir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {cwd: ROOT, env: {...process.env, DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1'}, stdio: ['ignore', 'pipe', 'pipe']});
    let out = '';
    const onData = d => {
      out += d;
      const m = /已啟動：http:\/\/localhost:(\d+)/.exec(out);
      if (m) resolve({child, base: `http://127.0.0.1:${m[1]}`, log: () => out});
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', d => { out += d; });
    child.on('exit', code => reject(new Error(`server exited ${code}\n${out}`)));
    setTimeout(() => reject(new Error('server did not start\n' + out)), 8000);
  });
}
const stop = s => new Promise(r => { s.child.removeAllListeners('exit'); s.child.on('exit', r); s.child.kill(); });
const backups = dir => { try { return fs.readdirSync(path.join(dir, 'backups')).sort(); } catch { return []; } };
const W = {'X-Client': '3', 'Content-Type': 'application/json'};
const get = async (s, p) => { const r = await fetch(s.base + p); return {status: r.status, type: r.headers.get('content-type'), body: await r.text()}; };
const json = async (s, p, opt) => { const r = await fetch(s.base + p, opt); const t = await r.text(); return {status: r.status, data: t ? JSON.parse(t) : null}; };

test('啟動：先備份再遷移；重開不會再遷移', async t => {
  const dir = makeDir(V2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  let s = await start(dir);
  try {
    const b = backups(dir);
    assert.equal(b.filter(f => f.startsWith('records-before-migrate-')).length, 1);
    assert.ok(b.some(f => /^records-\d{4}-\d{2}-\d{2}\.json$/.test(f)), '每日備份');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'backups', b.find(f => f.startsWith('records-before-migrate-'))), 'utf8')), V2, '備份是遷移前的檔案');
    const {data} = await json(s, '/api/records');
    assert.equal(data.version, 3);
    assert.ok(data.apps.every(a => a.v === 3 && a.rev === 1));
    assert.ok(data.brochureHash);
    const tp = data.apps.find(a => a.id === 'tp');
    assert.equal(tp.regSteps[0].key, 'reg');
    assert.equal(tp.regSteps[0].done, true);
    assert.equal(tp.docs.length, 4);
    assert.ok(tp.docs.every(d => d.src === 'brochure'));
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'records.json'), 'utf8'));
    assert.deepEqual(Object.keys(disk), ['version', 'apps', 'todos', 'profile', 'notifyLastSent', 'updatedAt', 'brochureHash', 'syncLog', 'expenses']);
    assert.deepEqual(disk.expenses, [], 'v2 沒有花費 → []');
  } finally { await stop(s); }
  const before = fs.readFileSync(path.join(dir, 'records.json'), 'utf8');
  s = await start(dir);
  try {
    assert.equal(backups(dir).filter(f => f.startsWith('records-before-')).length, 1, '第二次啟動不再遷移、不再備份');
    assert.equal(fs.readFileSync(path.join(dir, 'records.json'), 'utf8'), before, '第二次啟動不寫檔');
  } finally { await stop(s); }
});

test('寫入：沒帶 X-Client 是 409；版本不對是 409 加上最新的；對了 rev 加一', async t => {
  const dir = makeDir(V2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    const cur = (await json(s, '/api/records')).data.apps.find(a => a.id === 'tp');
    for (const [method, p, body] of [['PUT', '/api/apps/tp', cur], ['DELETE', '/api/apps/tp'], ['PUT', '/api/profile', {}], ['PUT', '/api/todos', []], ['POST', '/api/import', {apps: []}]]) {
      const r = await json(s, p, {method, headers: {'Content-Type': 'application/json'}, body: body && JSON.stringify(body)});
      assert.equal(r.status, 409, `${method} ${p}`);
      assert.equal(r.data.error, '網頁已更新，請重新整理');
      assert.equal(r.data.app, undefined);
    }
    const stale = await json(s, '/api/apps/tp', {method: 'PUT', headers: W, body: JSON.stringify({...cur, rev: 0, status: 'skipped'})});
    assert.equal(stale.status, 409);
    assert.equal(stale.data.app.rev, 1);
    assert.equal(stale.data.app.status, 'prep');
    const ok = await json(s, '/api/apps/tp', {method: 'PUT', headers: W, body: JSON.stringify({...cur, status: 'applied'})});
    assert.equal(ok.status, 200);
    assert.equal(ok.data.rev, 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'records.json'), 'utf8')).apps.find(a => a.id === 'tp').status, 'applied');
    // 網頁沒送回來的伺服器欄位（src、ref、bro）補回去
    const stripped = {...ok.data, dates: ok.data.dates.map(({src, ref, bro, ...d}) => d)};
    const ok2 = await json(s, '/api/apps/tp', {method: 'PUT', headers: W, body: JSON.stringify(stripped)});
    assert.equal(ok2.status, 200);
    assert.ok(ok2.data.dates.every(d => d.src === 'brochure' && d.ref && d.bro));
    // 新的一間（沒有 rev）可以直接加
    const add = await json(s, '/api/apps/new1', {method: 'PUT', headers: W, body: JSON.stringify({school: '某大學', dept: '資工', v: 3, dates: [], docs: []})});
    assert.equal(add.status, 200);
    assert.equal(add.data.rev, 1);
    // 寫檔失敗回 500
    fs.mkdirSync(path.join(dir, 'records.json.tmp'));
    const fail = await json(s, '/api/apps/new1', {method: 'PUT', headers: W, body: JSON.stringify({...add.data, dept: '資安'})});
    assert.equal(fail.status, 500);
    fs.rmdirSync(path.join(dir, 'records.json.tmp'));
    const del = await fetch(s.base + '/api/apps/new1', {method: 'DELETE', headers: W});
    assert.equal(del.status, 204);
  } finally { await stop(s); }
});

test('/data 只給簡章資料；紀錄和備份一律 403；.ics、meta、總表', async t => {
  const dir = makeDir(V2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    for (const p of ['/data//records.json', '/data/records.json', '/data/brochures/..%2frecords.json', '/data/brochures/%2e%2e/records.json', '/data/backups/x.json', `/data/backups/${backups(dir)[0]}`, '/data/records.example.json', '/data/overrides.json', '/data/brochures/text/../../records.json']) {
      assert.equal((await get(s, p)).status, 403, p);
    }
    for (const p of ['/data/programs.json', '/data/season.json', '/data/search-terms.json', '/data/school-links.json']) assert.equal((await get(s, p)).status, 200, p);
    const ics = await get(s, '/api/calendar.ics');
    assert.equal(ics.status, 200);
    assert.match(ics.type, /text\/calendar/);
    assert.match(ics.body, /BEGIN:VEVENT/);
    assert.match(ics.body, /SUMMARY:北市大 /);
    const meta = (await json(s, '/api/meta')).data;
    assert.ok(Array.isArray(meta.lan));
    assert.equal(meta.recovered, null);
    assert.ok('syncLog' in meta);
    const table = (await json(s, '/api/table')).data;
    assert.equal(table.headers[2], '狀態');
    assert.equal(table.rows.find(r => r[0] === '輔仁大學')[2], '已報名');
    assert.equal(table.rows.find(r => r[0] === '臺北市立大學')[15], '', '自動的甄選文字不算筆記');
    const dg = (await json(s, '/api/digest?days=60')).data;
    assert.match(dg.text, /^特選提醒｜/);
    assert.equal((await get(s, '/api/table.csv')).status, 200);
    assert.equal((await get(s, '/api/export.md')).status, 200);
  } finally { await stop(s); }
});

test('records.json 壞掉：搬到 backups，載入最新的備份並寫回，絕不用範例', async t => {
  const dir = makeDir('{"version": 2, "apps": [');
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.mkdirSync(path.join(dir, 'backups'));
  fs.writeFileSync(path.join(dir, 'backups', 'records-2026-10-31.json'), JSON.stringify(V2));
  const s = await start(dir);
  try {
    const {data} = await json(s, '/api/records');
    assert.deepEqual(data.apps.map(a => a.id).sort(), ['fj', 'tp']);
    const meta = (await json(s, '/api/meta')).data;
    assert.equal(meta.recovered.from, 'records-2026-10-31.json');
    assert.ok(backups(dir).some(f => f.startsWith('records-corrupt-')));
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'records.json'), 'utf8'));
    assert.deepEqual(disk.apps.map(a => a.id).sort(), ['fj', 'tp']);
  } finally { await stop(s); }
});

test('沒有 records.json：範例只在記憶體，第一次寫入才建檔', async t => {
  const dir = makeDir(undefined);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    const {data} = await json(s, '/api/records');
    assert.ok(data.apps.length > 0 && data.apps.every(a => a.v === 3));
    assert.equal(fs.existsSync(path.join(dir, 'records.json')), false);
    assert.equal((await json(s, '/api/meta')).data.example, true);
    const r = await json(s, '/api/todos', {method: 'PUT', headers: W, body: '[]'});
    assert.equal(r.status, 200);
    assert.equal(fs.existsSync(path.join(dir, 'records.json')), true);
  } finally { await stop(s); }
});

test('簡章資料變了才同步：先備份、記 syncLog；改過的日期留著', async t => {
  const dir = makeDir(V2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  let s = await start(dir);
  try {
    const tp = (await json(s, '/api/records')).data.apps.find(a => a.id === 'tp');
    const rel = tp.dates.find(d => d.kind === 'release');
    const edited = {...tp, dates: tp.dates.map(d => d.kind === 'confirm' ? {...d, time: '10:00'} : d)};
    assert.equal((await json(s, '/api/apps/tp', {method: 'PUT', headers: W, body: JSON.stringify(edited)})).status, 200);
    assert.ok(rel);
  } finally { await stop(s); }
  // 北市大放榜改到 12/05、報到改 15:00（自己改過 10:00，要留著）
  const P2 = structuredClone(PD);
  const p = P2.programs.find(x => x.i === '116-032-005');
  p.ev = p.ev.map(e => e[0] === 'release' ? ['release', '2026-12-05', '', '', '', e[5], ''] : e[0] === 'confirm' ? ['confirm', '2026-12-11', '', '15:00', '', e[5], ''] : e);
  fs.writeFileSync(path.join(dir, 'programs.json'), JSON.stringify(P2));
  s = await start(dir);
  try {
    assert.equal(backups(dir).filter(f => f.startsWith('records-before-sync-')).length, 1);
    const {data} = await json(s, '/api/records');
    const tp = data.apps.find(a => a.id === 'tp');
    assert.equal(tp.dates.find(d => d.kind === 'release').date, '2026-12-05');
    assert.equal(tp.dates.find(d => d.kind === 'confirm').time, '10:00');
    assert.equal(data.syncLog.length, 1);
    const log = data.syncLog[0];
    assert.ok(log.changes.some(c => c.what === '放榜' && c.to === '12/05'));
    assert.ok(log.changes.some(c => c.conflict));
    assert.equal(tp.dates.find(d => d.kind === 'release').upd, log.id);
    assert.equal((await json(s, '/api/meta')).data.syncLog.id, log.id);
  } finally { await stop(s); }
});

test('從備份匯入：先備份，遷移後合併，?dry=1 只回報', async t => {
  const dir = makeDir(V2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    const old = structuredClone(V2);
    old.apps[0].status = 'applied';
    old.apps.push(v2App('fc', '116-056-015'));
    const dry = await json(s, '/api/import?dry=1', {method: 'POST', headers: W, body: JSON.stringify(old)});
    assert.deepEqual(dry.data, {apps: 3, replace: 2, expenses: 0});
    assert.equal(backups(dir).filter(f => f.startsWith('records-before-import-')).length, 0);
    const r = await json(s, '/api/import', {method: 'POST', headers: W, body: JSON.stringify({...old, profile: {tags: ['ais3']}})});
    assert.deepEqual(r.data, {imported: 3, replaced: 2, expenses: 0});
    assert.equal(backups(dir).filter(f => f.startsWith('records-before-import-')).length, 1);
    const {data} = await json(s, '/api/records');
    assert.equal(data.apps.length, 3);
    assert.ok(data.apps.every(a => a.v === 3));
    assert.equal(data.apps.find(a => a.id === 'tp').rev, 2);
    assert.equal(data.apps.find(a => a.id === 'fc').dates.length, 9);
    assert.deepEqual(data.profile.tags, ['ais3']);
  } finally { await stop(s); }
});

/* ---------- 審查修正（DS1–DS10） ---------- */
// 起不來的伺服器：等它結束，回傳輸出
function startFail(dir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {cwd: ROOT, env: {...process.env, DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1'}, stdio: ['ignore', 'pipe', 'pipe']});
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('exit', code => resolve({code, out}));
    setTimeout(() => { child.kill(); reject(new Error('server did not exit\n' + out)); }, 8000);
  });
}
// 自己帶 Host 標頭（fetch 不能改 Host）
function rawGet(base, p, host) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: u.hostname, port: u.port, path: p, headers: host === undefined ? {} : {Host: host}}, res => { let b = ''; res.on('data', d => { b += d; }); res.on('end', () => resolve({status: res.statusCode, body: b})); });
    req.on('error', reject);
    req.end();
  });
}

test('DS1 overrides.json 的 ev 是補丁：伺服器不再併一次（起得來）；遷移丟錯時不留備份、不動 records.json', async t => {
  const dir = makeDir(V2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  // build-data 用的補丁格式（已經套進 programs.json 了）
  fs.writeFileSync(path.join(dir, 'overrides.json'), JSON.stringify({programs: {'116-032-005': {scr: false, ev: [{match: {kind: 'upload'}, set: {note: '限時掛號，郵戳為憑'}}, {add: ['other', '2026-11-13', '', '10:00', '', '查詢報考資格審核結果', '']}]}}}));
  const s = await start(dir);
  try {
    const prog = JSON.parse((await get(s, '/data/programs.json')).body).programs.find(p => p.i === '116-032-005');
    assert.ok(prog.ev.every(Array.isArray), 'ev 還是簡章列');
    assert.deepEqual(prog.ev, PD.programs.find(p => p.i === '116-032-005').ev);
    assert.equal(prog.scr, false, '一般欄位照樣併');
    assert.equal((await json(s, '/api/records')).data.apps.length, 2);
  } finally { await stop(s); }
  // 簡章資料壞掉，遷移會丟錯：啟動失敗，但不留 records-before-* 備份，records.json 不動
  const dir2 = makeDir(V2, {programs: {...PD, programs: PD.programs.map(p => p.i === '116-032-005' ? {...p, ev: [...p.ev, null]} : p)}});
  t.after(() => fs.rmSync(dir2, {recursive: true, force: true}));
  const before = fs.readFileSync(path.join(dir2, 'records.json'), 'utf8');
  for (let i = 0; i < 2; i++) {
    const r = await startFail(dir2);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /啟動失敗/);
  }
  assert.deepEqual(backups(dir2).filter(f => f.startsWith('records-before-')), []);
  assert.equal(fs.readFileSync(path.join(dir2, 'records.json'), 'utf8'), before);
});

test('DS2 匯入舊的備份：遷移完馬上跟現在的簡章同步，記在 syncLog', async t => {
  const dir = makeDir(V2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    const old = v2App('fc', '116-056-015');
    old.dates.find(d => d.kind === 'reg').date = '2026-11-20'; // 舊簡章的報名截止
    const r = await json(s, '/api/import', {method: 'POST', headers: W, body: JSON.stringify({apps: [old]})});
    assert.equal(r.status, 200);
    const {data} = await json(s, '/api/records');
    const reg = data.apps.find(a => a.id === 'fc').dates.find(d => d.kind === 'reg');
    assert.deepEqual([reg.date, reg.time], ['2026-11-19', '']);
    assert.equal(data.syncLog.length, 1);
    assert.ok(data.syncLog[0].changes.some(c => c.what === '報名截止' && c.from === '11/20' && c.to === '11/19'));
    assert.equal(reg.upd, data.syncLog[0].id);
    // 再匯入一次現在的匯出：沒有新的 syncLog
    const exp = JSON.parse((await get(s, '/api/export')).body);
    assert.equal((await json(s, '/api/import', {method: 'POST', headers: W, body: JSON.stringify(exp)})).status, 200);
    assert.equal((await json(s, '/api/records')).data.syncLog.length, 1);
  } finally { await stop(s); }
});

test('DS3 寫檔失敗：記憶體退回去，重試不會多一列，刪除失敗學校還在', async t => {
  const dir = makeDir(V2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    const cur = (await json(s, '/api/records')).data.apps.find(a => a.id === 'tp');
    fs.mkdirSync(path.join(dir, 'records.json.tmp'));
    const body = {...cur, dates: [...cur.dates, {id: 'own1', kind: 'other', date: '2026-11-20', time: '', end: '', from: '', fromTime: '', note: 'MY-OWN-ROW', src: 'mine', ref: ''}]};
    assert.equal((await json(s, '/api/apps/tp', {method: 'PUT', headers: W, body: JSON.stringify(body)})).status, 500);
    let mem = (await json(s, '/api/records')).data.apps.find(a => a.id === 'tp');
    assert.equal(mem.rev, cur.rev, 'rev 沒有加');
    assert.ok(!mem.dates.some(d => d.id === 'own1'));
    assert.equal((await fetch(s.base + '/api/apps/fj', {method: 'DELETE', headers: W})).status, 500);
    assert.ok((await json(s, '/api/records')).data.apps.some(a => a.id === 'fj'), '刪除失敗：還在');
    assert.equal((await json(s, '/api/todos', {method: 'PUT', headers: W, body: JSON.stringify([{id: 't1', text: 'x'}])})).status, 500);
    assert.deepEqual((await json(s, '/api/records')).data.todos, []);
    assert.equal((await json(s, '/api/profile', {method: 'PUT', headers: W, body: JSON.stringify({tags: ['x']})})).status, 500);
    assert.deepEqual((await json(s, '/api/records')).data.profile, {});
    assert.equal((await json(s, '/api/import', {method: 'POST', headers: W, body: JSON.stringify({apps: [v2App('fc', '116-056-015')]})})).status, 500);
    assert.ok(!(await json(s, '/api/records')).data.apps.some(a => a.id === 'fc'));
    fs.rmdirSync(path.join(dir, 'records.json.tmp'));
    // 網頁帶同一份、同一個 rev 重試：接受，只有一列
    const ok = await json(s, '/api/apps/tp', {method: 'PUT', headers: W, body: JSON.stringify(body)});
    assert.equal(ok.status, 200);
    assert.equal(ok.data.rev, cur.rev + 1);
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'records.json'), 'utf8'));
    assert.equal(disk.apps.find(a => a.id === 'tp').dates.filter(d => d.id === 'own1').length, 1);
    assert.ok(disk.apps.some(a => a.id === 'fj'));
  } finally { await stop(s); }
});

test('DS6 匯入：形狀不對的清單整理掉；有一間讀不懂就整個不匯入', async t => {
  // 多一個簡章資料壞掉的系組（遷移會丟錯）
  const bad = {...PD.programs.find(p => p.i === '116-032-005'), i: '116-032-999', ev: [null]};
  const dir = makeDir(V2, {programs: {...PD, programs: [...PD.programs, bad]}});
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    const first = {...structuredClone(V2.apps[1]), school: 'IMPORTED-輔仁'};
    const r = await json(s, '/api/import', {method: 'POST', headers: W, body: JSON.stringify({apps: [first, {...v2App('zz', '116-032-005'), programId: '116-032-999'}]})});
    assert.equal(r.status, 400);
    assert.match(r.data.error, /沒有匯入/);
    assert.ok(!(await json(s, '/api/records')).data.apps.some(a => a.school === 'IMPORTED-輔仁'), '不會只匯一半');
    assert.equal(backups(dir).filter(f => f.startsWith('records-before-import-')).length, 0);
    const g = await json(s, '/api/import', {method: 'POST', headers: W, body: JSON.stringify({apps: [{id: 'g2', school: 'Garbage', v: 3, dates: 'nope', docs: 5, hidden: 7}, {id: 'g3', school: 'Nulls', dates: [null, 'x'], docs: [null]}]})});
    assert.equal(g.status, 200);
    const apps = (await json(s, '/api/records')).data.apps;
    assert.deepEqual(['dates', 'docs', 'hidden'].map(k => apps.find(a => a.id === 'g2')[k]), [[], [], []]);
    for (const p of ['/api/table', '/api/calendar.ics', '/api/digest', '/api/export.md', '/api/table.csv']) assert.equal((await get(s, p)).status, 200, p);
    // PUT 也一樣
    const put = await json(s, '/api/apps/g4', {method: 'PUT', headers: W, body: JSON.stringify({school: 'P', v: 3, dates: [null, 'x'], docs: {}, hidden: 5})});
    assert.equal(put.status, 200);
    assert.equal((await get(s, '/api/calendar.ics')).status, 200);
  } finally { await stop(s); }
});

test('DS7 records.json 讀得懂但 apps 不是清單：當成壞檔，從備份救回', async t => {
  const dir = makeDir(JSON.stringify({version: 3, apps: {tp: V2.apps[0]}}));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.mkdirSync(path.join(dir, 'backups'));
  fs.writeFileSync(path.join(dir, 'backups', 'records-2026-10-31.json'), JSON.stringify(V2));
  const s = await start(dir);
  try {
    assert.equal((await json(s, '/api/meta')).data.recovered.from, 'records-2026-10-31.json');
    const corrupt = backups(dir).find(f => f.startsWith('records-corrupt-'));
    assert.ok(corrupt);
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'backups', corrupt), 'utf8')).apps.tp, '壞檔原樣留著');
    assert.deepEqual((await json(s, '/api/records')).data.apps.map(a => a.id).sort(), ['fj', 'tp']);
  } finally { await stop(s); }
});

test('DS8 只接受 IP、localhost、這台電腦的名字開的網頁（擋 DNS rebinding）', async t => {
  const dir = makeDir(V2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    const port = new URL(s.base).port;
    for (const h of ['attacker.example', `attacker.example:${port}`, `localhost.attacker.example:${port}`, `127.0.0.1.nip.io:${port}`, '[evil]', 'evil.com/@127.0.0.1']) {
      assert.equal((await rawGet(s.base, '/api/records', h)).status, 403, h);
    }
    assert.equal((await rawGet(s.base, '/', 'attacker.example')).status, 403);
    for (const h of [`127.0.0.1:${port}`, `localhost:${port}`, 'localhost', `[::1]:${port}`, `${os.hostname()}:${port}`, `${os.hostname()}.local`, 'app.localhost', '192.168.1.20:5180']) {
      assert.equal((await rawGet(s.base, '/api/meta', h)).status, 200, h);
    }
  } finally { await stop(s); }
});

test('DS9 別的地方刪掉的學校：舊分頁再寫回來是 410，不會復活', async t => {
  const dir = makeDir(V2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    const fj = (await json(s, '/api/records')).data.apps.find(a => a.id === 'fj');
    assert.equal((await fetch(s.base + '/api/apps/fj', {method: 'DELETE', headers: W})).status, 204);
    const r = await json(s, '/api/apps/fj', {method: 'PUT', headers: W, body: JSON.stringify({...fj, notes: 'stale'})});
    assert.equal(r.status, 410);
    assert.ok(!(await json(s, '/api/records')).data.apps.some(a => a.id === 'fj'));
    assert.ok(!JSON.parse(fs.readFileSync(path.join(dir, 'records.json'), 'utf8')).apps.some(a => a.id === 'fj'));
    // 剛加的（rev 0）照樣可以
    assert.equal((await json(s, '/api/apps/new2', {method: 'PUT', headers: W, body: JSON.stringify({school: '某大學', v: 3, rev: 0, dates: [], docs: []})})).status, 200);
  } finally { await stop(s); }
});

test('DS10 簡章全文：頁碼不是整數不會 500，重複的頁只給一次', async t => {
  const dir = makeDir(V2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.mkdirSync(path.join(dir, 'brochures/text'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'brochures/text/032.json'), JSON.stringify({pages: ['第一頁', '第二頁']}));
  const s = await start(dir);
  try {
    for (const q of ['1.5', '2.9', 'NaN', 'Infinity']) {
      const r = await json(s, `/api/brochure/032?pages=${q}`);
      assert.equal(r.status, 200, q);
      assert.deepEqual(r.data.pages, []);
    }
    assert.deepEqual((await json(s, '/api/brochure/032?pages=1,1,2,1')).data.pages.map(p => p.page), [1, 2]);
  } finally { await stop(s); }
});

/* ---------- 花費（DESIGN §12） ---------- */
const putExp = (s, id, body, headers = W) => json(s, `/api/expenses/${id}`, {method: 'PUT', headers, body: JSON.stringify(body)});
const E1 = {date: '2026-11-13', amount: 1490, what: '高鐵 台北→台南', cat: 'travel', appId: 'fj', school: '', createdAt: 1793597310669};

test('花費 PUT／DELETE：X-Client、rev、409、410、400；學校名自動補上、不認得的欄位丟掉', async t => {
  const dir = makeDir(V2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    assert.equal((await putExp(s, 'e1', E1, {'Content-Type': 'application/json'})).status, 409, '沒帶 X-Client');
    assert.equal((await fetch(s.base + '/api/expenses/e1', {method: 'DELETE'})).status, 409);
    const ok = await putExp(s, 'e1', {...E1, junk: 1, derived: true, id: 'other'});
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data, {id: 'e1', date: '2026-11-13', amount: 1490, what: '高鐵 台北→台南', cat: 'travel', appId: 'fj', school: '輔大', rev: 1, createdAt: 1793597310669});
    let disk = JSON.parse(fs.readFileSync(path.join(dir, 'records.json'), 'utf8'));
    assert.deepEqual(disk.expenses, [ok.data]);
    // 版本不對：409 加上最新的那筆；改好 rev 加一，createdAt 不變
    const stale = await putExp(s, 'e1', {...E1, rev: 0, amount: 1});
    assert.equal(stale.status, 409);
    assert.equal(stale.data.expense.amount, 1490);
    const upd = await putExp(s, 'e1', {...ok.data, amount: '1,590', createdAt: 5});
    assert.deepEqual([upd.status, upd.data.amount, upd.data.rev, upd.data.createdAt], [200, 1590, 2, 1793597310669]);
    // 不對的：400，什麼都沒寫
    for (const bad of [{...E1, amount: -1}, {...E1, amount: 1.5}, {...E1, amount: '12a'}, {...E1, amount: 1000001}, {...E1, what: 'x'.repeat(61)}, {...E1, date: '2026-13-01'}, {...E1, cat: 'food'}, {...E1, appId: 'a b'}, [1], 'x']) {
      const r = await putExp(s, 'e2', bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.ok(r.data.error);
    }
    assert.equal((await putExp(s, 'bad%20id', E1)).status, 400);
    assert.equal((await json(s, '/api/records')).data.expenses.length, 1);
    // 沒有指定學校的、學校不存在的也可以（學校可能剛加、還沒存）
    assert.equal((await putExp(s, 'e2', {...E1, appId: '', amount: 0, what: '證件照', cat: ''})).data.cat, 'print', '沒給類別就猜');
    assert.equal((await putExp(s, 'e3', {...E1, appId: 'nope', school: '某大'})).data.school, '某大');
    // 刪除：204；再刪 404；別的地方刪掉的，舊分頁再寫回來是 410
    assert.equal((await fetch(s.base + '/api/expenses/e3', {method: 'DELETE', headers: W})).status, 204);
    assert.equal((await fetch(s.base + '/api/expenses/e3', {method: 'DELETE', headers: W})).status, 404);
    assert.equal((await putExp(s, 'e3', {...E1, rev: 1})).status, 410);
    assert.equal((await putExp(s, 'e3', {...E1, rev: 0})).status, 200, '復原（新的一筆，rev 0）可以');
    // 寫檔失敗：500，記憶體退回去
    fs.mkdirSync(path.join(dir, 'records.json.tmp'));
    assert.equal((await putExp(s, 'e4', E1)).status, 500);
    assert.equal((await putExp(s, 'e1', {...upd.data, amount: 7})).status, 500);
    assert.equal((await fetch(s.base + '/api/expenses/e2', {method: 'DELETE', headers: W})).status, 500);
    fs.rmdirSync(path.join(dir, 'records.json.tmp'));
    const mem = (await json(s, '/api/records')).data.expenses;
    assert.deepEqual(mem.map(e => [e.id, e.amount, e.rev]).sort(), [['e1', 1590, 2], ['e2', 0, 1], ['e3', 1490, 1]]);
    disk = JSON.parse(fs.readFileSync(path.join(dir, 'records.json'), 'utf8'));
    assert.deepEqual(disk.expenses.map(e => e.id).sort(), ['e1', 'e2', 'e3']);
  } finally { await stop(s); }
});

test('花費 CSV：BOM、日期・項目・類別・學校・金額；自動的報名費也在，照日期排', async t => {
  const dir = makeDir(V2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    await putExp(s, 'e1', E1);
    await putExp(s, 'e2', {date: '2026-10-01', amount: 80, what: '掛號, "限時"', cat: 'mail'});
    const r = await get(s, '/api/expenses.csv');
    assert.equal(r.status, 200);
    assert.match(r.type, /text\/csv/);
    const res = await fetch(s.base + '/api/expenses.csv');
    assert.match(res.headers.get('content-disposition'), /attachment; filename="special-study-expenses-\d{4}-\d{2}-\d{2}\.csv"/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const rows = buf.toString('utf8').slice(1).trim().split('\r\n');
    assert.equal(rows[0], '日期,項目,類別,學校,金額');
    // 輔大（已報名，報名費 600）是自動的那一筆
    assert.deepEqual(rows.slice(1), ['2026-10-01,"掛號, ""限時""",郵寄,,80', rows[2], '2026-11-13,高鐵 台北→台南,交通,輔大,1490']);
    assert.match(rows[2], /^\d{4}-\d{2}-\d{2},報名費,報名費,輔大,600$/);
  } finally { await stop(s); }
});

test('CSV：開頭是 = + - @ 的文字前面加 \'（試算表才不會當公式）；金額還是數字；項目空白用類別', async t => {
  const v2 = {...V2, apps: V2.apps.map(a => a.id === 'fj' ? {...a, notes: '- 帶准考證'} : a)};
  const dir = makeDir(v2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    await putExp(s, 'e1', {date: '2026-10-02', amount: 5, what: '-退票', cat: 'other'});
    await putExp(s, 'e2', {date: '2026-10-03', amount: 2, what: '=HYPERLINK("http://x","a")', cat: 'other'});
    await putExp(s, 'e3', {date: '2026-10-04', amount: 3, what: '+1 加洗', cat: 'print', school: '@某大'});
    const blank = await putExp(s, 'e4', {date: '2026-10-05', amount: 4, what: '   ', cat: 'stay'});
    assert.deepEqual([blank.status, blank.data.what], [200, '住宿'], '項目空白：用類別');
    const rows = (await get(s, '/api/expenses.csv')).body.replace(/^﻿/, '').trim().split('\r\n');
    for (const r of ["2026-10-02,'-退票,其他,,5", '2026-10-03,"\'=HYPERLINK(""http://x"",""a"")",其他,,2', "2026-10-04,'+1 加洗,影印・證件,'@某大,3", '2026-10-05,住宿,住宿,,4']) assert.ok(rows.includes(r), `${r}\n${rows.join('\n')}`);
    assert.ok(rows.some(r => /,報名費,報名費,輔大,600$/.test(r)), '金額不加 \'');
    // 總表的筆記也一樣（「- 帶准考證」是條列，不是公式）
    const table = (await get(s, '/api/table.csv')).body;
    assert.match(table, /,'- 帶准考證\r\n/);
    assert.doesNotMatch(table, /,- 帶准考證/);
  } finally { await stop(s); }
});

test('花費：匯出、匯入（依 id 合併，壞的略過）、備份都帶著；?dry=1 回報筆數', async t => {
  const dir = makeDir(V2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    await putExp(s, 'e1', E1);
    await putExp(s, 'e2', {...E1, what: '住宿', cat: 'stay', amount: 1800});
    const exp = JSON.parse((await get(s, '/api/export')).body);
    assert.deepEqual(exp.expenses.map(e => e.id), ['e1', 'e2']);
    // 備份檔：每日備份是寫入前的磁碟檔；匯入前的備份有現在的花費
    const imp = {apps: exp.apps, expenses: [{...exp.expenses[0], amount: 999, rev: 1}, {id: 'e9', date: '2026-12-01', amount: 50, what: '影印', cat: 'print'}, {id: 'bad', date: 'x', amount: 1}, 'junk']};
    const dry = await json(s, '/api/import?dry=1', {method: 'POST', headers: W, body: JSON.stringify(imp)});
    assert.deepEqual(dry.data, {apps: 2, replace: 2, expenses: 2});
    const r = await json(s, '/api/import', {method: 'POST', headers: W, body: JSON.stringify(imp)});
    assert.deepEqual(r.data, {imported: 2, replaced: 2, expenses: 2});
    const pre = backups(dir).find(f => f.startsWith('records-before-import-'));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'backups', pre), 'utf8')).expenses.map(e => [e.id, e.amount]), [['e1', 1490], ['e2', 1800]]);
    const got = (await json(s, '/api/records')).data.expenses;
    assert.deepEqual(got.map(e => [e.id, e.amount]), [['e1', 999], ['e2', 1800], ['e9', 50]]);
    assert.equal(got[0].rev, 2, '版本號接著伺服器的往上加');
    assert.equal(got[2].rev, 1);
    // 沒有花費的舊備份：花費不動
    assert.equal((await json(s, '/api/import', {method: 'POST', headers: W, body: JSON.stringify({apps: exp.apps})})).status, 200);
    assert.equal((await json(s, '/api/records')).data.expenses.length, 3);
  } finally { await stop(s); }
});

test('匯入等備份的時候，別的分頁存好（回 200／204）的花費、學校、刪除都還在', async t => {
  const dir = makeDir(V2);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const s = await start(dir);
  try {
    for (let k = 0; k < 60; k++) await putExp(s, `x${k}`, E1);
    // 匯入還沒回來之前一直有人在存：一定有幾個落在它等備份的那段時間
    let busy = true;
    const imp = json(s, '/api/import', {method: 'POST', headers: W, body: JSON.stringify({apps: [], expenses: [{id: 'i1', date: '2026-12-01', amount: 50, what: '影印', cat: 'print'}]})}).finally(() => { busy = false; });
    const done = [];
    const lane = async (op, n) => { for (let k = 0; busy && k < 15; k++) {
      const id = `${op}${n}-${k}`, x = `x${n * 15 + k}`;
      if (op === 'e') done.push([op, id, (await putExp(s, id, E1)).status]);
      if (op === 'a') done.push([op, id, (await json(s, `/api/apps/${id}`, {method: 'PUT', headers: W, body: JSON.stringify({school: '測試', v: 3, color: 0, dates: [], docs: [], regSteps: []})})).status]);
      if (op === 'd') done.push([op, x, (await json(s, `/api/expenses/${x}`, {method: 'DELETE', headers: W})).status]);
    } };
    const [r] = await Promise.all([imp, ...[0, 1, 2, 3].flatMap(n => [lane('e', n), lane('a', n), lane('d', n)])]);
    assert.equal(r.status, 200);
    const rec = (await json(s, '/api/records')).data, exps = new Set(rec.expenses.map(e => e.id)), apps = new Set(rec.apps.map(a => a.id));
    assert.ok(exps.has('i1'));
    for (const [op, id, st] of done) {
      if (op === 'e' && st === 200) assert.ok(exps.has(id), `${id} 存好了卻不見`);
      if (op === 'a' && st === 200) assert.ok(apps.has(id), `${id} 存好了卻不見`);
      if (op === 'd' && st === 204) assert.ok(!exps.has(id), `${id} 刪掉了又回來`);
    }
  } finally { await stop(s); }
});

test('花費：啟動時的遷移不碰它；沒有 expenses 的 v3 檔載入是 []、不會寫檔', async t => {
  // v2 檔裡已經有花費（例如手動加的，還有不認得的欄位）：遷移照樣跑，花費原樣留著
  const withExp = {...structuredClone(V2), expenses: [{id: 'k1', date: '2026-11-01', amount: 30, what: '影印', cat: 'print', appId: 'tp', school: '北市大', rev: 1, createdAt: 1, note: '自己加的欄位'}]};
  const dir = makeDir(withExp);
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  let s = await start(dir);
  try {
    assert.equal(backups(dir).filter(f => f.startsWith('records-before-migrate-')).length, 1);
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'records.json'), 'utf8'));
    assert.ok(disk.apps.every(a => a.v === 3));
    assert.deepEqual(disk.expenses, withExp.expenses);
  } finally { await stop(s); }
  // 拿掉 expenses 這個欄位（還沒有花費功能時的 v3 檔）：重開不遷移、不寫檔，API 給 []
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'records.json'), 'utf8'));
  delete disk.expenses;
  const text = JSON.stringify(disk, null, 2) + '\n';
  fs.writeFileSync(path.join(dir, 'records.json'), text);
  s = await start(dir);
  try {
    assert.deepEqual((await json(s, '/api/records')).data.expenses, []);
    assert.equal(fs.readFileSync(path.join(dir, 'records.json'), 'utf8'), text, '不寫檔');
    assert.equal((await get(s, '/api/expenses.csv')).status, 200);
    // 第一次記一筆才寫進去
    assert.equal((await putExp(s, 'n1', E1)).status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'records.json'), 'utf8')).expenses.map(e => e.id), ['n1']);
  } finally { await stop(s); }
});
