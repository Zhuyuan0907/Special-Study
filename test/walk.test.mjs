// 第一次使用的走查（W33-1–W33-11）找到的問題：logic.js 這一側的回歸測試。畫面那一側（不去的樣子、時間欄、還原的名稱…）在驗收腳本裡測。
// 用 11/02 重建、併了 overrides 的新簡章（PROGS2）和真實紀錄的遷移＋同步結果，和伺服器啟動時一樣。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../public/js/logic.js';
import {PROGS2, OPTS, realRecords, uidSeq, migrateRecords, bySchool, set} from './helpers.mjs';

const real = realRecords();
const SKIP = real ? false : '找不到真實紀錄的 v2 副本（設 RECORDS_FIXTURE）';
const sync = apps => apps.map(a => L.syncApp(a, PROGS2.get(a.programId), '2026-11-02T13:00', {uid: uidSeq('s'), syncId: 'S1'}));
const synced = real ? sync(migrateRecords(real.apps, PROGS2)) : [];
const apps = synced.map(r => r.app), changes = synced.flatMap(r => r.changes);
const S = s => bySchool(apps, s);
const P = a => PROGS2.get(a.programId);

/* ---------- W33-2 備取意願、印准考證的鐘點 ---------- */
test('W33-2 填遞補意願保留 16:00：15:00 還沒逾期，16:01 逾期；印准考證開放後到考試日都勾得到', {skip: SKIP}, () => {
  const tp = set(S('市北'), {status: 'waitlist', waitNo: 5});
  const r = at => L.agenda([tp], PROGS2, at, OPTS).rows.find(x => x.role === 'intent');
  assert.equal(r('2026-12-11T15:00').time, '16:00');
  assert.equal(r('2026-12-11T15:00').overdue, false);
  assert.equal(r('2026-12-11T16:01').overdue, true);
  // 成大：准考證 11/11 16:00 開放列印，是到 11/14 上機考試的範圍（L9）：時間寫在「起」，勾一直在
  const ck = S('成大');
  const t = at => L.agenda([ck], PROGS2, at, OPTS).rows.find(x => x.role === 'ticket');
  for (const at of ['2026-11-11T12:00', '2026-11-11T16:01', '2026-11-12T09:00']) {
    const row = t(at);
    assert.equal(`${row.from} ${row.fromTime}`, '2026-11-11 16:00', at);
    assert.equal(row.parts.length, 1, at);
    assert.equal(row.overdue, false, at);
  }
});

/* ---------- W33-4 時程的「下一個」不會是已經做完的列 ---------- */
test('W33-4 興大勾完報名・繳費・繳件：11/09 兩列算做完，下一個是之後的里程碑；和下一步一樣不會是做完的', {skip: SKIP}, () => {
  const now = '2026-11-02T10:00', xd = S('興大');
  const before = L.timeline(xd, P(xd), now, {apps: [xd], programs: PROGS2});
  assert.equal(before.find(r => r.next).role, 'reg', '還沒勾：下一個是報名');
  let b = xd;
  for (const key of ['reg', 'pay', 'docs']) b = L.applyAction(b, 'tick', {key, done: true}, {now, program: P(xd)});
  assert.equal(b.status, 'applied');
  const tl = L.timeline(b, P(b), now, {apps: [b], programs: PROGS2});
  const regs = tl.filter(r => r.role === 'reg' && r.date === '2026-11-09');
  assert.equal(regs.length, 2);
  assert.ok(regs.every(r => r.done && !r.next), '11/09 的報名列都做完了');
  const nx = tl.find(r => r.next);
  assert.ok(nx && !nx.done && nx.date > '2026-11-09', JSON.stringify(nx && [nx.date, nx.label]));
  const step = L.nextStep(b, P(b), now, {apps: [b], programs: PROGS2});
  assert.ok(step && step.role !== 'reg', '下一步也不是報名');
  // 已報到：報到那一列做完了，不是下一個
  const held = set(b, {status: 'admitted', confirmDone: true});
  const tl2 = L.timeline(held, P(held), '2026-12-20T10:00', {apps: [held], programs: PROGS2});
  assert.ok(tl2.find(r => r.role === 'confirm').done);
  assert.ok(!tl2.some(r => r.next && r.role === 'confirm'));
  // 名單回答了（待面試）：名單那一列做完了
  const iv = set(b, {status: 'interview'});
  assert.ok(L.timeline(iv, P(iv), '2026-11-30T12:00', {apps: [iv], programs: PROGS2}).find(r => r.role === 'stage1').done);
});

