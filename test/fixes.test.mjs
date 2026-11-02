// 修正的回歸測試（審查找到的 L1–L11、DS4，和新簡章資料的 D-a–D-d）。
// PROGS 是 11/01 的舊簡章，PROGS2 是 11/02 重建、併了 overrides 的新簡章（test/fixtures/programs-1102.json）。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../public/js/logic.js';
import {PROGS, PROGS2, OPTS, realRecords, uidSeq, migrateRecords, bySchool, withProgram, set, replaceApp} from './helpers.mjs';

const real = realRecords();
const SKIP = real ? false : '找不到真實紀錄的 v2 副本（設 RECORDS_FIXTURE）';
const apps0 = real ? migrateRecords(real.apps) : [];
const S = short => bySchool(apps0, short);
const ids = (rows, short, apps = apps0) => rows.filter(r => r.appId === bySchool(apps, short).id);
const short = (apps, id) => L.shortSchool(apps.find(a => a.id === id).school, OPTS.aliases);
// 新簡章：遷移＋第一次同步（跟伺服器啟動時一樣）
const syncAll = (apps, progs, now = '2026-11-02T13:00', opts = {}) => {
  const changes = [];
  const out = apps.map(a => { const r = L.syncApp(a, progs.get(a.programId), now, {uid: uidSeq('s'), ...opts}); changes.push(...r.changes); return r.app; });
  return {apps: out, changes};
};
const fresh = real ? syncAll(migrateRecords(real.apps, PROGS2), PROGS2, '2026-11-02T13:00', {syncId: 'S1'}) : {apps: [], changes: []};
const apps2 = fresh.apps;
const S2 = s => bySchool(apps2, s);
const P2 = s => PROGS2.get(S2(s).programId);

/* ---------- L1 有報名只勾已經過了的部分 ---------- */
test('L1 有報名：只勾已經過了的部分，還沒到期的留在接下來', {skip: SKIP}, () => {
  const now = '2026-11-10T13:00', a = S('政大');
  const b = L.applyAction(a, 'registered', {}, {program: PROGS.get(a.programId), now});
  assert.equal(b.status, 'applied');
  assert.deepEqual(b.regSteps.filter(s => s.done).map(s => s.key), ['reg']);
  const row = ids(L.agenda(replaceApp(apps0, b), PROGS, now, OPTS).rows, '政大')[0];
  assert.equal(row.question, undefined);
  assert.deepEqual(row.parts.filter(p => !p.done).map(p => p.name), ['繳費', '繳件']);
  assert.equal(row.time, '15:00', '列的時間跟著還沒勾的部分（L8）');
  assert.deepEqual(row.parts.map(p => `${p.name}:${p.own}`), ['報名:12:00', '繳費:', '繳件:17:00']);
  const k = S('高師大'), now2 = '2026-11-10T09:00';
  const c = L.applyAction(k, 'registered', {}, {program: PROGS.get(k.programId), now: now2});
  assert.deepEqual(c.regSteps.filter(s => s.done).map(s => s.key).sort(), ['pay', 'reg']);
  assert.deepEqual(ids(L.agenda(replaceApp(apps0, c), PROGS, now2, OPTS).rows, '高師大').filter(r => r.role === 'reg').map(r => `${r.date} ${r.label}`), ['2026-11-10 上傳備審']);
  // 沒給 now（舊的呼叫方式）：全勾
  const all = L.applyAction(k, 'registered', {}, {program: PROGS.get(k.programId)});
  assert.deepEqual(all.regSteps.filter(s => s.done).map(s => s.key).sort(), ['docs', 'pay', 'reg']);
});

