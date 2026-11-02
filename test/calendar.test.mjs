// 行事曆（logic.calendarItems）：報名的時候就看得到面試在哪天、做完的不會消失、同校兩個系組併成一件、同天。
// 用 11/02 重建、併了 overrides 的新簡章（PROGS2）和真實紀錄的遷移＋同步結果；中教大兩組用 newApp 加。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../public/js/logic.js';
import {PROGS2, OPTS, realRecords, uidSeq, migrateRecords, bySchool, set, replaceApp} from './helpers.mjs';

const real = realRecords();
const SKIP = real ? false : '找不到真實紀錄的 v2 副本（設 RECORDS_FIXTURE）';
const sync = apps => apps.map(a => L.syncApp(a, PROGS2.get(a.programId), '2026-11-02T13:00', {uid: uidSeq('s'), syncId: 'S1'}).app);
const base = real ? sync(migrateRecords(real.apps, PROGS2)) : [];
const S = s => bySchool(base, s);
const cal = (apps, now) => L.calendarItems(apps, PROGS2, now, OPTS);
const of = (r, app) => r.items.filter(i => i.appIds.includes(app.id));

test('準備中的學校：報名是要做的，名單、面試、放榜也畫出來（還沒到，淡）；面試寫「名單公布後才確定」', {skip: SKIP}, () => {
  const xd = S('中興');
  assert.equal(xd.status, 'prep');
  const items = of(cal(base, '2026-11-03T12:00'), xd);
  const reg = items.find(i => i.role === 'reg');
  assert.equal(reg.state, 'now');
  assert.equal(reg.date, '2026-11-09');
  const go = items.find(i => i.role === 'go');
  assert.equal(go.state, 'later');
  assert.equal(go.date, '2026-12-04');
  assert.equal(go.context, '11/30 名單公布後才確定');
  assert.ok(items.some(i => i.role === 'stage1' && i.state === 'later'));
  assert.ok(items.some(i => i.role === 'release' && i.state === 'later'));
  // 複查、報到、放棄這些之後的事不畫（太多，到了那個階段接下來會有）
  assert.ok(!items.some(i => ['confirm', 'giveup', 'info'].includes(i.role)));
});

test('做完的、過去的不會從行事曆消失（灰）；接下來沒有它', {skip: SKIP}, () => {
  const now = '2026-11-03T12:00', xd = S('中興'), p = PROGS2.get(xd.programId);
  let b = xd;
  for (const key of ['reg', 'pay', 'docs']) b = L.applyAction(b, 'tick', {key, done: true}, {now, program: p});
  const apps = replaceApp(base, b);
  assert.ok(!L.agenda(apps, PROGS2, now, OPTS).rows.some(r => r.appId === xd.id && r.role === 'reg'), '接下來：勾完就不在了');
  const reg = of(cal(apps, now), xd).find(i => i.role === 'reg');
  assert.equal(reg.state, 'done');
  assert.equal(reg.date, '2026-11-09');
  // 面試日過了：還是畫在那天，灰
  const after = of(cal(apps, '2026-12-05T09:00'), xd).find(i => i.role === 'go');
  assert.equal(after.state, 'done');
});

test('沒有報名的學校不畫；不去面試的面試不畫；沒錄取的只留過去的', {skip: SKIP}, () => {
  const now = '2026-11-03T12:00', xd = S('中興');
  assert.equal(of(cal(replaceApp(base, set(xd, {status: 'skipped'})), now), xd).length, 0);
  const iv = set(xd, {status: 'interview', ivSkip: true});
  assert.ok(!of(cal(replaceApp(base, iv), now), iv).some(i => i.role === 'go'));
  const out = set(xd, {status: 'out'});
  const items = of(cal(replaceApp(base, out), '2026-12-01T12:00'), out);
  assert.ok(items.length > 0);
  assert.ok(items.every(i => i.state === 'done'), items.map(i => i.role + ':' + i.state).join());
});

test('同一間學校的兩個系組、同一天同一個時間的同一件事併成一件，名字只寫學校', () => {
  const now = '2026-11-03T12:00';
  const a = L.newApp(PROGS2.get('116-027-003'), {apps: [], nowMs: 1});
  const b = L.newApp(PROGS2.get('116-027-004'), {apps: [a], nowMs: 2});
  const {items} = cal([a, b], now);
  const reg = items.filter(i => i.role === 'reg' && i.date === '2026-11-16');
  assert.equal(reg.length, 1);
  assert.deepEqual(reg[0].appIds, [a.id, b.id]);
  assert.equal(reg[0].name, '中教大');
  assert.equal(reg[0].time, '23:59');
  // 只勾了其中一組：分開畫，各寫系
  const a2 = L.applyAction(a, 'tick', {key: 'reg', done: true}, {now, program: PROGS2.get(a.programId)});
  const two = cal([a2, b], now).items.filter(i => i.role === 'reg' && i.date === '2026-11-16');
  assert.equal(two.length, 2);
  assert.deepEqual(two.map(i => i.name).sort(), ['中教大 資工', '中教大 資工・資安外加']);
});

test('同天：不同學校的面試在同一天（準備中的也算），同一間學校兩個系組不算', {skip: SKIP}, () => {
  const {clashDays} = cal(base, '2026-11-03T12:00');
  assert.ok(clashDays.has('2026-12-04'));
  for (const s of ['中興', '高師大', '逢甲']) assert.ok(clashDays.get('2026-12-04').includes(s), s);
  const a = L.newApp(PROGS2.get('116-027-003'), {apps: [], nowMs: 1});
  const b = L.newApp(PROGS2.get('116-027-004'), {apps: [a], nowMs: 2});
  assert.equal(cal([a, b], '2026-11-03T12:00').clashDays.size, 0);
});

test('排序和接下來一樣：日期、沒有時間的在前、再來時間', {skip: SKIP}, () => {
  const {items} = cal(base, '2026-11-03T12:00');
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].sortKey <= items[i].sortKey, items[i].key);
  const d = items.filter(i => i.date === '2026-12-04');
  assert.equal(d[d.length - 1].time, '09:00', '宜大 09:00 在沒有時間的後面');
});
