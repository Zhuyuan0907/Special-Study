// logic.js 單元測試（DESIGN §11）：部分拆解、關聯、合併、排序、問題、換報到、撞期、顯示階段、遷移與同步。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../public/js/logic.js';
import {PROGS, OPTS, realRecords, uidSeq, migrateRecords, bySchool, withProgram, set, replaceApp} from './helpers.mjs';

const real = realRecords();
const SKIP = real ? false : '找不到真實紀錄的 v2 副本（設 RECORDS_FIXTURE）';
const apps0 = real ? migrateRecords(real.apps) : [];
const S = short => bySchool(apps0, short);
const ids = (rows, short) => rows.filter(r => r.appId === S(short).id);
// 輔大的 11/04 其實是「面試順序及地點」，不是篩選（data/overrides.json 會給 scr:false）
const FJU = '116-051-027';
const progsFju = withProgram(FJU, p => { p.scr = false; });
const line = (r, now) => `${r.date} ${L.timeText(r, now) || '-'} ${L.shortSchool(apps0.find(a => a.id === r.appId).school, OPTS.aliases)} ${r.label}`;

/* ---------- 名稱與格式 ---------- */
test('dayLabel / timeText', () => {
  const now = '2026-11-02T02:30';
  assert.equal(L.dayLabel('2026-11-02', now), '今天');
  assert.equal(L.dayLabel('2026-11-03', now), '明天');
  assert.equal(L.dayLabel('2026-11-04', now), '後天');
  assert.equal(L.dayLabel('2026-11-06', now), '週五 11/06');
  assert.equal(L.dayLabel('2026-11-09', now), '11/09（一）');
  assert.equal(L.dayLabel('2026-11-01', now), '11/01（日）');
  assert.equal(L.timeText({date: '2026-11-02', time: '', mail: 'postmark'}, now), '今天郵戳');
  assert.equal(L.timeText({date: '2026-11-16', time: '', mail: 'postmark'}, now), '郵戳 11/16');
  // 有鐘點的郵戳：那個鐘點就是期限（D-b）
  assert.equal(L.timeText({date: '2026-11-16', time: '23:59', mail: 'postmark'}, now), '11/16 23:59 前郵戳');
  assert.equal(L.timeText({date: '2026-11-02', time: '12:00', mail: 'postmark'}, now), '今天 12:00 前郵戳');
  assert.equal(L.timeText({date: '2027-03-03', time: '12:00', mail: 'arrive'}, now), '03/03 12:00 前寄達');
  assert.equal(L.timeText({date: '2026-11-16', time: '', mail: 'arrive'}, now), '11/16 前寄達');
  assert.equal(L.timeText({date: '2026-11-16', time: '15:30'}, now), '15:30');
  assert.equal(L.timeText({date: '2026-11-16', time: ''}, now), '');
});
test('clock：臺灣時間，不看主機時區', () => {
  assert.deepEqual(L.clock('2026-11-02T02:30'), {date: '2026-11-02', time: '02:30'});
  assert.deepEqual(L.clock('2026-11-01T18:30:00Z'), {date: '2026-11-02', time: '02:30'});
  assert.deepEqual(L.clock(new Date('2026-11-01T18:30:00Z')), {date: '2026-11-02', time: '02:30'});
  assert.deepEqual(L.clock('2026-11-02T02:30:00+08:00'), {date: '2026-11-02', time: '02:30'});
});
test('shortSchool / shortDept / shortDoc', () => {
  const a = OPTS.aliases;
  assert.equal(L.shortSchool('臺北市立大學', a), '市北');
  assert.equal(L.shortSchool('國立成功大學', a), '成大');
  assert.equal(L.shortSchool('國立中興大學', a), '興大');
  assert.equal(L.shortSchool('國立臺中教育大學', a), '中教大');
  assert.equal(L.shortSchool('淡江大學', a), '淡江');
  assert.equal(L.shortDept('資訊工程學系'), '資工');
  assert.equal(L.shortDept('資安組 資訊工程學系'), '資工・資安組');
  assert.equal(L.shortDept('資訊工程學系 資安組'), '資工・資安組');
  assert.equal(L.shortDept('資安外加 醫學資訊與創新應用學士學位學程'), '醫資・資安外加');
  assert.equal(L.shortDept('軟體工程與管理學系 資安外加組'), '軟工・資安外加');
  assert.equal(L.shortDept('一般生組 資訊工程學系'), '資工');
  assert.equal(L.shortDoc('自傳(含學習歷程描述、報考動機等，以 1,000 字內為原則)'), '自傳');
  assert.equal(L.shortDoc('修課紀錄（15%）：高中成績（科技、數學、自然領域）'), '修課紀錄');
  assert.equal(L.shortDoc('高中（或同等學力）歷年成績單正本及其他有助於書面審查之資料影本（70 分）'), '高中歷年成績單正本');
  for (const p of PROGS.values()) for (const d of p.docs || []) { const s = L.shortDoc(d); assert.ok(s.length >= 2, d); assert.ok(!s.endsWith('…'), s); }
});