/* ---------- L2 衝突與還原 ---------- */
test('L2 自己改的剛好就是簡章的新值：不算衝突；真的衝突時還原回到簡章現在的值', {skip: SKIP}, () => {
  const fc = S('逢甲'), s1 = fc.dates.find(d => d.kind === 'stage1');
  const mine = L.applyAction(fc, 'editDate', {rowId: s1.id, date: '2026-11-30', time: '14:00'});
  assert.ok(L.isEdited(mine.dates.find(d => d.id === s1.id)));
  const progs = withProgram(fc.programId, p => { p.ev = p.ev.map(e => e[0] === 'stage1' ? ['stage1', '2026-11-30', '', '14:00', '', e[5], ''] : e); });
  const r = L.syncApp(mine, progs.get(fc.programId), '2026-11-02T13:00');
  assert.deepEqual(r.changes, []);
  const d = r.app.dates.find(x => x.id === s1.id);
  assert.ok(!L.isEdited(d));
  assert.equal(d.brochureNow, undefined);
  assert.notEqual(r.app, mine, '基準更新了要寫回');
  // 真的衝突：北市大報到 自己改 17:00，簡章改到 12/12 16:00
  const tp = S('北市大'), cf = tp.dates.find(x => x.kind === 'confirm');
  const ed = L.applyAction(tp, 'editDate', {rowId: cf.id, time: '17:00'});
  const p2 = withProgram(tp.programId, p => { p.ev = p.ev.map(e => e[0] === 'confirm' ? ['confirm', '2026-12-12', '', '16:00', '', e[5], ''] : e); });
  const r2 = L.syncApp(ed, p2.get(tp.programId), '2026-11-02T13:00');
  const c2 = r2.app.dates.find(x => x.id === cf.id);
  assert.deepEqual([c2.date, c2.time, c2.brochureNow.date], ['2026-12-11', '17:00', '2026-12-12']);
  assert.equal(r2.changes.filter(c => c.conflict).length, 1);
  assert.deepEqual(L.syncApp(r2.app, p2.get(tp.programId), '2026-11-02T14:00').changes, [], '同一份簡章不再報');
  const back = L.applyAction(r2.app, 'restoreDate', {rowId: cf.id}).dates.find(x => x.id === cf.id);
  assert.deepEqual([back.date, back.time, back.brochureNow, L.isEdited(back)], ['2026-12-12', '16:00', null, false]);
});

/* ---------- L3 意願、准考證的鐘點 ---------- */
test('L3 填遞補意願的列有鐘點：過了鐘點才算逾期，.ics 也有鐘點', {skip: SKIP}, () => {
  const tp = set(S('北市大'), {status: 'waitlist'});
  const at = now => ids(L.agenda([tp], PROGS, now, OPTS).rows, '北市大', [tp]).find(r => r.role === 'intent');
  const r15 = at('2026-12-11T15:00');
  assert.deepEqual([r15.time, L.timeText(r15, '2026-12-11T15:00'), r15.overdue], ['16:00', '16:00', false]);
  assert.equal(at('2026-12-11T17:00').overdue, true);
  const zz = set(S('政大'), {status: 'waitlist'});
  const z = ids(L.agenda([zz], PROGS, '2027-01-04T18:00', OPTS).rows, '政大', [zz]).find(r => r.role === 'intent');
  assert.deepEqual([z.date, z.time, z.overdue], ['2027-01-04', '17:00', true]);
});

/* ---------- L4 ＋新增日期猜種類 ---------- */
test('L4 新增日期從名稱猜種類：面試、放榜、報到會上接下來，也算撞期', () => {
  assert.equal(L.guessKind('面試'), 'interview');
  assert.equal(L.guessKind('面試名單公布'), 'stage1');
  assert.equal(L.guessKind('已報到生放棄截止'), 'giveup');
  assert.equal(L.guessKind('寄發成績單（非放榜）'), 'score');
  assert.equal(L.guessKind('報到截止'), 'confirm');
  assert.equal(L.guessKind('列印准考證'), 'other');
  assert.equal(L.guessKind('作品集面談'), 'interview');
  assert.equal(L.guessKind('隨便寫'), 'other');
  const uid = uidSeq('m');
  let a = L.blankApp({school: '某大學', dept: '資工', date: '2026-11-10', time: '17:00'}, {uid, nowMs: 1});
  a = L.applyAction(a, 'registered', {}, {now: '2026-11-11T00:00'});
  for (const [label, date, time] of [['面試', '2026-12-05', '10:00'], ['放榜', '2026-12-20', ''], ['一階名單公布', '2026-11-28', ''], ['報到截止', '2026-12-25', '17:00'], ['列印准考證', '2026-12-01', '']]) a = L.applyAction(a, 'addDate', {label, date, time}, {uid});
  assert.deepEqual(a.dates.map(d => d.kind), ['reg', 'interview', 'release', 'stage1', 'confirm', 'other']);
  assert.deepEqual(L.eventsOf(a, null).map(e => e.role), ['reg', 'stage1', 'ticket', 'go', 'release', 'confirm']);
  const rows = L.agenda([a], new Map(), '2026-11-28T09:00', OPTS).rows;
  assert.deepEqual(rows.map(r => `${r.date} ${r.role} ${r.question || ''}`), ['2026-11-28 stage1 stage1', '2026-12-05 ticket ', '2026-12-05 go ', '2026-12-20 release ']);
  assert.ok(L.recordFields(a, null, '2026-11-28T09:00').some(f => f.key === 'ivTime'));
  const b = set(L.blankApp({school: '另一大學', dept: '資工', date: '2026-11-10'}, {uid, nowMs: 2}), {status: 'interview', dates: [{id: 'b1', kind: 'interview', date: '2026-12-05', time: '', end: '', from: '', fromTime: '', note: '面試', src: 'brochure', ref: 'interview|面試'}]});
  assert.deepEqual([...L.clashes([L.applyAction(a, 'passed'), b], new Map(), '2026-11-28T09:00').keys()], ['2026-12-05']);
  // 明白給了 kind 就用它
  assert.equal(L.applyAction(a, 'addDate', {label: '面試', date: '2026-12-06', kind: 'other'}, {uid}).dates.at(-1).kind, 'other');
});

