// 花費（DESIGN §12）：自動的報名費、合計、猜類別、猜學校、金額與整筆的檢查。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../public/js/logic.js';
import {PROGS2, OPTS, realRecords, migrateRecords, bySchool, set, replaceApp} from './helpers.mjs';

const real = realRecords();
const SKIP = real ? false : '找不到真實紀錄的 v2 副本（設 RECORDS_FIXTURE）';
const apps0 = real ? migrateRecords(real.apps, PROGS2) : [];
const S = short => bySchool(apps0, short);
const lines = (apps, exps = []) => L.expenseLines(apps, exps, PROGS2, OPTS);
const exp = (id, patch = {}) => ({id, date: '2026-11-06', amount: 100, what: '項目', cat: 'other', appId: '', school: '', rev: 1, createdAt: 1, ...patch});

test('猜類別：交通、住宿、郵寄、影印・證件，其他', () => {
  const cases = {'高鐵 台北→台中': 'travel', '臺鐵自強號': 'travel', '計程車去郵局': 'travel', '捷運': 'travel', '機票': 'travel', '油錢': 'travel', '客運': 'travel',
    '台南住宿': 'stay', '飯店一晚': 'stay', '旅館': 'stay', '掛號郵寄備審': 'mail', '快遞': 'mail', '郵票': 'mail', '影印備審': 'print', '列印准考證': 'print', '證件照': 'print', '大頭照片': 'print',
    '晚餐': 'other', '': 'other', '輔大報名費': 'reg'};
  for (const [w, c] of Object.entries(cases)) assert.equal(L.guessCat(w), c, w);
  assert.deepEqual(L.CATS, ['reg', 'travel', 'stay', 'mail', 'print', 'other']);
  assert.deepEqual(L.CATS.map(k => L.CAT_LABEL[k]), ['報名費', '交通', '住宿', '郵寄', '影印・證件', '其他']);
});

test('金額：整數元 0 到 1,000,000；千分位、元、全形數字都看得懂', () => {
  for (const [v, n] of [[1490, 1490], ['1490', 1490], ['1,490', 1490], ['1490 元', 1490], ['NT$1490', 1490], ['１４９０', 1490], [0, 0], ['0', 0], ['1,000,000', 1000000]]) assert.equal(L.parseAmount(v), n, String(v));
  for (const v of ['', ' ', '-1', -1, 1.5, '1.5', '12a', 'abc', 1000001, '1000001', null, undefined, NaN, '1e3']) assert.equal(L.parseAmount(v), null, String(v));
});

test('checkExpense：只留認得的欄位；不對的回 error', () => {
  const ok = L.checkExpense({id: 'x1', date: '2026-11-06', amount: '1,490', what: ' 高鐵 ', appId: 'a1', school: '成大', rev: 3, createdAt: 99, extra: 'drop me', derived: true});
  assert.deepEqual(ok.entry, {id: 'x1', date: '2026-11-06', amount: 1490, what: '高鐵', cat: 'travel', appId: 'a1', school: '成大', rev: 3, createdAt: 99});
  // 沒寫項目：用類別當項目（表單一定要有項目；不丟掉，金額才不會從合計消失）
  assert.equal(L.checkExpense({id: 'x', date: '2026-11-06', amount: 1, cat: 'stay'}).entry.what, '住宿');
  assert.deepEqual(['', '   ', null, undefined].map(what => L.checkExpense({id: 'x', date: '2026-11-06', amount: 1, what}).entry).map(e => [e.what, e.cat]), [['其他', 'other'], ['其他', 'other'], ['其他', 'other'], ['其他', 'other']]);
  const bad = [
    [{id: 'x', date: '2026-02-30', amount: 1}, /日期/], [{id: 'x', date: '11/06', amount: 1}, /日期/], [{id: 'x', amount: 1}, /日期/],
    [{id: 'x', date: '2026-11-06', amount: -1}, /金額/], [{id: 'x', date: '2026-11-06', amount: 2.5}, /金額/], [{id: 'x', date: '2026-11-06', amount: 1000001}, /金額/], [{id: 'x', date: '2026-11-06'}, /金額/],
    [{id: 'x', date: '2026-11-06', amount: 1, what: 'a'.repeat(61)}, /60/], [{id: 'x', date: '2026-11-06', amount: 1, what: 5}, /項目/],
    [{id: 'x', date: '2026-11-06', amount: 1, cat: 'food'}, /類別/], [{id: 'x/../y', date: '2026-11-06', amount: 1}, /id/], [{id: 'x', date: '2026-11-06', amount: 1, appId: 'a b'}, /id/],
    [null, /格式/], [[], /格式/],
  ];
  for (const [e, re] of bad) assert.match(L.checkExpense(e).error || '', re, JSON.stringify(e));
  assert.ok(L.checkExpense({id: 'x', date: '2026-11-06', amount: 1, what: '字'.repeat(60)}).entry, '60 個字可以');
});

