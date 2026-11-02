// 重新產生 data/programs.json 與 data/brochures/text/*.json
//
//   npm run build-data            從特殊選才網下載最新系組資料與簡章 PDF，再重建
//   npm run build-data:offline    只用 data/ 裡已下載的檔案重建
//
// 資料來源：特殊選才網 https://sta-tw.org/bochures/（簡章資料由日曆小幫手整理）。
// 下載採逐一請求並間隔數秒，請勿調短間隔。

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const PDF_DIR = path.join(DATA, 'brochures/pdf');
const TEXT_DIR = path.join(DATA, 'brochures/text');
const RAW = path.join(DATA, 'raw/programs-raw.json');
const OVERRIDES = path.join(DATA, 'overrides.json');
const OUT = path.join(DATA, 'programs.json');
const YEAR = 116;
const API = 'https://sta-tw.org/api/v1/admissions';
const UA = 'special-study-tracker (personal, non-commercial)';
const OFFLINE = process.argv.includes('--offline');

const REGION = {
  北: '國立臺灣大學 國立臺灣師範大學 國立政治大學 國立清華大學 國立陽明交通大學 國立中央大學 國立臺灣海洋大學 國立臺北教育大學 臺北市立大學 國立體育大學 國立臺灣藝術大學 國立臺北大學 國立臺北藝術大學 東吳大學 中原大學 淡江大學 中國文化大學 大同大學 輔仁大學 長庚大學 元智大學 銘傳大學 世新大學 實踐大學 玄奘大學 真理大學 臺北醫學大學 馬偕醫學大學',
  中: '國立中興大學 國立臺中教育大學 國立臺灣體育運動大學 國立暨南國際大學 國立聯合大學 東海大學 逢甲大學 靜宜大學 中山醫學大學 大葉大學 亞洲大學',
  南: '國立成功大學 國立高雄師範大學 國立中山大學 國立臺南大學 國立屏東大學 國立中正大學 國立臺南藝術大學 國立嘉義大學 國立高雄大學 高雄醫學大學 義守大學 長榮大學 南華大學',
  東: '國立東華大學 國立臺東大學 國立宜蘭大學 國立金門大學 慈濟大學 佛光大學',
};
const regionOf = name => Object.keys(REGION).find(k => REGION[k].split(' ').includes(name)) || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 1. download ---------- */
async function fetchPrograms() {
  const all = [];
  for (let offset = 0; ; offset += 500) {
    const url = `${API}/programs?academic_year=${YEAR}&limit=500&offset=${offset}`;
    const res = await fetch(url, {headers: {'User-Agent': UA}});
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    const {data} = await res.json();
    all.push(...data);
    if (data.length < 500) break;
    await sleep(2000);
  }
  fs.mkdirSync(path.dirname(RAW), {recursive: true});
  // 用台灣的日期：凌晨抓的資料用 UTC 會記成前一天。
  const fetched = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Taipei'}).format(new Date());
  fs.writeFileSync(RAW, JSON.stringify({fetched, data: all}));
  console.log(`系組資料：${all.length} 筆`);
}
// 學校會改版簡章，所以已經有的也重新下載。網站每次給的 PDF 位元組都不同，真的有沒有改要看抽出來的文字（見 extractText）。
async function fetchBrochures(codes) {
  fs.mkdirSync(PDF_DIR, {recursive: true});
  for (const code of codes) {
    const file = path.join(PDF_DIR, `${code}.pdf`);
    const res = await fetch(`${API}/brochures/${YEAR}/${code}/download`, {headers: {'User-Agent': UA}});
    if (!res.ok) console.log(`簡章 ${code} 無法下載（HTTP ${res.status}）`);
    else {
      const buf = Buffer.from(await res.arrayBuffer());
      if (!fs.existsSync(file) || !buf.equals(fs.readFileSync(file))) fs.writeFileSync(file, buf);
    }
    await sleep(2500);
  }
}

/* ---------- 2. text extraction ---------- */
const CJK = '\\u3000-\\u303f\\u3400-\\u9fff\\uff00-\\uffef';
// PDF 表格的直排標題常被抽成一行一個字（考／試／項／目）：連續三行以上的單字就接回一行。
function joinSingles(text) {
  const out = [];
  let run = [];
  const flush = () => { if (run.length >= 3) out.push(run.join('')); else out.push(...run); run = []; };
  for (const line of text.split('\n')) {
    if (/^[㐀-鿿]$/.test(line.trim())) run.push(line.trim()); else { flush(); out.push(line); }
  }
  flush();
  return out.join('\n');
}
// 不少 PDF 的字型把「理」「料」「錄」「不」對到相容表意字（U+F900 區）或康熙部首：看起來一樣，比對卻會失敗
// （元智「資訊管理學系」對不到頁面、「資料」「錄取」抓不到）。一律換回一般的字。
const unify = s => String(s).replace(/[\u2e80-\u2fdf\uf900-\ufaff]/g, c => c.normalize('NFKC'));
const cleanPage = s => joinSingles(unify(s).replace(new RegExp(`([${CJK}])[ \\t]+(?=[${CJK}])`, 'g'), '$1').replace(/[ \t]{2,}/g, ' '));
// 舊版抽出來的文字可能還有相容字，讀進來時順便換掉並寫回（網站的簡章搜尋也讀這些檔）。
function readText(file) {
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pages = t.pages.map(unify);
  if (pages.some((p, i) => p !== t.pages[i])) fs.writeFileSync(file, JSON.stringify({...t, pages}));
  return {...t, pages};
}
async function extractText(code, school) {
  const pdfFile = path.join(PDF_DIR, `${code}.pdf`);
  const outFile = path.join(TEXT_DIR, `${code}.json`);
  if (!fs.existsSync(pdfFile)) return fs.existsSync(outFile) ? readText(outFile) : null;
  if (fs.existsSync(outFile) && fs.statSync(outFile).mtimeMs >= fs.statSync(pdfFile).mtimeMs) return readText(outFile);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pkg = path.join(ROOT, 'node_modules/pdfjs-dist/');
  const doc = await pdfjs.getDocument({data: new Uint8Array(fs.readFileSync(pdfFile)), cMapUrl: pkg + 'cmaps/', cMapPacked: true, standardFontDataUrl: pkg + 'standard_fonts/', verbosity: 0}).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    const lines = [];
    let cur = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = Math.round(it.transform[5]);
      if (!cur || Math.abs(cur.y - y) > 3) { cur = {y, parts: []}; lines.push(cur); }
      cur.parts.push(it.str);
      if (it.hasEOL) cur = null;
    }
    pages.push(cleanPage(lines.map(l => l.parts.join('').trim()).filter(Boolean).join('\n')));
  }
  await doc.destroy();
  const out = {code, school, year: YEAR, source: `${API}/brochures/${YEAR}/${code}/download`, pages};
  const before = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')).pages : null;
  fs.mkdirSync(TEXT_DIR, {recursive: true});
  fs.writeFileSync(outFile, JSON.stringify(out));
  if (!before) console.log(`簡章 ${code} ${school}：新的，${pages.length} 頁`);
  else if (JSON.stringify(before) !== JSON.stringify(pages)) console.log(`簡章 ${code} ${school}：內容有更新，${pages.length} 頁`);
  return out;
}

