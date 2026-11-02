// 測試共用：固定的簡章資料（test/fixtures/programs.json 是 11/01 的舊資料，programs-1102.json 是併了 overrides 的新資料）和使用者真實紀錄的 v2 副本（只讀，不在 git 裡）。
// 真實紀錄找的順序：RECORDS_FIXTURE → data/backups/records-2026-11-02-before-redesign.json → data/records.json（還是 v2 才用）。
// 找不到就跳過那幾個測試。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as L from '../public/js/logic.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
export const PD = readJson(path.join(ROOT, 'test/fixtures/programs.json'));
const byId = d => new Map(d.programs.map(p => [p.i, {...p, school: d.schools[p.s].name, code: d.schools[p.s].code}]));
export const PROGS = byId(PD);
// 11/02 重建、併了 overrides 的新資料（子集）：成大 上機考試＋准考證、逢甲 11/18 23:59、市北 刪掉初試成績複查…
export const PD2 = readJson(path.join(ROOT, 'test/fixtures/programs-1102.json'));
export const PROGS2 = byId(PD2);
export const ALIASES = readJson(path.join(ROOT, 'data/search-terms.json')).aliases;
export const SEASON = [{date: '2027-02-25', label: '學測成績', key: 'gsatScore', tentative: true}];
export const OPTS = {aliases: ALIASES, season: SEASON};

export function realRecords() {
  const tries = [process.env.RECORDS_FIXTURE, path.join(ROOT, 'data/backups/records-2026-11-02-before-redesign.json'), path.join(ROOT, 'data/records.json')].filter(Boolean);
  for (const f of tries) {
    try {
      const d = readJson(f);
      if (Array.isArray(d.apps) && d.apps.length === 9 && d.apps.every(a => a.v !== 3)) return {file: f, ...d};
    } catch { /* next */ }
  }
  return null;
}
export const uidSeq = (p = 't') => { let n = 0; return () => `${p}${++n}`; };
// 和伺服器一樣：顏色依建立順序
export function migrateRecords(apps, progs = PROGS, uid = uidSeq('m')) {
  const idx = new Map([...apps].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map((a, i) => [a.id, i]));
  return apps.map(a => L.migrateApp(a, progs.get(a.programId), idx.get(a.id), {uid}));
}
export const bySchool = (apps, short) => apps.find(a => L.shortSchool(a.school, ALIASES) === short);
// 改一個系組的資料（模擬簡章重建或 overrides），不動到共用的 PROGS
export function withProgram(id, fn, progs = PROGS) {
  const m = new Map(progs);
  const p = structuredClone(progs.get(id));
  fn(p);
  m.set(id, p);
  return m;
}
export const set = (app, patch) => ({...structuredClone(app), ...patch});
export const replaceApp = (apps, app) => apps.map(a => a.id === app.id ? app : a);