/* ---------- L5 遞補公告沒回答就留著 ---------- */
test('L5 遞補公告沒回答就留著（逾期），回答「還沒」才不見；同校下一次遞補公告到了只問最新的', {skip: SKIP}, () => {
  const tp = set(S('北市大'), {status: 'waitlist'});
  const w = L.agenda([tp], PROGS, '2026-12-16T09:00', OPTS).rows.find(r => r.role === 'waitcheck');
  assert.ok(w, '12/15 的開始遞補 12/16 還在');
  assert.deepEqual([w.date, w.overdue, w.question], ['2026-12-15', true, 'promoted']);
  const no = L.applyAction(tp, 'notYet', w.actions.find(a => a.id === 'notYet').payload);
  assert.ok(!L.agenda([no], PROGS, '2026-12-16T09:00', OPTS).rows.some(r => r.role === 'waitcheck'));
  // 輔大（新簡章）11/30 和 12/03 兩次遞補公告：12/05 只問 12/03 那一次
  const fj = set(S2('輔大'), {status: 'waitlist', waitNo: 3});
  const ws = L.agenda([fj], PROGS2, '2026-12-05T09:00', OPTS).rows.filter(r => r.role === 'waitcheck');
  assert.deepEqual(ws.map(r => `${r.date} ${r.overdue}`), ['2026-12-03 true']);
  // 遞補上了 → 自己記的報到期限
  const up = L.applyAction(fj, 'promoted', {date: '2026-12-08', time: '12:00', id: 'p1'});
  assert.deepEqual(L.agenda([up], PROGS2, '2026-12-05T09:00', OPTS).rows.map(r => `${r.date} ${r.time} ${r.role} ${r.overdue}`), ['2026-12-08 12:00 confirm false']);
});

/* ---------- L6 按錯的不去面試改得回來 ---------- */
test('L6 狀態選單選一般狀態會清掉「不去面試」', {skip: SKIP}, () => {
  const cd = L.applyAction(S('成大'), 'skipInterview');
  const p = PROGS.get(cd.programId), now = '2026-11-20T12:00';
  assert.equal(L.statusWord(cd, p, now), '沒去面試');
  for (const s of ['interview', 'waiting', 'applied']) {
    const x = L.applyAction(cd, 'setStatus', {status: s});
    assert.equal(x.ivSkip, false);
    assert.notEqual(L.statusWord(x, p, now), '沒去面試', s);
    assert.ok(L.agenda([x], PROGS, now, OPTS).rows.some(r => r.role === 'release'), `${s}：放榜列回來了`);
  }
  // 面試前改回待面試：面試列和「不去」按鈕回來
  const y = L.applyAction(L.applyAction(S('成大'), 'skipInterview'), 'setStatus', {status: 'interview'});
  assert.ok(L.agenda([y], PROGS, '2026-11-04T12:00', OPTS).rows.some(r => r.role === 'go' && r.actions.some(a => a.id === 'skipInterview')));
});