/* ---------- 3. compact program records ---------- */
const EMPTY = new Set(['', '-', '未公告', '尚未公告', '尚未公布', '無資料', '#N/A', '#VALUE!', '#DIV/0!', 'N/A', '待統計']);
const val = v => { const s = v == null ? '' : String(v).trim(); return EMPTY.has(s) ? '' : s; };
// 來源的 00:00 意思不一定：多半是把「D 日 24 時止」存成 D+1 00:00，也有真的 0 時。tm 一律當時間未知，對過簡章的由下面 H24、H0 改回來。
const tm = v => { const m = /^(\d{1,2}):(\d{2})$/.exec(val(v)); if (!m) return ''; const t = `${m[1].padStart(2, '0')}:${m[2]}`; return t === '00:00' ? '' : t; };
const zero = v => /^0?0:00$/.test(val(v));
// [學校代碼, 列名]：結束時間 00:00 是前一天 24 時，存成前一天 23:59（前端顯示 23:59，不然截止日會晚一天）。
// 2026-11 對照 116 學年度簡章，來源全部 126 列 00:00 都對過；之後新出現沒對過的 00:00 會在建置時列出來。
const H24 = [
  ['003', /^(正取生報到期限|備取生遞補意願調查期限)$/], // 臺大 p2、p10：正、備取生網路報到 12/29（二）晚上 12 時止
  ['027', /^(網路報名、繳費及繳件|成績複查申請期限)$/], // 中教大 p5、p7、p25：報名 11/16（一）24 時止；p6、p31：複查 12/18（五）24 時止
  ['052', /^繳費$/], // 東吳 p8、p16：繳費 11/05 24:00 止（填表、上傳是 17:00，另一列）
  ['056', /^網路報名及繳費$/], // 逢甲 p2：報名 11/18（三）晚上 12 時止（上傳另一列 11/19 18:00，是真的時間）
  ['057', /^網路報名及繳件$/], // 靜宜 p2：報名、上傳 11/11（三）24:00 止
];
// 開始時間 00:00 是真的 0 時。
const H0 = [['014', /^網路報名/]]; // 臺北大學 p4：11/11（三）0 時整起
const ruled = (rules, code, name) => rules.some(([c, re]) => c === code && re.test(name));
const dayBefore = d => new Date(Date.parse(d + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);
const unknownZero = [];
// 來源偶爾有打錯的年份（例如 2062-12-07），只接受這個學年度前後的日期。
const dt = v => /^\d{4}-\d{2}-\d{2}$/.test(val(v)) && Number(val(v).slice(0, 4)) >= YEAR + 1909 && Number(val(v).slice(0, 4)) <= YEAR + 1912 ? val(v) : '';
function kindOf(n) {
  if (n.includes('推薦函')) return 'letter';
  if (n.includes('複查')) return 'review';
  if (n.includes('非放榜')) return 'score';
  if (n.includes('網路報名')) return 'reg';
  if (n.startsWith('繳費') && !n.includes('繳件')) return 'pay';
  if (['上傳', '繳件', '郵寄', '親送', '應繳資料', '指定繳交', '寄繳'].some(k => n.includes(k))) return 'upload';
  if (['名單公布', '公布時間', '初試成績公告'].some(k => n.includes(k))) return 'stage1';
  if (n === '面試時間' || n === '二階時間') return 'interview';
  if (n === '筆試時間' || n === '術科時間') return 'exam';
  if (n.includes('放榜')) return 'release';
  if (n.includes('已報到生放棄')) return 'giveup';
  if (n.startsWith('正取生報到')) return 'confirm';
  if (n.includes('遞補') || n.startsWith('備取')) return 'wait';
  return 'other';
}
function compact(r, schoolIndex) {
  const ev = [...(r.timeline_events || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).flatMap(e => {
    const sd = dt(e.start_date), name = val(e.name);
    let ed = dt(e.end_date), st = tm(e.start_time), et = tm(e.end_time);
    if (!sd && !ed) return [];
    if (ed && zero(e.end_time) && ruled(H24, r.school_code, name)) { ed = dayBefore(ed); et = '23:59'; }
    else if (zero(e.end_time)) unknownZero.push(`${r.school_name} ${name}`);
    if (zero(e.start_time)) { if (ruled(H0, r.school_code, name)) st = '00:00'; else unknownZero.push(`${r.school_name} ${name}`); }
    return [[kindOf(name), sd || ed, sd && ed && ed > sd ? ed : '', st, et, name, val(e.notes)]];
  });
  const it = [...(r.exam_items || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map(i => [val(i.name), typeof i.weight_percent === 'number' ? i.weight_percent : null, val(i.stage), val(i.description)]);
  const p = {
    i: r.program_identifier, s: schoolIndex, n: unify(val(r.admission_program_name)).replace(/\s+/g, ' '),
    q: Number.isInteger(r.admission_quota) ? r.admission_quota : null,
    g: val(r.admission_group), x: val(r.cross_group), c: val(r.admission_category), it, ev,
    fee: val(r.registration_fee).replace(/\s/g, ''), tgt: val(r.special_talent_target),
    deb: val(r.different_education_backgrounds), deo: val(r.different_education_other),
    pf: val(r.portfolio_required), pfd: dt(r.portfolio_deadline), rl: val(r.recommendation_letter_type), rld: dt(r.recommendation_letter_deadline),
    pr: val(r.priority_admission), mx: val(r.max_applicable_programs), cw: val(r.checkin_waitlist_process), fr: val(r.fee_reduction_eligibility),
    ph: val(r.consultation_phone), em: val(r.consultation_email), ct: val(r.consultation_contact),
    u: val(r.brochure_url), su: val(r.school_official_url), du: val(r.department_official_url), loc: val(r.exam_location), nt: val(r.notes),
  };
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== null && !(Array.isArray(v) && !v.length)));
}

/* ---------- 4. map brochure pages to programs ---------- */
const norm = s => String(s || '').replace(/台/g, '臺').replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
const GENERAL = new Set(['一般組', '一般生', '一般生組']);
const QUAL_VARIANTS = {'願景組': ['願景組', '願景生', '願景'], '新住民外加': ['新住民外加', '新住民'], '新住民': ['新住民外加', '新住民'], '資安外加': ['資安外加', '資安組', '資訊安全組'], '資安組': ['資安組', '資安外加', '資訊安全組']};
const variants = q => QUAL_VARIANTS[q] || [q];
// 「資安外加組」在系名旁常寫成「(資安外加)」（高師大軟工）：判斷專屬頁時去掉「組」再比一次。
const nearby = q => [...new Set([...variants(q), ...variants(q.replace(/組$/, ''))])];
const FORM_RE = /報名表|切結書|推薦函格式|推薦信格式|收據|委託書|聲明書|申請表|檢核表|資料表|附表|附件/;
// 附錄（同等學力標準、交通圖）不是前一系的續頁；只看行首，內文的「請參閱附錄一」不算。
const APPENDIX = /^\s*[【〔(（]?附錄/m;
const DETAIL_RE = /報考資格|報名資格|報名條件|篩選條件|甄選方式|甄試項目|審查資料|指定繳交/;
const adjacent = (page, core, q) => new RegExp(`${esc(core)}.{0,2}${esc(q)}|${esc(q)}.{0,2}${esc(core)}`).test(page);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function nameParts(name) {
  const quals = [];
  let core = '';
  for (const tok of name.split(' ')) {
    if (/(系|學程|學士班|學院|學群)/.test(tok) && tok.length > core.length) { if (core) quals.push(core); core = tok; }
    else quals.push(tok);
  }
  if (!core) core = name.replace(/\s+/g, '');
  const paren = /[(（]([^)）]+)[)）]$/.exec(core);
  if (paren) { quals.push(paren[1]); core = core.slice(0, paren.index); }
  const letter = /([A-Z甲乙丙丁]組)$/.exec(core);
  if (letter && core.length > letter[1].length + 2) { quals.push(letter[1]); core = core.slice(0, -letter[1].length); }
  return {core: norm(core), quals: quals.map(norm).filter(Boolean)};
}
function mapPages(programs, pages) {
  const np = pages.map(norm);
  const items = programs.map(p => ({p, ...nameParts(p.n)}));
  // A core the brochure never prints (e.g. 物理學系電子物理組 written as 物理學系 + 電子物理組) falls back to the part up to 系.
  for (const it of items) {
    if (np.some(t => t.includes(it.core))) continue;
    const m = /^(.+?系)(.+)$/.exec(it.core);
    if (m) { it.core = m[1]; it.quals.push(m[2]); }
    else {
      const alt = it.core.replace(/學系$/, '系').replace(/學士學位學程$/, '學位學程');
      // 來源資料偶有漏字（淡江「資訊工程學全英語學士班」）：在「學」後補「系」試試。
      const fix = [...it.core].map((c, k) => c === '學' && it.core[k + 1] !== '系' ? it.core.slice(0, k + 1) + '系' + it.core.slice(k + 1) : '');
      const found = [alt, ...fix].find(c => c && c !== it.core && np.some(t => t.includes(c)));
      if (found) it.core = found;
    }
  }
  const cores = [...new Set(items.map(i => i.core))].sort((a, b) => b.length - a.length);
  const assigned = new Map(items.map(i => [i.p.i, new Set()]));
  const deptPage = new Array(pages.length).fill(null);
  const hitsOn = page => {
    let rest = page;
    const hits = [];
    for (const c of cores) if (rest.includes(c)) { hits.push(c); rest = rest.split(c).join('□'); }
    return hits;
  };
  // Among programs sharing one department name, decide which ones a page belongs to.
  const choose = (cands, page) => {
    if (cands.length === 1) return cands;
    const specs = i => i.quals.filter(q => !GENERAL.has(q));
    const dedicated = cands.filter(i => specs(i).some(q => nearby(q).some(v => adjacent(page, i.core, v))));
    if (dedicated.length) return dedicated;
    const general = cands.filter(i => !specs(i).length);
    const named = cands.filter(i => specs(i).some(q => variants(q).some(v => page.includes(v))));
    const chosen = [...new Set([...general, ...named])];
    return chosen.length ? chosen : cands;
  };
  np.forEach((page, idx) => {
    const hits = hitsOn(page);
    if (!hits.length || hits.length > (DETAIL_RE.test(page) ? 6 : 3)) return;
    const owners = new Set();
    for (const c of hits) for (const i of choose(items.filter(x => x.core === c), page)) owners.add(i.p.i);
    deptPage[idx] = owners;
  });
  // Programs still without a page: take the most specific detail pages that name them.
  const covered = new Set(deptPage.flatMap(s => s ? [...s] : []));
  for (const it of items) {
    if (covered.has(it.p.i)) continue;
    const pagesWith = np.map((page, idx) => ({idx, page, hits: hitsOn(page)})).filter(x => x.hits.includes(it.core) && DETAIL_RE.test(x.page) && x.hits.length <= 10);
    const min = Math.min(...pagesWith.map(x => x.hits.length));
    for (const x of pagesWith.filter(x => x.hits.length === min).slice(0, 2)) {
      if (!choose(items.filter(y => y.core === it.core), x.page).includes(it)) continue;
      (deptPage[x.idx] ||= new Set()).add(it.p.i);
    }
  }
  // A page with no department name right after a department page continues it (forms excluded).
  for (let idx = 1; idx < pages.length; idx++) {
    if (deptPage[idx] || !deptPage[idx - 1] || deptPage[idx - 1].cont) continue;
    if (FORM_RE.test(np[idx].slice(0, 120)) || APPENDIX.test(pages[idx].slice(0, 150)) || np[idx].length < 80) continue;
    deptPage[idx] = Object.assign(new Set(deptPage[idx - 1]), {cont: true});
  }
  deptPage.forEach((owners, idx) => { if (owners) for (const id of owners) assigned.get(id).add(idx + 1); });
  return assigned;
}

/* ---------- 5. pull the 報名資格 paragraph out of a department's pages ---------- */
const loose = w => [...w].map(ch => esc(ch)).join('\\s*');
const QUAL_HEAD = new RegExp(`(${['報考資格', '報名資格', '報名條件', '篩選條件', '申請資格', '招生對象'].map(loose).join('|')})`);
// 標題前面不會緊接著漢字：「而其成績計算方式為獨立計算者」（臺大數學資格第 1 項）、「請參考備註1）」（屏東）是句子裡的字，不是下一欄。
// 「總成績計算方式」是標題，另列。「其他有利審查資料」「學系審查資料」照舊算：資格寫到這裡已經接上繳交資料了（元智、中央機械）。
const NEXT_HEAD = new RegExp(`(${['招生名額', '甄試項目', '甄選方式', '甄選項目', '考試方式', '考試項目', '考試科目', '指定繳交', '指定審查', '學系指定上傳', '指定上傳', '審查資料', '繳交資料', '應繳資料', '應繳文件', '甄試日期', '總成績計算', '成績計算', '甄試說明', '面試日期', '學系特色', '本系特色', '報名費', '備註', '注意事項', '評分', '系(班/組)'].map(w => (/資料|文件|指定|總/.test(w) ? '' : '(?<![\\u3400-\\u9fff])') + loose(w)).join('|')})`);
// ownPg：系所自己的頁（見 main 的 ownPages）先看；全校通則頁（報名費、學歷證件、成績計算）最後才看。
function qualification(programName, pageNos, pages, ownPg = []) {
  const {core} = nameParts(programName);
  for (const n of [...ownPg, ...pageNos.filter(n => !ownPg.includes(n))]) {
    const text = pages[n - 1] || '';
    const at = text.search(new RegExp(loose(core)));
    const from = at >= 0 ? at : 0;
    const rest = text.slice(from);
    // 「若報考資格不符規定」「報名資格」」只是句子裡提到，不是標題：跳過，找下一個。
    // 但「符合下列任何一項申請資格，並檢附證明文件：」整行以冒號收尾，是清單的引言（陽明交大應化），要留。
    const h = [...rest.matchAll(new RegExp(QUAL_HEAD.source, 'g'))].find(m => {
      const after = rest.slice(m.index + m[0].length);
      return !/^[\s:：）)]*(不符|[，,、。」』])/.test(after) || /^[，,][^\n。；，,]{1,20}[：:]\s*\n/.test(after);
    });
    if (!h) continue;
    const body = rest.slice(h.index + h[0].length).replace(/^[\s:：）)，,]+/, '');
    // 表格把欄名放在左欄時（陽明交大），資格清單後面直接接「900 元」這種報名費金額：也當作結束。
    const end = body.slice(8).search(new RegExp(`${NEXT_HEAD.source}|\\n\\s*\\d[\\d,]*\\s*元`));
    let q = (end >= 0 ? body.slice(0, end + 8) : body).trim();
    if (q.length < 12) continue;
    q = reflow(q);
    if (q.length > 900) q = q.slice(0, 900).replace(/\n[^\n]*$/, '') + '\n…';
    return {qx: q, qxp: n};
  }
  return null;
}
// Undo the PDF's hard line breaks: a line joins the previous one unless it starts a numbered item
// or the previous line ends a sentence.
const ITEM_START = /^(\d+[.、．)）]|[(（]\d+[)）]|[一二三四五六七八九十]+[、.．]|[(（][一二三四五六七八九十]+[)）]|[※＊*•●■□◎◆①-⑳]|[A-Za-z][.)、])/;
function reflow(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev === undefined || ITEM_START.test(line) || /[：:。；;]$/.test(prev)) out.push(line);
    else out[out.length - 1] = prev + (/[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(line) ? ' ' : '') + line;
  }
  return out.join('\n');
}