/* ---------- 部分拆解 ---------- */
const mk = (rows, extra = {}) => ({id: 'x', school: '測試大學', status: 'prep', regSteps: [], v: 3, dates: rows.map((r, i) => ({id: 'd' + i, src: 'brochure', time: '', end: '', from: '', fromTime: '', ...r})), ...extra});
test('報名標籤拆成部分', () => {
  const evs = L.eventsOf(mk([
    {kind: 'reg', date: '2026-11-10', time: '12:00', note: '網路報名（含繳費及繳件）'},
    {kind: 'reg', date: '2026-11-11', time: '23:59', note: '網路報名、繳費及郵寄繳件'},
    {kind: 'pay', date: '2026-11-12', note: '繳費時間'},
    {kind: 'upload', date: '2026-11-13', note: '上傳資料時間'},
    {kind: 'upload', date: '2026-11-14', note: '郵寄資料時間｜限時掛號，郵戳為憑'},
    {kind: 'upload', date: '2026-11-15', note: '繳件時間'},
    {kind: 'letter', date: '2026-11-16', time: '17:00', note: '推薦函截止'},
    {kind: 'upload', date: '2026-11-17', note: '繳費及繳件時間'},
  ]), {rl: '暗(非必繳)'});
  const p = i => evs[i].parts.map(x => x.name + (x.mail ? '@' + x.mail : '') + (x.opt ? '?' : '')).join(',');
  assert.equal(p(0), '報名,繳費,繳件');
  assert.equal(p(1), '報名,繳費,郵寄備審@postmark');
  assert.equal(evs[1].parts[2].time, '', '郵戳不顯示鐘點');
  assert.equal(p(2), '繳費');
  assert.equal(p(3), '上傳備審');
  assert.equal(p(4), '郵寄備審@postmark');
  assert.equal(evs[4].mail, 'postmark');
  assert.equal(p(5), '繳件');
  assert.equal(p(6), '推薦函?', 'rl 非必繳 → 選繳');
  assert.equal(p(7), '繳費,繳件');
  assert.deepEqual(evs.map(e => e.type), Array(8).fill('do'));
});
test('事件類型', () => {
  const evs = L.eventsOf(mk([
    {kind: 'stage1', date: '2026-11-04', note: '面試名單公布'},
    {kind: 'stage1', date: '2026-11-05', note: '面試順序及地點'},
    {kind: 'stage1', date: '2026-11-06', note: '准考證列印'},
    {kind: 'interview', date: '2026-11-07', note: '面試時間'},
    {kind: 'release', date: '2026-11-08', note: '放榜時間'},
    {kind: 'wait', date: '2026-11-09', note: '備取生遞補意願調查期限'},
    {kind: 'wait', date: '2026-11-10', note: '開始遞補時間'},
    {kind: 'wait', date: '2026-11-11', note: '備取生遞補作業截止'},
    {kind: 'wait', date: '2026-11-12', note: '備取生報到'},
    {kind: 'review', date: '2026-11-13', note: '成績複查申請截止'},
  ]));
  assert.deepEqual(evs.map(e => e.role), ['stage1', 'notice', 'ticket', 'go', 'release', 'intent', 'waitcheck', 'info', 'intent', 'info']);
  assert.equal(evs[1].scr, false);
  assert.equal(evs[2].label, '印准考證');
  assert.equal(evs[3].label, '面試');
  assert.equal(evs[0].label, '公布面試名單');
});

/* ---------- 遷移 ---------- */
test('遷移跑兩次結果一樣（真實紀錄）', {skip: SKIP}, () => {
  const twice = migrateRecords(apps0);
  assert.deepEqual(twice, apps0);
  for (const a of apps0) assert.equal(L.migrateApp(a, PROGS.get(a.programId), 0), a, '已是 v3 就原樣回傳');
  assert.deepEqual(migrateRecords(real.apps, PROGS, uidSeq('m')), migrateRecords(real.apps, PROGS, uidSeq('m')));
});
test('9 間學校的狀態、勾、筆記、日期都在', {skip: SKIP}, () => {
  assert.equal(apps0.length, 9);
  const keep = ['id', 'school', 'dept', 'programId', 'status', 'fee', 'quota', 'url', 'notes', 'prep', 'asked', 'choice', 'waitNo', 'confirmDone', 'giveupDone', 'createdAt', 'methods', 'kit', 'waitLog', 'updatedAt'];
  for (const o of real.apps) {
    const m = apps0.find(a => a.id === o.id);
    for (const k of keep) assert.deepEqual(m[k], o[k], `${o.school} ${k}`);
    assert.equal(m.v, 3);
    assert.equal(m.dates.length, o.dates.length, o.school);
    assert.deepEqual(m.dates.map(d => d.id), o.dates.map(d => d.id));
    assert.ok(m.dates.every(d => d.src === 'brochure' && d.bro && !L.isEdited(d)), `${o.school}：全部是簡章列、沒有「已改」`);
    // 截止類日期不變（政大的意願調查是範圍，改存成截止 1/04 17:00、從 12/22 14:00 起）
    for (const d of o.dates) {
      const n = m.dates.find(x => x.id === d.id);
      if (d.end) assert.deepEqual([n.date, n.time, n.from, n.fromTime], [d.end, '17:00', d.date, d.time]);
      else assert.deepEqual([n.date, n.time], [d.date, d.time], `${o.school} ${d.note}`);
    }
  }
  const colors = Object.fromEntries(apps0.map(a => [L.shortSchool(a.school, OPTS.aliases), a.color]));
  assert.deepEqual(colors, {輔大: 0, 成大: 1, 淡江: 2, 宜大: 3, 逢甲: 4, 興大: 5, 市北: 6, 政大: 7, 高師大: 8});
  const tp = S('市北');
  assert.deepEqual(tp.regSteps.map(s => [s.key, s.name, s.done]), [['reg', '網路報名完成', true], ['docs', '備審上傳完成，並按「確認送出」', false]]);
  assert.equal(L.userNotes(tp), '', '自動的「甄選：…」不算筆記');
  assert.equal(tp.notes, '甄選：書面審查 100%', '但資料還在');
});
test('7 份通用備審清單換成簡章的；政大不重複；高師大標成 placeholder', {skip: SKIP}, () => {
  const replaced = apps0.filter(a => a.docs.length && a.docs.every(d => d.src === 'brochure') && !['政大'].includes(L.shortSchool(a.school, OPTS.aliases)));
  assert.equal(replaced.length, 7);
  for (const a of replaced) assert.deepEqual(a.docs.map(d => d.full), PROGS.get(a.programId).docs, a.school);
  const zz = S('政大');
  assert.equal(zz.docs.length, 5);
  assert.ok(zz.docs.every(d => d.src === 'brochure' && d.full && d.ref));
  assert.deepEqual(zz.docs.map(d => d.id), real.apps.find(a => a.id === zz.id).docs.map(d => d.id), '政大的項目保留原本的 id');
  assert.ok(S('高師大').docs.every(d => d.src === 'placeholder'));
  assert.ok(apps0.every(a => a.docs.every(d => L.shortDoc(d.full || d.name).length <= 14)));
  assert.equal(S('輔大').docs.find(d => /其他有利/.test(d.name)).opt, true, '無則免交 → 選繳');
});