/* ---------- L7 列名、附註變了 ---------- */
test('L7 同步：只改附註會寫進去；列名改了當成同一列（改過的不重複、刪掉的不回來）', {skip: SKIP}, () => {
  const tp = S('北市大'), up = tp.dates.find(d => d.kind === 'upload'), id = tp.programId;
  // (a) 只改附註
  const pa = withProgram(id, p => { p.ev = p.ev.map(e => e[0] === 'upload' ? [...e.slice(0, 6), '限時掛號，郵戳為憑'] : e); });
  const ra = L.syncApp(tp, pa.get(id), '2026-11-02T13:00');
  assert.deepEqual(ra.changes, []);
  assert.equal(L.rowNote(ra.app.dates.find(d => d.id === up.id)), '限時掛號，郵戳為憑');
  // (b1) 改列名、沒改過的列：同一列（id 不變），不報新增／拿掉
  const pb = withProgram(id, p => { p.ev = p.ev.map(e => e[0] === 'upload' ? [...e.slice(0, 5), '郵寄備審資料', e[6]] : e); });
  const rb = L.syncApp(tp, pb.get(id), '2026-11-02T13:00');
  assert.deepEqual(rb.changes, []);
  const db = rb.app.dates.filter(d => d.kind === 'upload');
  assert.deepEqual(db.map(d => [d.id, L.rowLabel(d), d.ref]), [[up.id, '郵寄備審資料', 'upload|郵寄備審資料']]);
  // (b2) 自己改過日期的列：不會多一列，自己的日期留著
  const ed = L.applyAction(tp, 'editDate', {rowId: up.id, date: '2026-11-03'});
  const r2 = L.syncApp(ed, pb.get(id), '2026-11-02T13:00');
  const d2 = r2.app.dates.filter(d => d.kind === 'upload');
  assert.deepEqual(d2.map(d => [d.id, d.date, !!d.gone]), [[up.id, '2026-11-03', false]]);
  assert.equal(ids(L.agenda([r2.app], pb, '2026-11-02T12:00', OPTS).rows, '北市大', [r2.app]).filter(r => r.parts.some(p => p.key === 'docs')).length, 1);
  // 自己改過名：留自己的列名，附註跟簡章
  const rn = L.applyAction(tp, 'editDate', {rowId: up.id, label: '寄備審'});
  const r3 = L.syncApp(rn, pa.get(id), '2026-11-02T13:00').app.dates.find(d => d.id === up.id);
  assert.deepEqual([L.rowLabel(r3), L.rowNote(r3)], ['寄備審', '限時掛號，郵戳為憑']);
  // (b3) 刪掉的列改名後不回來
  const del = L.applyAction(tp, 'removeDate', {rowId: up.id});
  const r4 = L.syncApp(del, pb.get(id), '2026-11-02T13:00');
  assert.ok(!r4.app.dates.some(d => d.kind === 'upload'));
  assert.deepEqual(r4.app.hidden, ['upload|郵寄備審資料']);
  assert.deepEqual(r4.changes, []);
});

/* ---------- L8 列的時間跟著還沒勾的部分 ---------- */
test('L8 勾完繳費的北市大：列寫「今天郵戳」、不是已經過了的 15:30；政大勾了報名寫 15:00', {skip: SKIP}, () => {
  const p = PROGS.get(S('北市大').programId), now = '2026-11-02T16:00';
  const a = L.applyAction(S('北市大'), 'tick', {key: 'pay'}, {program: p});
  const row = ids(L.agenda(replaceApp(apps0, a), PROGS, now, OPTS).rows, '北市大')[0];
  assert.deepEqual([L.timeText(row, now), row.time, row.overdue], ['今天郵戳', '', false]);
  assert.deepEqual(row.parts.map(x => `${x.name}:${x.own}`), ['報名:15:30', '繳費:15:30', '郵寄備審:']);
  assert.ok(row.sortKey.startsWith('2026-11-02T--:--'));
  const z = L.applyAction(S('政大'), 'tick', {key: 'reg'}, {program: PROGS.get(S('政大').programId)});
  assert.equal(ids(L.agenda(replaceApp(apps0, z), PROGS, '2026-11-10T13:00', OPTS).rows, '政大')[0].time, '15:00');
});