test('自動的報名費：真實紀錄遷移後是 輔大 900、成大 800；北市大勾了繳費才有 600', {skip: SKIP}, () => {
  const ls = lines(apps0);
  assert.deepEqual(ls.map(l => [l.school, l.amount, l.what, l.cat, l.derived]), [['輔大', 900, '報名費', 'reg', true], ['成大', 800, '報名費', 'reg', true]]);
  assert.ok(ls.every(l => L.isKey(l.date) && l.id === 'fee:' + l.appId));
  assert.deepEqual(L.expenseTotals(ls).total, 1700);
  // 北市大：報名勾了（準備中），繳費沒勾 → 沒有；勾了繳費 → 600，日期是繳費那一列的截止日
  const tp = S('北市大'), p = PROGS2.get(tp.programId);
  assert.equal(tp.status, 'prep');
  assert.ok(tp.regSteps.some(s => s.key === 'reg' && s.done));
  const paid = L.applyAction(tp, 'tick', {key: 'pay', done: true}, {program: p});
  assert.equal(paid.status, 'prep', '還有郵寄沒勾');
  const l2 = lines(replaceApp(apps0, paid));
  const fee = l2.find(l => l.appId === tp.id);
  assert.deepEqual([fee.amount, fee.date, fee.school], [600, '2026-11-02', '北市大']);
  assert.equal(L.expenseTotals(l2).total, 2300);
});

test('報名費：沒有報名的不算、0 元（減免）照列、沒繳藏起來、學校刪掉就沒有', {skip: SKIP}, () => {
  const fj = S('輔大'), nk = S('成大');
  assert.ok(!lines(replaceApp(apps0, set(fj, {status: 'skipped'}))).some(l => l.appId === fj.id), '沒有報名');
  for (const st of ['applied', 'interview', 'waiting', 'admitted', 'waitlist', 'rejected', 'out']) assert.ok(lines(replaceApp(apps0, set(fj, {status: st}))).some(l => l.appId === fj.id), st);
  assert.ok(lines(replaceApp(apps0, set(fj, {status: 'admitted', confirmDone: true, giveupDone: true}))).some(l => l.appId === fj.id), '放棄了也繳過');
  const zero = lines(replaceApp(apps0, L.applyAction(fj, 'setFee', {fee: 0}, {})));
  assert.equal(zero.find(l => l.appId === fj.id).amount, 0);
  assert.equal(L.expenseTotals(zero).total, 800);
  const hidden = L.applyAction(fj, 'setFee', {hidden: true}, {});
  assert.equal(hidden.feeHidden, true);
  assert.ok(!lines(replaceApp(apps0, hidden)).some(l => l.appId === fj.id));
  assert.equal(L.applyAction(hidden, 'setFee', {hidden: false}, {}).feeHidden, undefined, '改回');
  assert.equal(L.applyAction(fj, 'setFee', {fee: 'abc'}, {}).fee, 900, '看不懂的金額不改');
  // 報名費不知道（手動加的學校）：一樣列出來，金額 0、標 unknown，讓人點進去填
  const unk = lines(replaceApp(apps0, set(fj, {fee: null}))).find(l => l.appId === fj.id);
  assert.deepEqual([unk.amount, unk.unknown], [0, true]);
  // 刪掉成大：自動的那一筆不見；自己記的留著，用記下時的名字
  const gone = apps0.filter(a => a.id !== nk.id);
  const ls = lines(gone, [exp('e1', {appId: nk.id, school: '成大', what: '高鐵', cat: 'travel', amount: 1490})]);
  assert.ok(!ls.some(l => l.id === 'fee:' + nk.id));
  assert.deepEqual(ls.filter(l => !l.derived).map(l => [l.school, l.appId, l.amount]), [['成大', nk.id, 1490]]);
  const t = L.expenseTotals(ls);
  assert.deepEqual(t.bySchool.map(s => [s.school, s.amount]), [['成大', 1490], ['輔大', 900]]);
});