/* ---------- 6. the department's required-document list (指定繳交資料) ---------- */
// 先找明確的「指定繳交資料」類標題；找不到才退而用「資料審查」「書面審查」這類也可能出現在別處的字。
const DOC_HEAD_STRICT = ['指定繳交資料', '指定審查資料', '學系指定應繳文件', '學系指定繳交資料', '學系指定上傳資料', '指定上傳書面資料', '指定上傳報考文件', '指定繳交文件', '應繳交表件及資料', '應繳交表件', '應交報考資料', '應繳交資料', '應繳資料', '應繳文件', '審查資料', '繳交資料', '書面審查資料', '備審資料'];
const DOC_HEAD_LOOSE = ['審查項目', '資料審查', '書面審查'];
const headRe = list => new RegExp(`(${list.map(loose).join('|')})[\\s：:]*`, 'g');
// 「其他有利審查資料」「下列各項書面審查資料」是清單裡的一項或引言，不是標題（元智資工一般組因此抓到隔壁欄資安組的清單）。
// 寬鬆標題只留「各項」這種引言；「其他有利審查資料」後面接的是下一個甄試項目（嘉義的面試配分、銘傳的報考資格第 5 項），不是清單。
// 「※備審資料請合併為一個檔案」（嘉義特教）這種同一行前面有 ※、◎ 的是附註，不是標題：照它讀下去會讀到面試的評分說明。
const inPhrase = (text, at, strict = true) => { const pre = text.slice(text.lastIndexOf('\n', at - 1) + 1, at); return /[※＊◎●]/.test(pre) || (strict ? /(有利|有助於?|其他|相關|各項)$/ : /(有利|有助於?|其他|相關)$/).test(pre); };
const DOC_STOP = /^(面試|口試|筆試|術科|甄試|甄選|複試|初試|成績|總成績|同分|佔總成|備註|聯絡|其他規定|注意事項|錄取|放榜|報到|時間|地點|日期|參加資格|評分|各項目|上傳|繳交方式|資料繳交|審查方式|審查標準|優先錄取|考試方式|考試項目|學系特色|本系特色|系所特色|特色及備註|註[:：]|說明[:：])/;
// 沒編號的行多半是上一行換過來的：「得以其他\n成績證明取代」（臺南生態）、「在學\n成績單」不是下一段；以「成績」開頭的只有「成績計算」「成績比例」這種欄名才算。
const stopLine = l => DOC_STOP.test(l) && !/^成績(?!\s*(計算|比例|比率|[佔占]|同分|複查|\d|$))/.test(l);
const PCT = /\d+\s*[%％]/;
// 「書面資料審查(50%)」「英文口試(50%)」是甄試項目；「高中歷年成績單。(25%)」是附了配分的繳交項目，要留著。
const EXAM_ITEM = /(審查|面試|口試|筆試|術科|實作|測驗|甄試|初試|複試|問答|口頭報告)\s*[(（]?\s*\d+\s*[%％]/;
// 編號的層級照公文慣例：一、 >（一）> 1. >（1）> 1)。同一份清單只用一種；更高一層的編號表示清單結束，更低一層的是某一項的子項目。
const ITEM_RE = /^\s*(\(?\d{1,2}[.、．)）]|[(（]\d{1,2}[)）]|[一二三四五六七八九十]{1,2}[、.．]|[(（][一二三四五六七八九十]{1,2}[)）])\s*(.+)$/;
const numOf = s => { const d = /\d+/.exec(s); if (d) return +d[0]; const c = /[一二三四五六七八九十]+/.exec(s)[0], v = ch => '一二三四五六七八九'.indexOf(ch) + 1; return c === '十' ? 10 : c[0] === '十' ? 10 + v(c[1]) : c[1] === '十' ? v(c[0]) * 10 + (c[2] ? v(c[2]) : 0) : v(c[0]); };
const rankOf = s => /^[一二三四五六七八九十]/.test(s) ? 1 : /^[(（][一二三四五六七八九十]/.test(s) ? 2 : /^\d/.test(s) ? (/[)）]$/.test(s) ? 5 : 3) : 4;
const LEAD = /([：:]|包含|如下|如下列|為|分別為)$/;
const NOTE_RE = /^[※＊*◎●]|^註[:：]/;
const DOC_WORD = /證明|資料|自傳|成績|表|函|信|作品|計畫|影本|文件|報告|紀錄|證書|證照|履歷|書|單|照片|影片/;
const QUAL_WORD = /^(曾|獲|符合|具有|具備|參加|參與|通過|取得|有|持有|於|在)/;
// 成績計算、錄取標準、繳費步驟的條列也像清單（中教大第 30 頁「滿分皆為 100 分」「以零分計」），不是要交的東西。
const NOT_DOC = /總成績|滿分|零分|錄取標準|成績計算|四捨五入|不予錄取|同分|比序|繳費|報名費|劃撥|郵局|提款機|信封/;
// 表格的直排欄名只有兩個字時 joinSingles 不會接（嘉義「面／試」）：清單裡遇到就先接回來，才認得出是下一個甄試項目。
function mergeSingles(lines) {
  const out = [];
  let prevSingle = false;
  for (const l of lines) {
    const single = /^[㐀-鿿]$/.test(l.trim());
    if (single && prevSingle) out[out.length - 1] += l.trim(); else out.push(single ? l.trim() : l);
    prevSingle = single;
  }
  return out;
}
// 換行切在句子中間（上一行以「、」「占」或還沒關的括號結尾），下一行的「15 %（考生…」「資訊安全…作品等）。(25%)」是同一項的後半，不是下一個甄試項目。
const openEnded = s => /[、，,（(占佔為前及與或之的和等如：:]$/.test(s.trim()) || count(s, /[(（]/g) > count(s, /[)）]/g);
// 「下列證明至少擇一繳交：(1)…(2)…」「內容可為 (1)…」「須涵蓋：(1)…」：子項目是可選的東西或要寫的內容，要一項一項列出來。
// 其餘的子項目（「身分證明文件：（一）特殊才能…（二）新住民及其子女 1.… 2.…」這種還有下一層的）是細目，接回那一項就好。
const OPTIONS = /[：:]$|擇一|擇優|下列|以下|如下|可為|包含|包括|涵蓋/;
// 表格「項目｜佔分%｜備註」（馬偕）：行首的「25% 針對課程…」「40% 必繳」、單獨一行的「必繳」是右邊的配分、必繳欄，這一項的名稱到此為止，
// 底下到下一個編號前的字是備註欄（「果」「溝通、協調與合作…」）。以前把行首的配分當成這一項欠的配分，連備註一起接上去了。
const COL = /^(?:(\d+)\s*[%％]\s+\S.*|(必繳|選繳|選填))$/;
// 編號那一行就帶著欄位（「2. 高中（職）歷年在校成績證明 30% 必繳」）：底下也是備註欄。
const COL_END = /^(.*\S)\s+(\d+)\s*[%％]\s*(必繳|選繳|選填)$/;
// 「請將上述審查資料，依序掃描彙整…」（師大臺語）講的是整份清單怎麼交，不是最後一項的後半。
const BACKREF = /^(請將|請把)|^(上述|以上|前述|前列|上列)(各項|所列|資料|文件|審查|書面|項目|所有)/;
// 項目後面的「(選繳)」，以及清單底下「※ 上述第 1 至 4 項為必繳資料，第 5 項為選繳資料」（政大各系）、「註：上述第4、5項資料為選擇性繳交資料」（成大）點名的項目：
// 前端靠「選繳」判斷可以不交，所以標在那一項後面；句號、70 字的截斷都不能把它切掉。
// 附註提到的最後一項要剛好是清單的最後一項才算：政大中文寫「第 1 至 2 項為必繳資料，第 3 項為選繳資料」，清單卻有 4 項，對不上就不標。
// 「(選填)」「- 選填」（元智、馬偕）也是選繳，統一寫成「（選繳）」，前端只認得選繳、非必繳。
const OPT_TAG = /\s*(?:[(（]\s*(?:選繳|非必繳|選填)\s*[)）]|-\s*選填)[。；;，,\s]*$/;
function optNums(note, last) {
  const opt = new Set();
  let max = 0;
  for (const c of note.split(/[，,；;。]/)) {
    if (!/項/.test(c)) continue;
    const nums = [];
    for (const d of c.replace(/(\d+)\s*[至~～\-－到]\s*第?\s*(\d+)/g, (_, a, b) => { for (let n = +a; n <= +b; n++) nums.push(n); return ''; }).match(/\d+/g) || []) nums.push(+d);
    max = Math.max(max, ...nums.filter(n => n < 20));
    if (/選繳|選擇性|非必備|非必要/.test(c)) nums.forEach(n => opt.add(n));
  }
  return max === last ? opt : new Set();
}
const DOC_TITLE = new RegExp(`^(${[...DOC_HEAD_STRICT, ...DOC_HEAD_LOOSE].join('|')})$`);
function requiredDocs(text, from, next = '') {
  let lines = text.slice(from).split('\n');
  // 清單寫到頁尾、下一頁也是這個系的（暨南「一、身分證明文件」的細目佔掉大半頁，二到六項在下一頁）：接著讀下一頁。
  if (lines.length < 40 && next) lines = lines.concat(next.split('\n').slice(0, 40));
  lines = mergeSingles(lines.slice(0, 80));
  const items = [], subs = [];
  const groups = new Map();   // 項目序號 → {head：子項目出現前那一項的文字, from/to：在 subs 裡的範圍, rank：子項目的層級, deep：子項目底下還有一層}
  let preamble = 0, mark = 0, inSub = false, first = '', flat = 0, k = 0, subsAt = 0;   // subsAt：最後一項開始時已有幾個子項目
  let notes = 0, lastNum = 0, regroup = false;   // notes：「※注意事項：」底下說明的編號層級（-1 表示還沒遇到編號）；lastNum：清單最後一項的序號；regroup：剛過「選擇性繳交資料：」這種分組引言
  let aside = false;   // 剛過一行「※審查資料如為共同合作之作品，須檢附全體參與創」這種附註（或表格的配分欄、「請將上述…」）：底下沒編號的行是附註、備註欄的字，不是上一項的
  let colPct = '';   // 剛跳過的單獨一行配分（「20%」），下一行是「必繳」時記到這一項
  const byNum = new Map();   // 項目序號 → items 裡的位置，給「第 5 項為選繳資料」用
  for (; k < lines.length; k++) {
    const line = lines[k].trim();
    if (!line) continue;
    const m = ITEM_RE.exec(line);
    // 「一、原創作品：… ※注意事項：1.… 2.… 二、書面資料：…」（北藝音像）：注意事項跳過，比它高一層、接著編號的「二、」回到清單。
    if (notes) {
      if (!m) { if (stopLine(line)) break; continue; }
      const r = rankOf(m[1]);
      if (notes < 0) notes = r;
      if (!(r < notes && r === mark && numOf(m[1]) === lastNum + 1)) { if (r < mark) break; continue; }
      notes = 0;
    }
    if (m) {
      aside = false;
      const r = rankOf(m[1]), body = m[2];
      if (/\d+\s*[%％]/.test(body) && (EXAM_ITEM.test(body) || DOC_STOP.test(body))) { if (items.length) break; continue; }   // 甄試項目擠在同一欄：清單前的跳過，清單後的就是下一個甄試項目
      if (mark && r < mark) {
        // 從「（五）境外臺生」這種子項目中段開始的（上一頁接過來），遇到上一層的「二、」才是真正的清單。
        if (!/^[(（]?(1|一)[.、．)）]/.test(first)) { items.length = subs.length = subsAt = 0; groups.clear(); byNum.clear(); mark = r; first = m[1]; lastNum = numOf(m[1]); items.push(body); byNum.set(lastNum, 0); inSub = false; continue; }
        // 回到上一層：「2. 選擇性繳交資料：」是下一組，「二、面試」「二、考生應將資料寄送…」就是清單結束。
        if (LEAD.test(body) && !DOC_STOP.test(body)) { regroup = true; continue; }
        break;
      }
      // 「5. (1)近三年競賽… (2)社團… (3)其他…」：第 5 項本身就是一串並列的項目，攤平。
      if (mark && r === flat) { items.push(body); subsAt = subs.length; inSub = false; continue; }
      if (mark && r > mark) {
        // 「一、報名時應繳齊下列各項資料：」「1. 資料審查包含：」只是引言，下一層的（一）（二）才是清單；其他情況是那一項的子項目，接回去。
        // 前面幾項只是配分類別（大葉「一、項目：（一）證照…70%」）時，「二、應繳資料，請依篩選條件檢附如下：」才是清單的引言。
        const last = items[items.length - 1];
        if (subs.length === subsAt && LEAD.test(last.trim()) && /下列|以下|如下|包含|包括/.test(last) && items.slice(0, -1).every(i => /\d+\s*[%％]|^項目/.test(i))) { mark = r; first = m[1]; lastNum = numOf(m[1]); items.length = 0; groups.clear(); byNum.clear(); items.push(body); byNum.set(lastNum, 0); subsAt = subs.length; continue; }
        const g = groups.get(items.length - 1);
        if (!g) groups.set(items.length - 1, {head: last, from: subs.length, to: subs.length + 1, rank: r, deep: false});
        else if (r > g.rank) g.deep = true;
        else g.to = subs.length + 1;
        items[items.length - 1] += ' ' + line;
        subs.push(body);
        inSub = true;
        continue;
      }
      if (DOC_STOP.test(body) || /\d+\s*年\s*\d+\s*月/.test(body)) break;
      if (mark === r && numOf(m[1]) <= lastNum && !regroup) break;   // 編號倒回去（「七、」之後又是「三、願景組」）：另一份清單；「選擇性繳交資料：」底下重新編號的不算
      regroup = false;
      if (!items.length) first = m[1];
      const inner = ITEM_RE.exec(body);
      flat = inner ? rankOf(inner[1]) : 0;
      const ce = COL_END.exec(inner ? inner[2] : body);
      items.push(ce ? `${ce[1]}（${ce[2]}%）${ce[3] === '必繳' ? '' : '（選繳）'}` : inner ? inner[2] : body);
      aside = !!ce;
      subsAt = subs.length;
      lastNum = numOf(m[1]);
      byNum.set(lastNum, items.length - 1);
      mark = r;
      inSub = false;
    } else if (items.length) {
      // 「*註：」底下是注意事項，不是清單；附註點名的選繳項目先標上。
      if (NOTE_RE.test(line)) {
        for (const n of optNums(line, lastNum)) if (byNum.has(n) && !OPT_TAG.test(items[byNum.get(n)])) items[byNum.get(n)] += '（選繳）';
        if (/[：:]$/.test(line)) notes = -1; else aside = true;
        continue;
      }
      if (/^[【〔]/.test(line)) break;   // 「【繳交方式】」「【面試】」是下一段
      const cur = inSub ? subs[subs.length - 1] : items[items.length - 1];
      // 表格裡另一欄的配分、比序（「10% 3」）跳過；上一行停在「，占」的，是這一項自己的配分，接上去。
      // 單獨的「20%」後面緊接一行「必繳」（馬偕聽語第 3 項）：配分先記著，給下一行的欄位用。
      if (/^\d+\s*[%％](\s+\d+)?$/.test(line) && !/[占佔]$/.test(cur.trim())) { colPct = /^\d+/.exec(line)[0]; continue; }
      const col = COL.exec(line);
      if (col && !aside && !PCT.test(cur) && !EXAM_ITEM.test(line)) {
        const tag = (col[1] || colPct ? `（${col[1] || colPct}%）` : '') + (/選繳|選填/.test(line) ? '（選繳）' : '');
        items[items.length - 1] += tag;
        if (inSub) subs[subs.length - 1] += tag;
        aside = true;
        colPct = '';
        continue;
      }
      colPct = '';
      if (BACKREF.test(line)) { aside = true; continue; }
      // 換行切在詞中間（嘉義「…發展潛能之證」「明，占 20 %」、屏東「…辦理之資」「訊科技…獲獎。(10%)」）：前面幾項都有配分、這一項還沒有，這行的配分就是這一項的，接上去。
      const owes = !PCT.test(cur) && (inSub ? subs.slice(groups.get(items.length - 1).from, -1) : items.slice(0, -1)).every(t => PCT.test(t)) && !EXAM_ITEM.test(line);
      if (stopLine(line) || PCT.test(line) && !openEnded(cur) && !owes) break;
      if (aside) continue;
      items[items.length - 1] += line;
      if (inSub) subs[subs.length - 1] += line;
      regroup = /(繳交|資料|文件|證明)[^：:]{0,6}[：:]$/.test(line);   // 「選擇性繳交資料：」；「同時符合以下資格之一者：」底下是報考資格，不算
    } else if (++preamble > 6 || /^(學系特色|本系特色|備註|聯絡|同分)/.test(line)) break;   // 標題底下還沒有清單就換了段落
  }
  const cut = k === lines.length;   // 一路到頁尾：清單可能接到下一頁
  const tidy = i => {
    let t = i.replace(/\s+/g, ' ').trim();
    const opt = OPT_TAG.test(t);   // 輔大「其他有利審查資料，無則免交。(選繳)」：標記在句號後面
    t = t.replace(OPT_TAG, '');
    const stop = t.search(/[。；;]/);
    if (stop >= 8) t = t.slice(0, stop);
    t = t.replace(/([%％])\s+(\d|-+)$/, '$1').replace(/[。；;：:，,]+$/, '').trim();   // 「… 50% 1」尾巴是比序欄
    if (t.length > 70) t = t.slice(0, 70) + '…';
    return opt ? t + '（選繳）' : t;
  };
  const keep = t => t.length >= 2 && !LEAD.test(t) && !/^優先錄取/.test(t);
  // 「1.特殊選才資格證明資料…；2.自傳…；3.讀書計畫…」寫成同一段（銘傳）：照編號拆開。
  const split = t => { const parts = t.split(/[；;]\s*(?=\d{1,2}[.、．](?!\d))/); return parts.length > 1 && parts.slice(1).every((p, n) => parseInt(p, 10) === n + 2) ? parts.map(p => p.replace(/^\d{1,2}[.、．]\s*/, '')) : [t]; };
  // 只有一項、或每項都只是配分類別（「1、學業資料，佔總成績比例 30%」），底下分（1）（2）列：真正的清單是那些子項目。
  // 到頁尾就斷掉的不算，那多半是第一項的細目，後面幾項在下一頁。
  if (subs.length >= 2 && (items.length === 1 && !cut || items.every(i => /\d+\s*[%％]/.test(i)))) return accept(subs.flatMap(split).map(tidy).filter(keep));
  // 「2. 資料審查：(1) 曲目表 (2) 演奏錄影…」（東海音樂）：那一項只是標題，清單是它底下的子項目，前後的注意事項不算。
  const titled = [...groups.values()].find(g => !g.deep && g.to - g.from >= 2 && DOC_TITLE.test(tidy(g.head)));
  if (titled) return accept(subs.slice(titled.from, titled.to).map(tidy).filter(keep));
  // 可選的子項目攤開來列；引言本身要看得完整（「下列證明至少擇一繳交」），被句號或 70 字截斷的就不攤開，免得選項看起來像必繳的。
  // 「至少須具備以下條件之一：(一) 曾參加…者」列的是報考條件，不是要交的東西，照舊接在那一項後面。只看引言最後一段：臺大中文「請勾選符合的報名條件，並檢具證明文件：」底下是要附的文件。
  const conditions = g => /條件[^，,。；;]*$/.test(g.head.trim()) || subs.slice(g.from, g.to).filter(t => /者[。．.]?$/.test(t.trim()) || QUAL_WORD.test(t.trim()) && !DOC_WORD.test(t)).length * 2 >= g.to - g.from;
  const whole = g => { const h = g.head.replace(/\s+/g, ' ').trim(), t = tidy(h); return !t.endsWith('…') && h.replace(/[。；;：:，,\s]+$/, '') === t; };
  const options = new Set([...groups].filter(([, g]) => !g.deep && g.to - g.from >= 2 && OPTIONS.test(g.head.trim()) && !conditions(g)).map(([i]) => i));
  const open = new Set([...options].filter(i => whole(groups.get(i))));
  // 沒攤開的選項組接回那一項時，引言和每個子項目先各自切短再合併；整段合併後才切，第一個句號後面的子項目全掉了
  //（長庚護理「個人簡歷資料須涵蓋：(1)讀書計畫…。(2)自傳…(4)關懷利他經驗…」只剩 (1)；臺大中文自檢表要附的競賽簡章、獎狀、得獎作品不見了）。
  // 引言留第一句和最後一句（「…學士班下載。請勾選符合的報名條件，並檢具證明文件：」），子項目留名稱（「學習心得：參與多元…」只留「學習心得」）。
  const short = s => {   // 括號裡的逗號不算（大葉「獲 APCS(大學程式設計先修檢測，含程式識讀+程式實作)…」）
    const t = tidy(s);
    for (let k = 0, d = 0; t.length > 20 && k < t.length; k++) { if (/[(（]/.test(t[k])) d++; else if (/[)）]/.test(t[k])) d--; else if (!d && k >= 2 && /[，,：:]/.test(t[k])) return t.slice(0, k); }
    return t;
  };
  const merged = g => {
    const h = g.head.replace(/\s+/g, ' ').trim().split(/(?<=[。；;])\s*/).filter(Boolean);
    const t = `${(h.length > 1 ? h[0] + h[h.length - 1] : h[0]).replace(/[。；;：:，,\s]+$/, '')}：${subs.slice(g.from, g.to).map((s, j) => `(${j + 1})${short(s)}`).join(' ')}`;
    return t.length > 120 ? t.slice(0, 120) + '…' : t;
  };
  const build = () => items.flatMap((t, i) => open.has(i) ? [{t: tidy(groups.get(i).head), main: true}, ...subs.slice(groups.get(i).from, groups.get(i).to).map(s => ({t: tidy(s)}))]
    : options.has(i) ? [{t: merged(groups.get(i)), main: true}] : split(t).map(t => ({t: tidy(t), main: true}))).filter(x => keep(x.t));
  let rows = build();
  // 攤開後超過 8 項、又會擠掉後面的主項目（臺北大學歷史「三、其他有利申請資料：（一）…（五）」後面還有「四、推薦函」）：子項目最多的那組接回去。
  while (open.size && rows.length > 8 && rows.findLastIndex(x => x.main) >= 8) {
    open.delete([...open].sort((a, b) => (groups.get(b).to - groups.get(b).from) - (groups.get(a).to - groups.get(a).from))[0]);
    rows = build();
  }
  return accept(rows.map(x => x.t));
}
function accept(clean) {
  const share = re => clean.filter(t => re.test(t)).length / clean.length;
  if (!clean.length || share(DOC_WORD) < 0.5 || share(QUAL_WORD) > 0.5 || share(NOT_DOC) >= 0.5) return [];
  return clean.slice(0, 8);
}
// 同一頁有好幾組（元智資工「一般組｜資安外加」兩欄並排）時，靠組名的關鍵字分辨清單：資安組要有「資安」，一般組避開別組的字。
const specWords = name => nameParts(name).quals.filter(q => !GENERAL.has(q)).map(q => q.replace(/(外加|專班|組|生|班)+$/, '')).filter(w => w.length >= 2);
function documentList(programName, pageNos, pages, avoid = [], ownPg = []) {
  const want = specWords(programName), {core} = nameParts(programName);
  // 清單裡就有組名最準；只有這個系的頁首寫了組名（暨南「（二）丙組(資安外加組)」）次之。
  const fit = (items, n) => {
    const s = items.join(''), head = norm(pages[n - 1] || '').slice(0, 150);
    return (want.some(w => s.includes(w)) ? 2 : head.includes(core) && want.some(w => head.includes(w)) ? 1 : 0) - (avoid.some(w => s.includes(w)) ? 2 : 0);
  };
  // 接續頁：去掉頁首的頁碼和系名那幾行。
  const nextOf = n => !pageNos.includes(n + 1) ? '' : (pages[n] || '').split('\n').filter((l, i) => !(i < 3 && (/^[-–—\s]*\d{1,3}[-–—\s]*$/.test(l) || norm(l).includes(core)))).join('\n');
  for (const pgs of [ownPg, pageNos.filter(n => !ownPg.includes(n))]) {
    for (const strict of [true, false]) {
      let best = [], bestFit = -2;
      for (const n of pgs) {
        const text = pages[n - 1] || '';
        for (const m of text.matchAll(headRe(strict ? DOC_HEAD_STRICT : [...DOC_HEAD_STRICT, ...DOC_HEAD_LOOSE]))) {
          if (inPhrase(text, m.index, strict)) continue;
          const items = requiredDocs(text, m.index + m[0].length, nextOf(n));
          if (items.length < 2) continue;
          const f = fit(items, n);
          if (f > bestFit || f === bestFit && items.length > best.length) { best = items; bestFit = f; }
        }
        // 有組名可對（資安外加、願景組）時，要對上的清單才停；暨南資安外加資管的第一頁是願景組的頁。
        if (best.length >= 3 && bestFit >= (want.length ? 1 : 0)) break;
      }
      if (best.length) return best;
    }
  }
  return [];
}

/* ---------- 7. 面試注意事項與備審格式規定：從系所頁面抓出相關的句子 ---------- */
// 簡章的這些細節（視訊面試、全英語、簡報幾分鐘、自傳一千字以內、PDF 幾 MB）不在整理資料裡，但會害人。
const IV_TOPIC = /面試|口試|複試|甄試|第二階段|二階/;
const IV_DETAIL = /視訊|線上|英語|英文|簡報|分鐘|攜帶|自備|准考證|投影片|現場|團體|個別|系網|網站|公告|公布|報到|地點|實作|上機|筆試|術科|抽籤|服裝|遲到/;
const FMT_DETAIL = /(\d+|[一二三四五六七八九十]+)\s*(字|頁|張|份|MB|mb|M)|PDF|pdf|檔案|格式|合併|裝訂|手寫|郵戳|確認|密封|直式|橫式|解析度|連結|QR/;
// 「應用」「應屆」不是規定的語氣（靜宜人文「培養π型人才，連結…數位應用」是學系特色）。
const FMT_LIMIT = /以內|為限|不超過|至多|上限|最多|限|須|請|應(?![用屆])|需|不得|勿/;
const SKIP_SENT = /^(第[一二三四五六七八九十]+條|註[:：]|備註)/;
const count = (s, re) => (s.match(re) || []).length;
// 括號沒配對、以標點開頭的多半是被換頁切斷的句子，不要。
const fragment = s => /^[)）、，,：:。；;]/.test(s) || count(s, /[)）]/g) > count(s, /[(（]/g) || /[(（][^)）]*$/.test(s) && count(s, /[(（]/g) > count(s, /[)）]/g) + 0;
function sentencesOf(text) {
  return text.split(/(?<=[。；;])|\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length >= 8 && s.length <= 110 && !SKIP_SENT.test(s) && !fragment(s));
}
function pickSentences(pageNos, pages, test, max = 5) {
  const out = [], seen = new Set();
  for (const n of pageNos) {
    for (const s of sentencesOf(pages[n - 1] || '')) {
      if (!test(s)) continue;
      const key = norm(s).slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s.replace(/[。；;]$/, ''));
      if (out.length >= max) return out;
    }
  }
  return out;
}
const interviewNotes = (pageNos, pages) => pickSentences(pageNos, pages, s => IV_TOPIC.test(s) && IV_DETAIL.test(s) && !/\d+\s*[%％]/.test(s));
// 「請參閱本簡章第 13 頁」「格式請參考附表六」這種只是指路的句子不算規定。
const FMT_REF = /參閱|參考|詳見|請見|來電|附件\s*[\d一二三四五六七八九十]|附表|第\s*\d+(-\d+)?\s*頁|洽詢|電話/;
const formatRules = (pageNos, pages) => pickSentences(pageNos, pages, s => FMT_DETAIL.test(s) && FMT_LIMIT.test(s) && !FMT_REF.test(s) && !IV_TOPIC.test(s.slice(0, 4)) && !/\d+\s*[%％]/.test(s));