/* ---------- L9 印准考證到考試那天都能印 ---------- */
test('L9 印准考證：開放列印之後到考試那天都不算逾期，勾得到', {skip: SKIP}, () => {
  for (const status of ['applied', 'interview']) {
    const cd = set(S2('成大'), {status});
    const at = now => L.agenda([cd], PROGS2, now, OPTS);
    const t9 = at('2026-11-09T10:00').rows.find(r => r.role === 'ticket');
    assert.deepEqual([t9.date, t9.time, t9.from, t9.fromTime, t9.label], ['2026-11-14', '', '2026-11-11', '16:00', '印准考證'], '11/14 那天之前要印好，11/11 16:00 起');
    for (const now of ['2026-11-11T12:00', '2026-11-11T17:00', '2026-11-12T09:00', '2026-11-14T08:00']) {
      const ag = at(now), t = ag.rows.find(r => r.role === 'ticket');
      assert.ok(t, `${status} ${now}`);
      assert.equal(t.overdue, false, `${status} ${now}`);
      assert.deepEqual(t.parts.map(x => x.key), ['ticket'], `${status} ${now}：勾得到`);
      assert.ok(ag.rows.indexOf(t) >= ag.focalIndex, '不在逾期那一區');
    }
    assert.ok(!at('2026-11-15T09:00').rows.some(r => r.role === 'ticket'), '考完就不見');
  }
  // 不去面試就不用印
  assert.ok(!L.agenda([L.applyAction(set(S2('成大'), {status: 'interview'}), 'skipInterview')], PROGS2, '2026-11-12T09:00', OPTS).rows.some(r => r.role === 'ticket'));
  // 勾了就不見
  const done = L.applyAction(set(S2('成大'), {status: 'interview'}), 'tick', {key: 'ticket'}, {program: P2('成大')});
  assert.ok(!L.agenda([done], PROGS2, '2026-11-12T09:00', OPTS).rows.some(r => r.role === 'ticket'));
});

/* ---------- L10 同一間學校兩個系組 ---------- */
test('L10 同一間學校兩個系組分得出來；淡江資工和資工全英語不一樣', {skip: SKIP}, () => {
  assert.equal(L.shortDept('資訊工程學全英語學士班'), '資工全英語');
  assert.equal(L.shortDept('資訊工程學系'), '資工');
  assert.equal(L.shortDept('資安外加 醫學資訊與創新應用學士學位學程'), '醫資・資安外加');
  const yi = set(S2('宜大'), {status: 'applied'});
  const g = set(L.newApp(PROGS2.get('116-022-024'), {apps: apps2, uid: uidSeq('g'), nowMs: 2e12}), {status: 'applied'});
  const apps = [...replaceApp(apps2, yi), g];
  assert.equal(L.appName(yi, apps, OPTS.aliases), '宜大 資工・資安組');
  assert.equal(L.appName(g, apps, OPTS.aliases), '宜大 資工');
  assert.equal(L.appName(S2('成大'), apps, OPTS.aliases), '成大', '只有一個系組的不加');
  // 換報到列寫得出是哪一個
  const A = set(yi, {status: 'admitted', confirmDone: true}), B = set(g, {status: 'admitted'});
  const both = replaceApp(replaceApp(apps, A), B);
  const row = L.agenda(both, PROGS2, '2026-12-22T15:00', OPTS).rows.find(r => r.appId === B.id && r.role === 'confirm');
  assert.equal(row.label, '要換到 宜大 資工，要先辦 宜大 資工・資安組 的放棄');
});

/* ---------- L11 v2 的意願範圍 ---------- */
test('L11 v2 的意願調查範圍（date=開始、end=結束）和簡章不同時也轉成截止在 date', {skip: SKIP}, () => {
  const v2 = structuredClone(real.apps.find(a => /政治/.test(a.school)));
  const w = v2.dates.find(d => /意願/.test(d.note));
  w.time = '15:00';
  const m = L.migrateApp({...v2, status: 'waitlist'}, PROGS.get(v2.programId), 7, {uid: uidSeq()});
  const d = m.dates.find(x => x.id === w.id);
  assert.deepEqual([d.date, d.time, d.from, d.fromTime, d.end], ['2027-01-04', '17:00', '2026-12-22', '15:00', '']);
  const row = L.agenda([m], PROGS, '2026-12-23T09:00', OPTS).rows.find(r => r.role === 'intent');
  assert.deepEqual([row.date, row.overdue], ['2027-01-04', false]);
});

/* ---------- DS4 重做（409）不會多一列 ---------- */
test('DS4 新增日期、備審、遞補報到帶 id：同一個動作重做兩次只有一列', () => {
  const a = L.blankApp({school: '某大學', dept: '資工', date: '2026-11-10'}, {uid: uidSeq('a')});
  const add = x => L.applyAction(x, 'addDate', {label: '面試', date: '2026-12-05', id: 'n1'});
  assert.equal(add(add(a)).dates.filter(d => d.id === 'n1').length, 1);
  const doc = x => L.applyAction(x, 'addDoc', {name: '作品集', id: 'k1'});
  assert.equal(doc(doc(a)).docs.filter(d => d.id === 'k1').length, 1);
  const pr = x => L.applyAction(x, 'promoted', {date: '2026-12-08', time: '12:00', id: 'c1'});
  assert.equal(pr(pr(a)).dates.filter(d => d.kind === 'confirm').length, 1);
  // 沒給 id：照舊每次都加
  assert.equal(L.applyAction(L.applyAction(a, 'addDoc', {name: 'x'}), 'addDoc', {name: 'x'}).docs.filter(d => d.name === 'x').length, 2);
});