test('每一行：新的在上面（日期，再來記下的時間）；學校名用現在的簡稱', {skip: SKIP}, () => {
  const fj = S('輔大');
  const ls = lines(apps0, [exp('a', {date: '2026-11-06', createdAt: 5}), exp('b', {date: '2026-11-06', createdAt: 9}), exp('c', {date: '2026-11-14', createdAt: 1, appId: fj.id, school: '舊名字'})]);
  assert.deepEqual(ls.map(l => l.id), ['c', 'b', 'a', 'fee:' + fj.id, 'fee:' + S('成大').id]);
  assert.equal(ls[0].school, '輔大');
  // 壞掉的資料也不會讓畫面壞掉
  assert.doesNotThrow(() => L.expenseLines(apps0, [null, 5, {id: 'z', amount: 'x', cat: 'nope'}], PROGS2, OPTS));
  const z = L.expenseLines([], [{id: 'z', amount: 'x', cat: 'nope'}]);
  assert.deepEqual([z[0].amount, z[0].cat, z[0].date], [0, 'other', '']);
});

test('合計：依類別六類都有、依學校多的在前、沒有指定學校放最後', () => {
  const ls = [
    {id: '1', amount: 600, cat: 'reg', appId: 'tp', school: '北市大'}, {id: '2', amount: 120, cat: 'mail', appId: 'tp', school: '北市大'},
    {id: '3', amount: 1490, cat: 'travel', appId: '', school: ''}, {id: '4', amount: 900, cat: 'reg', appId: 'fj', school: '輔大'},
    {id: '5', amount: 50, cat: 'print', appId: 'gone', school: '淡江'}, {id: '6', amount: 30, cat: 'weird', appId: '', school: ''},
  ];
  const t = L.expenseTotals(ls);
  assert.equal(t.total, 3190);
  assert.deepEqual(t.byCat, {reg: 1500, travel: 1490, stay: 0, mail: 120, print: 50, other: 30});
  assert.deepEqual(t.bySchool.map(s => [s.school, s.amount]), [['輔大', 900], ['北市大', 720], ['淡江', 50], ['', 1520]]);
  assert.deepEqual(L.expenseTotals([]), {total: 0, byCat: {reg: 0, travel: 0, stay: 0, mail: 0, print: 0, other: 0}, bySchool: []});
});

test('猜學校：前後一天內的面試／考試、郵寄，最近的；繳費不算；同一天兩間面試就不猜', {skip: SKIP}, () => {
  const id = short => S(short).id;
  assert.equal(L.guessSchool(apps0, PROGS2, '2026-11-14'), id('成大'), '上機考試當天');
  assert.equal(L.guessSchool(apps0, PROGS2, '2026-11-13'), id('成大'), '前一天');
  assert.equal(L.guessSchool(apps0, PROGS2, '2026-11-15'), id('成大'), '後一天');
  assert.equal(L.guessSchool(apps0, PROGS2, '2026-11-02'), id('北市大'), '北市大 郵寄');
  // 只有繳費截止的日子不猜（政大 11/10、宜大 11/11、淡江 11/16、逢甲 11/19）：那天記的午餐、影印多半跟那間無關
  for (const d of ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']) assert.equal(L.guessSchool(apps0, PROGS2, d), '', d + ' 只有繳費');
  assert.equal(L.guessSchool(apps0, PROGS2, '2026-11-06'), id('輔大'), '輔大 面試');
  assert.equal(L.guessSchool(apps0, PROGS2, '2026-12-04'), '', '逢甲、中興、高師大同一天面試');
  assert.equal(L.guessSchool(apps0, PROGS2, '2027-06-01'), '');
  assert.equal(L.guessSchool(apps0, PROGS2, ''), '');
  assert.equal(L.guessSchool(replaceApp(apps0, set(S('成大'), {ivSkip: true})), PROGS2, '2026-11-14'), '', '不去的考試不算');
  assert.equal(L.guessSchool(replaceApp(apps0, set(S('北市大'), {status: 'skipped'})), PROGS2, '2026-11-02'), '', '沒有報名的不算');
});