/* ---------- 同步 ---------- */
const syncAll = (apps, progs, opts = {}) => {
  const out = [], changes = [], skipped = [];
  for (const a of apps) { const r = L.syncApp(a, progs.get(a.programId), '2026-11-02T03:00', {uid: uidSeq('s'), ...opts}); out.push(r.app); changes.push(...r.changes); if (r.skipped) skipped.push(r.skipped); }
  return {apps: out, changes, skipped};
};
test('遷移完馬上同步：沒有任何改動', {skip: SKIP}, () => {
  const r = syncAll(apps0, PROGS);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.apps, apps0);
});
test('同步：沒改過的列更新、改過的留著、刪掉的不回來、空簡章跳過', {skip: SKIP}, () => {
  // 逢甲 24:00 修正：報名 11/19 → 11/18 23:59；一階 12/01 → 11/30 14:00
  let progs = withProgram('116-056-015', p => { p.ev = p.ev.map(e => e[0] === 'reg' ? ['reg', '2026-10-19', '2026-11-18', '09:00', '23:59', e[5], e[6]] : e[0] === 'stage1' ? ['stage1', '2026-11-30', '', '14:00', '', e[5], ''] : e); });
  // 宜大：自己把面試列改成 10:20；簡章之後也改了時間 → 衝突，保留自己的
  progs = withProgram('116-022-026', p => { p.ev = p.ev.map(e => e[0] === 'interview' ? ['interview', '2026-12-04', '', '09:00', '', e[5], ''] : e); }, progs);
  progs = withProgram('116-054-007', p => { p.ev = []; }, progs); // 淡江：build 壞掉
  let apps = apps0;
  const yi = S('宜大'), iv = yi.dates.find(d => d.kind === 'interview');
  apps = replaceApp(apps, L.applyAction(yi, 'editDate', {rowId: iv.id, time: '10:20'}));
  const fj = S('輔大'), gone = fj.dates.find(d => d.note === '備取生遞補作業截止');
  apps = replaceApp(apps, L.applyAction(fj, 'removeDate', {rowId: gone.id}));
  const r = syncAll(apps, progs, {syncId: 'sync1'});
  const fc = r.apps.find(a => a.id === S('逢甲').id);
  assert.deepEqual(['reg', 'stage1'].map(k => { const d = fc.dates.find(x => x.kind === k); return `${d.date} ${d.time} ${d.upd}`; }), ['2026-11-18 23:59 sync1', '2026-11-30 14:00 sync1']);
  assert.equal(fc.dates.length, 9);
  assert.equal(fc.rev, S('逢甲').rev + 1);
  const yr = r.apps.find(a => a.id === yi.id).dates.find(d => d.kind === 'interview');
  assert.equal(yr.time, '10:20', '自己改的留著');
  assert.equal(yr.brochureNow.time, '09:00');
  assert.ok(r.changes.some(c => c.conflict && c.school === yi.school));
  assert.ok(!r.apps.find(a => a.id === fj.id).dates.some(d => d.note === '備取生遞補作業截止'), '刪掉的列不會被同步加回來');
  assert.deepEqual(r.apps.find(a => a.id === S('淡江').id), S('淡江'), '簡章空了就不動');
  assert.equal(r.skipped.length, 1);
  const fcChanges = r.changes.filter(c => c.school === fc.school).map(c => `${c.what} ${c.from} → ${c.to}`);
  assert.deepEqual(fcChanges, ['報名截止 11/19 → 11/18 23:59', '一階名單 12/01 14:00 → 11/30 14:00']);
  // 再同步一次：沒有新改動
  assert.deepEqual(syncAll(r.apps, progs).changes, []);
  // 衝突：基準（bro）換成簡章的新值，所以還原直接回到簡章現在的 09:00；簡章沒再變就不會再報一次衝突（L2）
  assert.equal(yr.bro.time, '09:00');
  assert.ok(L.isEdited(yr), '還是「已改」');
  assert.deepEqual(syncAll(r.apps, progs).changes, [], '同一份簡章再同步：不再報衝突');
  const back = L.applyAction(r.apps.find(a => a.id === yi.id), 'restoreDate', {rowId: iv.id});
  const bd = back.dates.find(d => d.id === iv.id);
  assert.equal(bd.time, '09:00');
  assert.equal(bd.brochureNow, null, 'null 不是刪掉：伺服器 carryOver 才不會補回舊的「簡章現在是」');
  assert.ok(!L.isEdited(bd));
  assert.deepEqual(L.syncApp(back, progs.get(yi.programId), '2026-11-02T03:00').changes, []);
});
test('同步：少掉四成以上的列就跳過；NFKC 一樣的字不算改動', {skip: SKIP}, () => {
  const progs = withProgram('116-005-010', p => { p.ev = p.ev.slice(0, 4); });
  const r = L.syncApp(S('成大'), progs.get('116-005-010'), '2026-11-02T03:00');
  assert.ok(r.skipped);
  assert.equal(r.app, S('成大'));
  const p2 = withProgram('116-006-052', p => { p.docs = p.docs.map(d => d.replace(/力/g, '力')); p.ev = p.ev.map(e => [...e.slice(0, 5), e[5].replace(/時間/g, '時間'), e[6]]); });
  assert.deepEqual(L.syncApp(S('興大'), p2.get('116-006-052'), '2026-11-02T03:00').changes, []);
});
test('同步：備審換新清單時，勾過的跟著走；簡章拿掉的勾過項目留著標 gone', {skip: SKIP}, () => {
  let a = S('市北');
  a = L.applyAction(a, 'tickDoc', {docId: a.docs[0].id, done: true});
  const progs = withProgram('116-032-005', p => { p.docs = ['修課紀錄（15%）：高中成績', '課程學習成果（10%）', '資安能力（40%）', '多元學習能力（35%）', '報名表（從報名系統列印）']; });
  const r = L.syncApp(a, progs.get('116-032-005'), '2026-11-02T03:00');
  assert.deepEqual(r.app.docs.map(d => (d.done ? '✓' : '○') + d.name), ['✓修課紀錄', '○課程學習成果', '○資安能力', '○多元學習能力', '○報名表']);
  const p3 = withProgram('116-032-005', p => { p.docs = p.docs.slice(1); });
  const r3 = L.syncApp(a, p3.get('116-032-005'), '2026-11-02T03:00');
  assert.equal(r3.app.docs.length, 4);
  assert.ok(r3.app.docs.find(d => d.gone && d.done));
});
test('新簡章把一階改名又改日：遷移還是對到同一列，同步更新它，不會多一列', {skip: SKIP}, () => {
  const progs = withProgram('116-056-015', p => { p.ev = p.ev.map(e => e[0] === 'stage1' ? ['stage1', '2026-11-30', '', '14:00', '', '公告可參加複試(面試)之名單', ''] : e); });
  const v2 = real.apps.find(a => a.programId === '116-056-015');
  const m = L.migrateApp(v2, progs.get(v2.programId), 4, {uid: uidSeq()});
  const r = L.syncApp(m, progs.get(v2.programId), '2026-11-02T03:00', {uid: uidSeq('s')});
  assert.equal(r.app.dates.length, 9);
  const s1 = r.app.dates.filter(d => d.kind === 'stage1');
  assert.equal(s1.length, 1);
  assert.deepEqual([s1[0].id, s1[0].date, s1[0].time, L.rowLabel(s1[0])], [v2.dates.find(d => d.kind === 'stage1').id, '2026-11-30', '14:00', '公告可參加複試(面試)之名單']);
  assert.deepEqual(r.changes.map(c => `${c.what} ${c.from} → ${c.to}`), ['一階名單 12/01 14:00 → 11/30 14:00']);
});
test('舊分頁把欄位洗掉的學校：重新遷移，不會重複', {skip: SKIP}, () => {
  const fc = structuredClone(S('逢甲'));
  delete fc.v;
  fc.dates = fc.dates.map(d => ({id: d.id, kind: d.kind, date: d.date, end: d.end || '', time: d.time || '', note: d.note}));
  fc.docs = fc.docs.map(d => ({id: d.id, name: d.name, done: !!d.done}));
  fc.docs[1].done = true;
  const m = L.migrateApp(fc, PROGS.get(fc.programId), 4);
  const r = L.syncApp(m, PROGS.get(fc.programId), '2026-11-02T03:00');
  assert.equal(r.app.dates.length, 9);
  assert.equal(r.app.docs.length, 4);
  assert.equal(r.app.docs[1].done, true);
  assert.ok(r.app.docs.every(d => d.src === 'brochure'));
  assert.deepEqual(r.changes, []);
});