/* ---------- D-a 名單一列一列看是不是篩選 ---------- */
test('D-a 成大、逢甲的名單一列一列看：准考證、時間表那一列不會讓沒回答名單的學校變待面試', {skip: SKIP}, () => {
  const cd = S2('成大'), cp = P2('成大');
  assert.deepEqual(L.eventsOf(cd, cp).filter(e => e.kind === 'stage1').map(e => `${e.date} ${e.role}`), ['2026-11-07 stage1', '2026-11-11 ticket']);
  assert.equal(L.displayStage(cd, cp, '2026-11-12T09:00'), 'applied', '11/07 名單還沒回答');
  assert.equal(L.statusWord(cd, cp, '2026-11-12T09:00'), '已報名');
  assert.equal(L.displayStage(L.applyAction(cd, 'passed'), cp, '2026-11-12T09:00'), 'interview');
  assert.equal(L.displayStage(L.applyAction(cd, 'notPassed'), cp, '2026-11-12T09:00'), 'ended');
  const fc = set(S2('逢甲'), {status: 'applied'}), fp = P2('逢甲');
  assert.deepEqual(L.eventsOf(fc, fp).filter(e => e.kind === 'stage1').map(e => `${e.date} ${e.role}`), ['2026-11-30 stage1', '2026-12-01 notice']);
  assert.equal(L.displayStage(fc, fp, '2026-12-01T15:00'), 'applied');
  const rows = L.agenda([fc], PROGS2, '2026-12-01T15:00', OPTS).rows;
  assert.deepEqual(rows.filter(r => r.kind === 'stage1').map(r => `${r.date} ${r.role} ${r.question || '-'}`), ['2026-11-30 stage1 stage1', '2026-12-01 notice -']);
  // 系組 scr:true 不會蓋掉列名（准考證列印還是不篩選）；整個系組都沒篩選的（中教大）到了准考證那天就是待面試
  assert.equal(L.eventsOf(cd, {...cp, scr: true}).find(e => e.date === '2026-11-11').role, 'ticket');
  const tc = set(L.newApp(PROGS2.get('116-027-003'), {uid: uidSeq('t')}), {status: 'applied'});
  assert.equal(L.displayStage(tc, PROGS2.get('116-027-003'), '2026-11-24T14:59'), 'applied');
  assert.equal(L.displayStage(tc, PROGS2.get('116-027-003'), '2026-11-24T15:00'), 'interview');
});

/* ---------- D-b 有鐘點的郵戳、寄達 ---------- */
test('D-b 郵戳、寄達有鐘點：寫「12:00 前寄達」，過了鐘點就逾期；沒鐘點的到當天結束', {skip: SKIP}, () => {
  // 高師大 放棄 3/3 12:00 前寄達
  const k = set(S2('高師大'), {status: 'admitted', confirmDone: true});
  const at = now => L.agenda([k], PROGS2, now, OPTS).rows.find(r => r.role === 'giveup');
  const g = at('2027-03-03T11:00');
  assert.deepEqual([g.time, g.mail, L.timeText(g, '2027-03-03T11:00'), g.overdue, g.sendBy], ['12:00', 'arrive', '03/03 12:00 前寄達', false, '2027-02-28']);
  assert.equal(at('2027-03-03T12:01').overdue, true);
  // 北藝的郵寄繳件 11/20 16:00 前郵戳
  const ta = L.newApp(PROGS2.get('116-019-001'), {uid: uidSeq('b')});
  const row = now => L.agenda([ta], PROGS2, now, OPTS).rows.find(r => r.date === '2026-11-20' && r.parts.some(p => p.key === 'docs' && p.mail));
  const r = row('2026-11-20T15:00');
  assert.deepEqual([r.time, r.mail, L.timeText(r, '2026-11-20T15:00'), r.overdue], ['16:00', 'postmark', '今天 16:00 前郵戳', false]);
  assert.equal(row('2026-11-20T16:01').overdue, true);
  // 北市大郵寄（沒鐘點）：到當天結束都還算數
  const tp = L.applyAction(S2('北市大'), 'tick', {key: 'pay'}, {program: P2('北市大')});
  const t = ids(L.agenda([tp], PROGS2, '2026-11-02T23:00', OPTS).rows, '北市大', [tp])[0];
  assert.deepEqual([L.timeText(t, '2026-11-02T23:00'), t.overdue], ['今天郵戳', false]);
});

