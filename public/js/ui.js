// 畫面共用的小零件：圖示、學校顏色、狀態文字、日期文字。
import {S, STATUS, KINDS, DEADLINE_KINDS, colorOf, esc, fmtDate, wdShort, diffDays, cdText, cdClass, todayKey, shortSchool, deptMain, firstDate, isKey, md, parseKey, addDays} from './core.js';

const ICONS = {
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  flag: '<path d="M5 21V4h12l-2 4 2 4H5"/>',
  map: '<path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
};
export const icon = (name, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

export const hueStyle = a => `style="--hue:var(--c${colorOf(a)})"`;
export const hueVar = a => `var(--c${colorOf(a)})`;
// 狀態文字：備取會帶名次；決定就讀／放棄也標出來。
export function stateText(a) {
  const st = STATUS[a.status] || STATUS.prep;
  let label = a.status === 'waitlist' && a.waitNo ? `備取 ${a.waitNo}` : st.label;
  if (['admitted', 'waitlist'].includes(a.status) && a.choice === 'attend') label += '・要去讀';
  if (['admitted', 'waitlist'].includes(a.status) && a.choice === 'decline') label += a.giveupDone ? '・已放棄' : '・要放棄';
  return {label, tone: st.tone};
}
export const stateHtml = a => { const s = stateText(a); return `<span class="state ${s.tone}">${esc(s.label)}</span>`; };
export const shortName = a => shortSchool(a.school);
export const whenText = d => d ? `${fmtDate(d.date)}（${wdShort(d.date)}）${d.time ? ' ' + d.time : ''}` : '';
export const deadlineKinds = kinds => kinds.map(k => KINDS[k].label.replace(/截止$/, '')).join('・') + (kinds.every(k => DEADLINE_KINDS.has(k)) ? '截止' : '');
// 「報名・繳費截止」：同一天同一間學校的幾個截止合在一起講。
export function kindsLabel(kinds) {
  const u = [...new Set(kinds)];
  if (u.length === 1) return KINDS[u[0]].label;
  if (u.every(k => DEADLINE_KINDS.has(k))) return u.map(k => KINDS[k].label.replace(/截止$/, '')).join('・') + '截止';
  return u.map(k => KINDS[k].label).join('・');
}
// 「報名 12:00・繳費 15:00・繳件 17:00 截止」：同一天幾個截止的時間不一樣就各自標時間。
export function kindsTimesLabel(kinds, times) {
  const u = kinds.map((k, i) => ({k, t: (times && times[i]) || ''}));
  if (u.every(x => x.t === u[0].t)) return kindsLabel(kinds);
  if (u.every(x => DEADLINE_KINDS.has(x.k))) return u.map(x => KINDS[x.k].label.replace(/截止$/, '') + (x.t ? ' ' + x.t : '')).join('・') + '截止';
  return u.map(x => KINDS[x.k].label + (x.t ? ' ' + x.t : '')).join('・');
}
export const sameTimes = times => !times || times.every(t => (t || '') === (times[0] || ''));
export const countdownHtml = (n, cls = 'cd') => `<span class="${cls} ${cdClass(n)}">${cdText(n)}</span>`;
// 一週的七天（週一開始），offset 是往後幾週。
export function weekDays(offset = 0) {
  const t = parseKey(todayKey());
  const dow = (t.getDay() + 6) % 7; // 週一 = 0
  const start = addDays(todayKey(), -dow + offset * 7);
  return Array.from({length: 7}, (_, i) => addDays(start, i));
}
export const monthTitle = (y, m) => `${y} 年 ${m + 1} 月`;
export const nextDateText = a => { const ev = firstDate(a, Object.keys(KINDS)); return ev ? whenText(ev) : ''; };
export const mdw = k => `${md(k)}（${wdShort(k)}）`;
export const isPast = k => isKey(k) && k < todayKey();
export const appsSorted = () => [...S.apps];
export const examplesCount = () => S.apps.filter(a => a.example).length;
export const money = n => Number(n || 0).toLocaleString('zh-TW');
export const deptShort = a => deptMain(a);