/* ---------- 接下來 ---------- */
test('11/02 02:30：第一列是今天的市北（報名✓ 繳費 郵寄備審），接著輔大 11/04', {skip: SKIP}, () => {
  const now = '2026-11-02T02:30';
  const ag = L.agenda(apps0, progsFju, now, OPTS);
  assert.equal(ag.focalIndex, 0);
  const r0 = ag.rows[0];
  assert.equal(r0.appId, S('市北').id);
  assert.equal(r0.date, '2026-11-02');
  assert.equal(L.timeText(r0, now), '15:30');
  assert.deepEqual(r0.parts.map(p => [p.name, p.done, p.own]), [['報名', true, ''], ['繳費', false, ''], ['郵寄備審', false, '今天郵戳']]);
  assert.equal(r0.question, undefined);
  const r1 = ag.rows[1];
  assert.equal(r1.appId, S('輔大').id);
  assert.equal(r1.date, '2026-11-04');
  assert.equal(r1.role, 'notice');
  assert.equal(r1.label, '公布面試順序・地點');
  assert.equal(r1.question, undefined, 'scr:false 不問在不在名單上');
  assert.deepEqual(ag.rows.map(r => line(r, now)), [
    '2026-11-02 15:30 市北 報名・繳費・郵寄備審',
    '2026-11-04 - 輔大 公布面試順序・地點',
    '2026-11-06 - 輔大 面試',
    '2026-11-07 - 成大 公布筆試名單',
    '2026-11-09 17:00 興大 報名・繳費・繳件',
    '2026-11-09 23:59 高師大 報名・繳費',
    '2026-11-10 12:00 政大 報名・繳費・繳件',
    '2026-11-10 23:59 高師大 上傳備審',
    '2026-11-11 17:00 宜大 報名・繳費・繳件・推薦函',
    '2026-11-14 - 成大 筆試',
    '2026-11-16 12:00 淡江 報名・繳費・繳件',
    '2026-11-19 18:00 逢甲 報名・繳費・繳件',
    '2026-11-24 10:00 輔大 放榜',
    '2026-12-09 - 成大 放榜',
  ]);
  assert.ok(ag.rows.every(r => r.type !== 'info'), '資訊列不上清單');
  assert.equal(ag.rows[2].tentative, undefined, '輔大不篩選，面試不是「要先通過名單」');
  assert.equal(ag.rows[9].tentative, true, '成大要先通過名單');
  // 沒有 overrides：用預設（當成篩選），11/04 還沒到所以也沒有問題
  const plain = L.agenda(apps0, PROGS, now, OPTS).rows[1];
  assert.deepEqual([plain.role, plain.label, plain.question], ['stage1', '公布面試名單', undefined]);
});
test('合併：部分的時間只在和這列不同時顯示；沒時間的寫時間未公布', {skip: SKIP}, () => {
  const now = '2026-11-02T02:30';
  const rows = L.agenda(apps0, PROGS, now, OPTS).rows;
  const xd = ids(rows, '興大')[0];
  assert.deepEqual(xd.parts.map(p => `${p.name}:${p.own}`), ['報名:', '繳費:時間未公布', '繳件:']);
  const zz = ids(rows, '政大')[0];
  assert.equal(zz.time, '12:00');
  assert.deepEqual(zz.parts.map(p => `${p.name}:${p.own}`), ['報名:', '繳費:15:00', '繳件:17:00']);
  const yi = ids(rows, '宜大')[0];
  assert.deepEqual(yi.parts.map(p => `${p.name}${p.opt ? '?' : ''}:${p.own}`), ['報名:', '繳費:時間未公布', '繳件:', '推薦函?:']);
});
test('排序：沒時間的排在當天最前面；同時間依學校順序；逾期的留在原日期、在最上面', {skip: SKIP}, () => {
  const now = '2026-11-25T09:00';
  let apps = apps0.map(a => ['宜大', '興大', '逢甲', '高師大'].includes(L.shortSchool(a.school, OPTS.aliases)) ? set(a, {status: 'interview'}) : a);
  apps = replaceApp(apps, set(bySchool(apps, '興大'), {ivTime: '09:00'}));
  const rows = L.agenda(apps, PROGS, now, OPTS).rows.filter(r => r.date === '2026-12-04');
  assert.deepEqual(rows.map(r => `${L.shortSchool(apps.find(a => a.id === r.appId).school, OPTS.aliases)} ${r.time}`), ['高師大 ', '宜大 ', '逢甲 ', '興大 09:00']);
  // 市北 11/02 沒報完：11/03 時那一列還在、日期是 11/02、在最上面，問「有報名嗎」
  const ag = L.agenda(apps0, PROGS, '2026-11-03T10:00', OPTS);
  assert.equal(ag.rows[0].date, '2026-11-02');
  assert.equal(ag.rows[0].overdue, true);
  assert.equal(ag.rows[0].question, 'registered');
  assert.deepEqual(ag.rows[0].actions.filter(a => a.kind !== 'link').map(a => a.label), ['有報名', '沒報']);
  assert.equal(ag.focalIndex, 1);
  // 當天 15:30 過了、繳費沒勾：也算逾期（郵寄到當天結束都還算數）
  const r16 = L.agenda(apps0, PROGS, '2026-11-02T16:00', OPTS).rows[0];
  assert.equal(r16.overdue, true);
  assert.equal(L.agenda(apps0, PROGS, '2026-11-02T15:30', OPTS).rows[0].overdue, false);
});
test('勾完市北的繳費和郵寄：那一列消失、狀態變已報名', {skip: SKIP}, () => {
  const now = '2026-11-02T12:00', p = PROGS.get(S('市北').programId);
  let a = L.applyAction(S('市北'), 'tick', {key: 'pay'}, {program: p, uid: uidSeq()});
  assert.equal(a.status, 'prep');
  assert.equal(L.agenda(replaceApp(apps0, a), PROGS, now, OPTS).rows[0].parts.find(x => x.key === 'pay').done, true);
  a = L.applyAction(a, 'tick', {key: 'docs'}, {program: p});
  assert.equal(a.status, 'applied');
  assert.equal(a.regSteps.length, 3);
  const rows = L.agenda(replaceApp(apps0, a), PROGS, now, OPTS).rows;
  assert.ok(!rows.some(r => r.appId === a.id && r.date === '2026-11-02'));
  assert.equal(L.statusWord(a, p, now), '已報名');
  // 有報名：一次勾完
  const b = L.applyAction(S('興大'), 'registered', {}, {program: PROGS.get(S('興大').programId)});
  assert.deepEqual(b.regSteps.map(s => s.key + s.done).sort(), ['docstrue', 'paytrue', 'regtrue']);
  assert.equal(b.status, 'applied');
});
test('問題只在答得出來的時候問', {skip: SKIP}, () => {
  const q = (apps, now, short) => ids(L.agenda(apps, PROGS, now, OPTS).rows, short).map(r => `${r.date}:${r.question || ''}`);
  // 成大 11/07 名單沒有時間：當天一開始就可以回答
  assert.deepEqual(q(apps0, '2026-11-06T23:59', '成大').slice(0, 1), ['2026-11-07:']);
  assert.deepEqual(q(apps0, '2026-11-07T00:00', '成大').slice(0, 1), ['2026-11-07:stage1']);
  // 輔大 11/24 10:00 放榜：10:00 才問
  const fj = replaceApp(apps0, set(S('輔大'), {status: 'interview'}));
  assert.deepEqual(q(fj, '2026-11-24T09:59', '輔大'), ['2026-11-24:']);
  const rel = ids(L.agenda(fj, PROGS, '2026-11-24T10:00', OPTS).rows, '輔大')[0];
  assert.equal(rel.question, 'release');
  assert.deepEqual(rel.actions.filter(a => a.kind !== 'link').map(a => a.label), ['正取', '備取', '未錄取']);
  assert.deepEqual(rel.actions.find(a => a.id === 'waitlisted').ask, {type: 'number', label: '備取幾號', optional: true});
  // 回答「在名單上」→ 待面試
  const cd = L.applyAction(S('成大'), 'passed');
  assert.equal(L.displayStage(cd, PROGS.get(cd.programId), '2026-11-08T10:00'), 'interview');
  assert.equal(L.statusWord(cd, PROGS.get(cd.programId), '2026-11-08T10:00'), '待面試');
  // 正取 → 報到列（12/21 起才能按）
  const yi = set(S('宜大'), {status: 'admitted'});
  const cf = ids(L.agenda(replaceApp(apps0, yi), PROGS, '2026-12-21T10:00', OPTS).rows, '宜大')[0];
  assert.equal(cf.role, 'confirm');
  assert.equal(cf.question, 'confirm');
  assert.equal(cf.actions.find(a => a.id === 'confirmed').disabled, true, '12/21 13:00 起');
  assert.equal(ids(L.agenda(replaceApp(apps0, yi), PROGS, '2026-12-21T13:00', OPTS).rows, '宜大')[0].actions.find(a => a.id === 'confirmed').disabled, undefined);
});
test('不篩選的名單：到那天自動變待面試，面試過了變等放榜', {skip: SKIP}, () => {
  const p = progsFju.get(FJU), a = S('輔大');
  assert.equal(L.displayStage(a, p, '2026-11-03T12:00'), 'applied');
  assert.equal(L.displayStage(a, p, '2026-11-04T00:00'), 'interview');
  assert.equal(L.statusWord(a, p, '2026-11-05T00:00'), '待面試');
  assert.equal(L.statusWord(a, p, '2026-11-07T00:00'), '等放榜');
  // 篩選的：沒回答名單問題就還是已報名
  assert.equal(L.statusWord(a, PROGS.get(FJU), '2026-11-07T00:00'), '已報名');
  // 不去面試：過了那天就結束
  const skip = L.applyAction(a, 'skipInterview');
  assert.equal(L.displayStage(skip, p, '2026-11-06T10:00'), 'interview');
  assert.equal(L.displayStage(skip, p, '2026-11-07T00:00'), 'ended');
  assert.equal(L.statusWord(skip, p, '2026-11-07T00:00'), '沒去面試');
  assert.ok(!L.agenda([skip], progsFju, '2026-11-05T00:00', OPTS).rows.some(r => r.type === 'go' || r.role === 'release'));
});
test('撞期：已報名／待面試的學校同一天面試', {skip: SKIP}, () => {
  const four = ['宜大', '興大', '逢甲', '高師大'];
  const apps = apps0.map(a => four.includes(L.shortSchool(a.school, OPTS.aliases)) ? set(a, {status: 'applied'}) : a);
  const cl = L.clashes(apps, PROGS, '2026-11-25T09:00');
  assert.deepEqual([...cl.keys()], ['2026-12-04']);
  assert.equal(cl.get('2026-12-04').length, 4);
  const row = L.agenda(apps, PROGS, '2026-11-25T09:00', OPTS).rows.find(r => r.date === '2026-12-04' && r.appId === S('宜大').id);
  assert.equal(row.clash.length, 3);
  const skipped = replaceApp(apps, L.applyAction(bySchool(apps, '宜大'), 'skipInterview'));
  assert.equal(L.clashes(skipped, PROGS, '2026-11-25T09:00').get('2026-12-04').length, 3);
  // 準備中的學校：不算撞期，只是學校頁上的事實
  assert.equal(L.clashes(apps0, PROGS, '2026-11-02T02:30').size, 0);
  const sd = L.sameDay(S('興大'), apps0, PROGS, '2026-11-02T02:30');
  assert.deepEqual(sd.map(x => [x.date, x.with.length]), [['2026-12-04', 3]]);
});
test('已經在 A 報到，B 正取：先辦 A 的放棄再換', {skip: SKIP}, () => {
  const A = set(S('輔大'), {status: 'admitted', confirmDone: true});
  const B = set(S('逢甲'), {status: 'admitted'});
  const apps = replaceApp(replaceApp(apps0, A), B);
  const row = ids(L.agenda(apps, PROGS, '2026-12-22T15:00', OPTS).rows, '逢甲')[0];
  assert.equal(row.question, 'swap');
  assert.equal(row.label, '要換到 逢甲，要先辦 輔大 的放棄');
  const sw = row.actions.find(a => a.id === 'swap');
  assert.deepEqual(sw.also, [{appId: A.id, id: 'gaveUp'}]);
  assert.equal(sw.ask.type, 'confirm');
  assert.equal(sw.ask.text, '輔大 的放棄已經辦好了嗎？');
  assert.deepEqual(row.actions.filter(a => a.kind !== 'link').map(a => a.label), ['換到 逢甲', '留在 輔大']);
  assert.equal(row.context, '其他 1 間還沒放榜', '只算已報名、待面試、等放榜的（成大）');
  // 換過去
  const B2 = L.applyAction(B, 'swap'), A2 = L.applyAction(A, 'gaveUp');
  assert.equal(L.statusWord(B2, null, '2026-12-22T15:00'), '已報到');
  assert.equal(L.statusWord(A2, null, '2026-12-22T15:00'), '已放棄');
  assert.equal(L.displayStage(A2, PROGS.get(A2.programId), '2026-12-22T15:00'), 'ended');
  // 留在 A
  const B3 = L.applyAction(B, 'stay');
  assert.equal(L.statusWord(B3, null, '2026-12-22T15:00'), '不去');
  assert.ok(!L.agenda(replaceApp(apps, B3), PROGS, '2026-12-22T15:00', OPTS).rows.some(r => r.appId === B.id));
});
test('報到之後的放棄決定：學測成績前一週才出現，可以選留下', {skip: SKIP}, () => {
  const A = set(S('輔大'), {status: 'admitted', confirmDone: true});
  const apps = [A];
  assert.equal(L.agenda(apps, PROGS, '2027-02-17T23:00', OPTS).rows.length, 0);
  const row = L.agenda(apps, PROGS, '2027-02-18T08:00', OPTS).rows[0];
  assert.equal(row.role, 'giveup');
  assert.equal(row.date, '2027-03-03');
  assert.equal(row.label, '決定：留在 輔大，或放棄（改走申請入學）');
  assert.equal(row.context, '學測成績 02/25（暫定）');
  assert.deepEqual(row.actions.filter(a => a.kind !== 'link').map(a => a.id), ['keep', 'gaveUp']);
  const kept = L.applyAction(A, 'keep');
  assert.equal(L.agenda([kept], PROGS, '2027-02-27T09:00', OPTS).rows.length, 0);
  assert.equal(L.statusWord(kept, null, '2027-02-27T09:00'), '已報到');
  assert.equal(L.nextStep(A, PROGS.get(A.programId), '2027-02-27T09:00', OPTS).role, 'giveup');
});
test('沒事時的「下一個日期」：只挑那天真的會出現的事（已報到就跳過報到日）', {skip: SKIP}, () => {
  const A = set(S('輔大'), {status: 'admitted', confirmDone: true});
  const ag = L.agenda([A], PROGS, '2026-11-25T09:00', OPTS);
  assert.equal(ag.rows.length, 0);
  assert.equal(ag.upcoming.date, '2027-03-03');
  assert.equal(ag.upcoming.label, '放棄期限');
});
test('備取：意願要勾、遞補公告可以回答遞補上了', {skip: SKIP}, () => {
  const tp = set(S('市北'), {status: 'waitlist', waitNo: 5});
  const p = PROGS.get(tp.programId);
  assert.equal(L.statusWord(tp, p, '2026-12-08T10:00'), '備取 5');
  const rows = L.agenda([tp], PROGS, '2026-12-08T10:00', OPTS).rows;
  assert.deepEqual(rows.map(r => `${r.date} ${r.role} ${r.label}`), ['2026-12-11 intent 填寫遞補意願', '2026-12-15 waitcheck 開始遞補']);
  const w = L.agenda([tp], PROGS, '2026-12-15T12:00', OPTS).rows.find(r => r.role === 'waitcheck');
  assert.equal(w.question, 'promoted');
  const up = L.applyAction(tp, 'promoted', {date: '2026-12-17', time: '12:00'}, {uid: uidSeq()});
  assert.equal(up.status, 'admitted');
  const cf = L.agenda([up], PROGS, '2026-12-15T13:00', OPTS).rows;
  assert.deepEqual(cf.map(r => `${r.date} ${r.time} ${r.role} ${r.question}`), ['2026-12-17 12:00 confirm confirm'], '只出現自己記的報到期限');
  const no = L.applyAction(tp, 'notYet', w.actions.find(a => a.id === 'notYet').payload);
  assert.ok(!L.agenda([no], PROGS, '2026-12-15T13:00', OPTS).rows.some(r => r.role === 'waitcheck'));
});
test('時程的改：改日期、還原、新增、刪除（刪除的簡章列留墓碑）', {skip: SKIP}, () => {
  const a = S('政大'), p = PROGS.get(a.programId), uid = uidSeq();
  const iv = a.dates.find(d => d.kind === 'interview');
  const e1 = L.applyAction(a, 'editDate', {rowId: iv.id, time: '10:20', label: '面試（第二梯）'});
  const d1 = e1.dates.find(d => d.id === iv.id);
  assert.ok(L.isEdited(d1));
  assert.equal(L.rowLabel(d1), '面試（第二梯）');
  assert.ok(!L.isEdited(L.applyAction(e1, 'restoreDate', {rowId: iv.id}).dates.find(d => d.id === iv.id)));
  const e2 = L.applyAction(a, 'addDate', {label: '作品集面談', date: '2026-12-13', time: '14:00'}, {uid});
  assert.equal(e2.dates.at(-1).src, 'mine');
  const rv = a.dates.find(d => d.kind === 'review');
  const e3 = L.applyAction(a, 'removeDate', {rowId: rv.id});
  assert.deepEqual(e3.hidden, [rv.ref]);
  const e4 = L.applyAction(e3, 'unhide', {ref: rv.ref}, {program: p, uid});
  assert.equal(e4.hidden.length, 0);
  assert.equal(e4.dates.filter(d => d.ref === rv.ref).length, 1);
  // 備審：簡章項目只能藏，不能改名；自己的可以加
  const h = L.applyAction(a, 'hideDoc', {docId: a.docs[0].id});
  assert.equal(h.docs.length, 4);
  assert.deepEqual(h.hidden, [a.docs[0].ref]);
  assert.equal(L.syncApp(h, withProgram(a.programId, q => { q.ev = [...q.ev]; }).get(a.programId), '2026-11-03T00:00').app.docs.length, 4);
  // 紀錄：筆記只改使用者的部分，自動的甄選文字留著
  const r = L.applyAction(S('市北'), 'editRecord', {notes: '記得帶信封', regNo: 'A123', ivTime: '10:20'});
  assert.equal(r.notes, '甄選：書面審查 100%\n記得帶信封');
  assert.equal(L.userNotes(r), '記得帶信封');
  assert.equal(r.regNo, 'A123');
  // 狀態選單
  const s = L.applyAction(S('輔大'), 'setStatus', {status: 'held'});
  assert.equal(L.statusWord(s, null, '2026-12-01T00:00'), '已報到');
  assert.throws(() => L.applyAction(a, 'nope'));
});
test('自己記的面試時間會出現在接下來', {skip: SKIP}, () => {
  const a = set(S('宜大'), {status: 'interview', ivTime: '10:20'});
  const row = ids(L.agenda([a], PROGS, '2026-12-01T00:00', OPTS).rows, '宜大').find(r => r.type === 'go');
  assert.equal(row.time, '10:20');
  const f = L.recordFields(a, PROGS.get(a.programId), '2026-12-01T00:00').map(x => x.key);
  assert.deepEqual(f, ['regNo', 'ivTime', 'place', 'notes']);
  assert.ok(L.recordFields(a, PROGS.get(a.programId), '2026-12-05T00:00').some(x => x.key === 'asked'));
  assert.deepEqual(L.recordFields(S('市北'), PROGS.get(S('市北').programId), '2026-11-02T00:00').map(x => x.key), ['notes']);
});
test('學校頁：時程里程碑、備審顯示方式、學校順序', {skip: SKIP}, () => {
  const now = '2026-11-02T02:30', a = S('興大'), p = PROGS.get(a.programId);
  const tl = L.timeline(a, p, now, {apps: apps0, programs: PROGS});
  assert.deepEqual(tl.filter(r => r.milestone).map(r => r.role), ['reg', 'reg', 'stage1', 'go', 'release', 'confirm']);
  assert.equal(tl.find(r => r.next).role, 'reg');
  assert.equal(tl.find(r => r.role === 'go').clash.length, 3);
  assert.equal(L.docsMode(a, p, now), 'list');
  assert.equal(L.docsMode(S('成大'), PROGS.get(S('成大').programId), now), 'summary');
  const {active, ended} = L.orderApps(apps0, PROGS, now);
  assert.deepEqual(active.map(x => L.shortSchool(x.school, OPTS.aliases)), ['成大', '輔大', '市北', '興大', '高師大', '政大', '宜大', '淡江', '逢甲']);
  assert.equal(ended.length, 0);
});
test('新增學校：中教大資工直接是 v3，同步不會再改', () => {
  const p = PROGS.get('116-027-003');
  const a = L.newApp(p, {apps: [], uid: uidSeq('n'), nowMs: 1}), b = L.newApp(p, {apps: [a], uid: uidSeq('n'), nowMs: 2});
  assert.equal(a.v, 3);
  assert.equal(a.color, 0);
  assert.equal(b.color, 1);
  assert.equal(a.dates.length, p.ev.length);
  assert.deepEqual(a.docs.map(d => d.name), ['自傳', '高中歷年成績單正本']);
  assert.deepEqual(L.syncApp(a, p, '2026-11-02T03:00').changes, []);
  const row = L.agenda([a], new Map([[p.i, p]]), '2026-11-02T03:00', OPTS).rows[0];
  assert.deepEqual(row.parts.map(x => x.name), ['報名', '繳費', '繳件']);
  const m = L.blankApp({school: '某大學', dept: '資工', date: '2026-11-20', time: '17:00'}, {apps: [a], uid: uidSeq('b'), nowMs: 3});
  assert.equal(L.agenda([m], new Map(), '2026-11-02T03:00', OPTS).rows[0].label, '報名');
});