/* ---------- D-c 要自己印的東西 ---------- */
test('D-c 列印審核通知、應考證明、准考證、應試號碼都是「要做」；只看列名、不看附註', {skip: SKIP}, () => {
  const roleOf = (s, label) => L.eventsOf(S2(s), P2(s)).find(e => L.rowLabel(S2(s).dates.find(d => d.id === e.rowId)) === label);
  assert.deepEqual(['role', 'label'].map(k => roleOf('中興', '列印甄試資格審核通知')[k]), ['ticket', '印審核通知']);
  assert.deepEqual(['role', 'label'].map(k => roleOf('逢甲', '開放列印應考證明')[k]), ['ticket', '印應考證明']);
  assert.equal(roleOf('淡江', '應試號碼查詢及列印').role, 'ticket');
  assert.equal(roleOf('宜大', '公告口試注意事項、准考證號碼').role, 'notice', '宜大只查號碼');
  // 附註寫了列印也不算（只看列名）
  const yi = S2('宜大'), s1 = yi.dates.find(d => d.kind === 'stage1');
  const noted = set(yi, {dates: yi.dates.map(d => d.id === s1.id ? {...d, note: L.rowLabel(d) + '｜准考證請自行列印'} : d)});
  assert.equal(L.eventsOf(noted, P2('宜大')).find(e => e.rowId === s1.id).role, 'notice');
  // 中興 11/17 開放列印，面試 12/04：到面試那天之前都不逾期
  const xd = set(S2('中興'), {status: 'applied'});
  for (const now of ['2026-11-18T09:00', '2026-12-03T22:00']) {
    const t = L.agenda([xd], PROGS2, now, OPTS).rows.find(r => r.role === 'ticket');
    assert.deepEqual([t.date, t.overdue, t.from, t.fromTime], ['2026-12-04', false, '2026-11-17', '10:00'], now);
  }
});