/* ---------- W33-6 簡章更新提示寫最要緊的一項 ---------- */
test('W33-6 簡章更新的提示：第一次同步寫「逢甲 報名截止 11/19 → 11/18 23:59」，不是輔大的複查', {skip: SKIP}, () => {
  assert.ok(changes.length > 5);
  assert.ok(changes.every(c => c.doc || c.kind), '每一項日期改動都帶 kind');
  assert.ok(changes.every(c => c.from !== c.to), '沒有前後一樣的');
  const c = L.syncHeadline(changes);
  assert.deepEqual([c.school, c.what, c.from, c.to], ['逢甲大學', '報名截止', '11/19', '11/18 23:59']);
  // 舊的 syncLog 沒有 kind：從名稱反查，結果一樣
  const old = changes.map(({kind, ...x}) => x);
  assert.equal(L.syncHeadline(old).school, '逢甲大學');
  // 沒有要做的事提早：面試、名單、放榜排在複查、成績前面；備審最後
  const pick = L.syncHeadline([
    {school: 'A', what: '成績複查申請截止', from: '11/25 16:30', to: '11/25', kind: 'review'},
    {school: 'B', what: '備審', from: '', to: '自傳', doc: true},
    {school: 'C', what: '放榜', from: '12/21', to: '12/21 17:00', kind: 'release'},
  ]);
  assert.equal(pick.school, 'C');
  // 報名類提早的排在報到、放棄提早的前面
  assert.equal(L.syncHeadline([{school: 'G', what: '放棄截止', from: '03/03', to: '03/03 12:00', kind: 'giveup'}, {school: 'P', what: '繳費截止', from: '11/10 15:00', to: '11/10 14:00', kind: 'pay'}]).school, 'P');
});

/* ---------- W33-8 備審短名稱不切在詞中間 ---------- */
test('W33-8 備審短名稱：不切在詞的中間，小型括號、︰也算斷點，還是 12 字寬內', () => {
  assert.equal(L.shortDoc('其他有助於書面審查之資料影本'), '其他有助於書面審查資料');
  assert.equal(L.shortDoc('高中（職）歷年在校成績證明﹙無高中在學成績者，得以其他成績證明取代，並於成績證明內敘明理由）'), '高中歷年在校成績證明');
  assert.equal(L.shortDoc('在校成績︰高中已修畢學期之成績'), '在校成績');
  const width = s => [...s].reduce((n, ch) => n + (/\s/.test(ch) ? 0 : ch.charCodeAt(0) < 0x2e80 ? 0.5 : 1), 0);
  for (const p of PROGS2.values()) for (const d of p.docs || []) { const s = L.shortDoc(d); assert.ok(width(s) <= 12, s); assert.ok(s.length >= 2, d); assert.ok(!/﹙|︰/.test(s), s); }
});

/* ---------- W33-10 灰色的面試列說得出為什麼 ---------- */
test('W33-10 已報名、還要等名單的面試／考試：畫淡，右欄寫「11/07 名單公布後才確定」', {skip: SKIP}, () => {
  const ck = S('成大');
  const row = L.agenda(apps, PROGS2, '2026-11-02T12:00', OPTS).rows.find(r => r.appId === ck.id && r.role === 'go');
  assert.equal(row.tentative, true);
  assert.equal(row.context, '11/07 名單公布後才確定');
  // 回答在名單上之後就確定了
  const iv = set(ck, {status: 'interview'});
  const r2 = L.agenda([iv], PROGS2, '2026-11-08T12:00', OPTS).rows.find(r => r.role === 'go');
  assert.ok(!r2.tentative && !r2.context);
  // 沒有篩選名單的學校（輔大 scr:false）不畫淡
  const fj = S('輔大');
  const r3 = L.agenda([fj], PROGS2, '2026-11-02T12:00', OPTS).rows.find(r => r.role === 'go');
  assert.ok(r3 && !r3.tentative && !r3.context);
});
