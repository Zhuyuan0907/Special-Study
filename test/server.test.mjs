// 伺服器整合測試：在暫存資料夾開一台伺服器（DATA_DIR），測遷移備份、409、壞檔救回、/data 白名單、.ics、同步、匯入。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
    assert.deepEqual(Object.keys(disk), ['version', 'apps', 'todos', 'profile', 'notifyLastSent', 'updatedAt', 'brochureHash', 'syncLog']);
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
    assert.match(ics.body, /SUMMARY:市北 /);
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
  // 市北放榜改到 12/05、報到改 15:00（自己改過 10:00，要留著）
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
    assert.deepEqual(dry.data, {apps: 3, replace: 2});
    assert.equal(backups(dir).filter(f => f.startsWith('records-before-import-')).length, 0);
    const r = await json(s, '/api/import', {method: 'POST', headers: W, body: JSON.stringify({...old, profile: {tags: ['ais3']}})});
    assert.deepEqual(r.data, {imported: 3, replaced: 2});
    assert.equal(backups(dir).filter(f => f.startsWith('records-before-import-')).length, 1);
    const {data} = await json(s, '/api/records');
    assert.equal(data.apps.length, 3);
    assert.ok(data.apps.every(a => a.v === 3));
    assert.equal(data.apps.find(a => a.id === 'tp').rev, 2);
    assert.equal(data.apps.find(a => a.id === 'fc').dates.length, 9);
    assert.deepEqual(data.profile.tags, ['ais3']);
  } finally { await stop(s); }
});