/* ---------- D-d 新簡章遷移真實紀錄 ---------- */
test('D-d 新簡章遷移：舊列對到新列（成大 筆試→上機考試）、簡章刪掉的列留著標 gone、不重複', {skip: SKIP}, () => {
  for (const a of apps2) {
    assert.ok(!a.dates.some(d => d.src === 'mine'), `${a.school} 沒有變成「自己的」舊列`);
    const o = real.apps.find(x => x.id === a.id);
    for (const d of o.dates) assert.ok(a.dates.some(x => x.id === d.id), `${a.school} ${d.note} 還在（id 不變）`);
    for (const k of ['status', 'notes', 'regSteps', 'docs'].filter(k => k !== 'docs')) assert.deepEqual(a[k] === undefined ? undefined : k === 'regSteps' ? a[k].map(s => [s.name, s.done]) : a[k], o[k] === undefined ? undefined : k === 'regSteps' ? o[k].map(s => [s.name, s.done]) : o[k], `${a.school} ${k}`);
  }
  const cd = S2('成大'), cdo = real.apps.find(a => a.id === cd.id);
  const ex = cd.dates.find(d => d.id === cdo.dates.find(x => x.note === '筆試時間').id);
  assert.deepEqual([ex.kind, ex.date, ex.time, L.rowLabel(ex), ex.src, !!ex.gone], ['exam', '2026-11-14', '09:00', '上機考試', 'brochure', false]);
  assert.equal(cd.dates.filter(d => d.kind === 'exam').length, 1);
  const lt = cd.dates.find(d => d.id === cdo.dates.find(x => x.note === '推薦函截止').id);
  assert.deepEqual([lt.src, lt.gone, lt.date, lt.time], ['brochure', true, '2026-10-20', '23:59']);
  const tp = S2('北市大'), rv = tp.dates.find(d => /初試成績複查/.test(d.note));
  assert.deepEqual([rv.src, rv.gone, rv.date], ['brochure', true, '2026-11-21']);
  // gone 的列：接下來（每個時間點）、行事曆都沒有；學校頁時程只在「全部日期」
  const goneIds = new Set(apps2.flatMap(a => a.dates.filter(d => d.gone).map(d => d.id)));
  assert.equal(goneIds.size, 2);
  for (const now of ['2026-10-20T12:00', '2026-11-02T02:30', '2026-11-21T09:00']) {
    for (const r of L.agenda(apps2, PROGS2, now, OPTS).rows) assert.ok(!r.rowIds.some(id => goneIds.has(id)), now);
  }
  const tl = L.timeline(tp, P2('北市大'), '2026-11-02T13:00', {apps: apps2, programs: PROGS2}).find(r => r.rowId === rv.id);
  assert.deepEqual([tl.gone, tl.milestone], [true, false]);
  // eventsOf 預設不給 gone 的列（畫面不會不小心畫出來），{gone:true} 才給
  assert.ok(!L.eventsOf(cd, P2('成大')).some(e => e.rowId === lt.id));
  assert.equal(L.eventsOf(cd, P2('成大'), {gone: true}).find(e => e.rowId === lt.id).gone, true);
  // 成大 推薦函 gone：不算必繳的部分（勾完報名、繳費、上傳就是已報名）
  let t3 = cd;
  for (const key of ['reg', 'pay', 'docs']) t3 = L.applyAction(set(t3, {status: 'prep'}), 'tick', {key, done: true}, {program: P2('成大')});
  assert.equal(t3.status, 'applied');
  // 逢甲：報名 11/19 → 11/18 23:59、一階 12/01 14:00 → 11/30 14:00，各報一次；12/01 的面試時間表是另一列
  const fc = S2('逢甲');
  assert.deepEqual(fresh.changes.filter(c => c.school === fc.school && !c.added).map(c => `${c.what} ${c.from} → ${c.to}`), ['報名截止 11/19 → 11/18 23:59', '一階名單 12/01 14:00 → 11/30 14:00']);
  const fo = real.apps.find(a => a.id === fc.id);
  const s1 = fc.dates.find(d => d.id === fo.dates.find(x => x.kind === 'stage1').id);
  assert.deepEqual([s1.date, s1.time, s1.upd], ['2026-11-30', '14:00', 'S1']);
  assert.deepEqual(fc.dates.filter(d => d.kind === 'stage1').map(d => `${d.date} ${L.rowLabel(d)}`).sort(), ['2026-11-30 公告複試（面試）名單', '2026-12-01 公告面試時間表']);
  // 政大 遞補意願：截止 01/04 17:00，從 12/22 14:00 起
  const zw = S2('政大').dates.find(d => /意願/.test(d.note));
  assert.deepEqual([zw.date, zw.time, zw.from, zw.fromTime, L.isEdited(zw)], ['2027-01-04', '17:00', '2026-12-22', '14:00', false]);
  // 北市大的勾
  assert.deepEqual(S2('北市大').regSteps.map(s => [s.key, s.done]), [['reg', true], ['docs', false]]);
  // 再同步一次：沒有改動；遷移跑兩次一樣
  const again = syncAll(apps2, PROGS2, '2026-11-03T09:00');
  assert.deepEqual(again.changes, []);
  assert.deepEqual(again.apps, apps2);
  assert.deepEqual(migrateRecords(real.apps, PROGS2, uidSeq('m')), migrateRecords(real.apps, PROGS2, uidSeq('m')));
  // 沒有重複的列（同一種、同一天、同一個列名）
  for (const a of apps2) {
    const keys = a.dates.map(d => `${d.kind}|${d.date}|${L.rowLabel(d)}`);
    assert.equal(new Set(keys).size, keys.length, a.school);
  }
});
test('D-d 簡章又出現同一列：gone 拿掉；自己加的 v2 列還是自己的', {skip: SKIP}, () => {
  const cd = S2('成大'), lt = cd.dates.find(d => d.gone);
  const back = withProgram(cd.programId, p => { p.ev = [...p.ev, ['letter', '2026-10-20', '', '23:59', '', '推薦函截止', '']]; }, PROGS2);
  const r = L.syncApp(cd, back.get(cd.programId), '2026-11-03T09:00');
  const d = r.app.dates.find(x => x.id === lt.id);
  assert.equal(d.gone, undefined);
  assert.equal(r.app.dates.filter(x => x.kind === 'letter').length, 1);
  // v2 自己加的列（列名不是簡章的說法）：留成 mine，照常出現
  const v2 = structuredClone(real.apps.find(a => a.id === cd.id));
  v2.dates.push({id: 'own1', kind: 'interview', date: '2026-11-20', end: '', time: '10:00', note: '學長姐模擬面試'});
  const m = L.migrateApp(v2, P2('成大'), 1, {uid: uidSeq()});
  assert.deepEqual(['src', 'gone'].map(k => m.dates.find(x => x.id === 'own1')[k]), ['mine', undefined]);
});