/* ---------- main ---------- */
if (!OFFLINE) await fetchPrograms();
const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
const schoolNames = [...new Set(raw.data.map(r => r.school_name))].sort();
const codeOf = Object.fromEntries(raw.data.map(r => [r.school_name, r.school_code]));
if (!OFFLINE) await fetchBrochures(schoolNames.map(n => codeOf[n]));

const programs = raw.data.map(r => compact(r, schoolNames.indexOf(r.school_name))).sort((a, b) => a.s - b.s || a.i.localeCompare(b.i));
// 規則抓不好的少數系組（表格跨頁、清單外另有要交的東西、時程列寫錯）在 data/overrides.json 人工校正，格式見該檔的 note：
// pg 先套用，報名資格、面試、格式規定再從那些頁重抓；docs、scr、it、mx 等其他欄位最後直接蓋過去（null 表示刪掉）；
// ev 是逐列補丁，在 24 時規則之後套；src 記在 ov（簡章出處，前端可改標「人工校對」）。沒對應到簡章頁的系組一樣會套。
const fixes = fs.existsSync(OVERRIDES) ? JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')).programs || {} : {};
const EV_COL = {kind: 0, date: 1, end: 2, time: 3, endTime: 4, label: 5, note: 6};
function patchEv(p, patches) {
  let ev = p.ev || [];
  for (const x of patches) {
    // 加的列插在第一個開始日比它晚的列前面，其他列的順序不動。
    if (x.add) { const k = ev.findIndex(e => e[1] > x.add[1]); ev.splice(k < 0 ? ev.length : k, 0, [...x.add]); continue; }
    const {kind, label, date} = x.match || {};
    const hit = ev.filter(e => (!kind || e[0] === kind) && (!label || new RegExp(label).test(e[5])) && (!date || e[1] === date));
    // 來源改版後對不到的補丁要人工再看，不要默默失效。
    if (!hit.length) console.log(`overrides：${p.i} 的 ev 補丁對不到任何列 ${JSON.stringify(x.match)}`);
    if (x.delete) ev = ev.filter(e => !hit.includes(e));
    else for (const e of hit) for (const [k, v] of Object.entries(x.set || {})) e[EV_COL[k]] = v;
  }
  if (ev.length) p.ev = ev; else delete p.ev;
}
function applyFix(p, {pg, src, ev, ...fix}) {
  for (const [k, v] of Object.entries(fix)) if (v === null) delete p[k]; else p[k] = v;
  if (ev) patchEv(p, ev);
  if (src) p.ov = src;
}
const schools = [];
let mapped = 0;
for (const [s, name] of schoolNames.entries()) {
  const code = codeOf[name];
  const text = await extractText(code, name);
  const own = programs.filter(p => p.s === s);
  if (text) {
    const pages = mapPages(own, text.pages);
    // 系所自己的頁：頁首只出現這一個系名。「報考美術學系、視覺設計學系者」「系所名額表」這種列了好幾系的是通則頁。
    const cores = [...new Set(own.map(p => nameParts(p.n).core))], head = text.pages.map(t => norm(t).slice(0, 150));
    const ownPages = (p, pg) => { const {core} = nameParts(p.n); return pg.filter(n => head[n - 1].includes(core) && !cores.some(c => !core.includes(c) && head[n - 1].includes(c))); };
    const avoidOf = p => { const {core} = nameParts(p.n), mine = specWords(p.n); return own.filter(o => o !== p && nameParts(o.n).core === core).flatMap(o => specWords(o.n)).filter(w => !mine.includes(w)); };
    for (const p of own) {
      const pg = [...(fixes[p.i]?.pg || pages.get(p.i))].sort((a, b) => a - b);
      if (!pg.length) continue;
      p.pg = pg;
      mapped++;
      const mine = ownPages(p, pg);
      const q = qualification(p.n, pg, text.pages, mine);
      if (q) Object.assign(p, q);
      const docs = documentList(p.n, pg, text.pages, avoidOf(p), mine);
      if (docs.length) p.docs = docs;
      const ivn = interviewNotes(pg, text.pages);
      if (ivn.length) p.ivn = ivn;
      const fmt = formatRules(pg, text.pages);
      if (fmt.length) p.fmt = fmt;
    }
  }
  schools.push({name, code, region: regionOf(name), pages: text ? text.pages.length : 0});
}
for (const p of programs) if (fixes[p.i]) applyFix(p, fixes[p.i]);
const out = {source: '特殊選才網 https://sta-tw.org/bochures/（日曆小幫手整理）', year: YEAR, fetched: raw.fetched, schools, programs};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`完成：${programs.length} 個系組、${schools.length} 校；${mapped} 個系組對應到簡章頁面。`);
const missing = programs.filter(p => !p.pg);
if (missing.length) console.log('沒有對應到簡章頁面：' + missing.slice(0, 40).map(p => `${schoolNames[p.s]} ${p.n}`).join('、') + (missing.length > 40 ? ` …等 ${missing.length} 個` : ''));
if (unknownZero.length) console.log(`來源有 ${unknownZero.length} 列 00:00 沒對過簡章，當作時間未知（日期可能晚一天，請查簡章後加進 H24／H0）：` + [...new Set(unknownZero)].join('、'));
