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
  fs.writeFileSync(RAW, JSON.stringify({fetched: new Date().toISOString().slice(0, 10), data: all}));
  console.log(`系組資料：${all.length} 筆`);
}
async function fetchBrochures(codes) {
  fs.mkdirSync(PDF_DIR, {recursive: true});
  for (const code of codes) {
    const file = path.join(PDF_DIR, `${code}.pdf`);
    if (fs.existsSync(file)) continue;
    const res = await fetch(`${API}/brochures/${YEAR}/${code}/download`, {headers: {'User-Agent': UA}});
    if (res.ok) { fs.writeFileSync(file, Buffer.from(await res.arrayBuffer())); console.log(`簡章 ${code} 下載完成`); }
    else console.log(`簡章 ${code} 無法下載（HTTP ${res.status}）`);
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
const cleanPage = s => joinSingles(s.replace(new RegExp(`([${CJK}])[ \\t]+(?=[${CJK}])`, 'g'), '$1').replace(/[ \t]{2,}/g, ' '));
async function extractText(code, school) {
  const pdfFile = path.join(PDF_DIR, `${code}.pdf`);
  const outFile = path.join(TEXT_DIR, `${code}.json`);
  if (!fs.existsSync(pdfFile)) return fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : null;
  if (fs.existsSync(outFile) && fs.statSync(outFile).mtimeMs >= fs.statSync(pdfFile).mtimeMs) return JSON.parse(fs.readFileSync(outFile, 'utf8'));
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
  fs.mkdirSync(TEXT_DIR, {recursive: true});
  fs.writeFileSync(outFile, JSON.stringify(out));
  console.log(`簡章 ${code} ${school}：${pages.length} 頁`);
  return out;
}

/* ---------- 3. compact program records ---------- */
const EMPTY = new Set(['', '-', '未公告', '尚未公告', '尚未公布', '無資料', '#N/A', '#VALUE!', '#DIV/0!', 'N/A', '待統計']);
const val = v => { const s = v == null ? '' : String(v).trim(); return EMPTY.has(s) ? '' : s; };
// 來源資料裡的 00:00 不可靠（逢甲實際是 18:00、靜宜沒寫時間、中教大是 24 時），一律視為「時間未知」。
const tm = v => { const m = /^(\d{1,2}):(\d{2})$/.exec(val(v)); if (!m) return ''; const t = `${m[1].padStart(2, '0')}:${m[2]}`; return t === '00:00' ? '' : t; };
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
    const sd = dt(e.start_date), ed = dt(e.end_date);
    if (!sd && !ed) return [];
    const name = val(e.name);
    return [[kindOf(name), sd || ed, sd && ed && ed > sd ? ed : '', tm(e.start_time), tm(e.end_time), name, val(e.notes)]];
  });
  const it = [...(r.exam_items || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map(i => [val(i.name), typeof i.weight_percent === 'number' ? i.weight_percent : null, val(i.stage), val(i.description)]);
  const p = {
    i: r.program_identifier, s: schoolIndex, n: val(r.admission_program_name).replace(/\s+/g, ' '),
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
const FORM_RE = /報名表|切結書|推薦函格式|推薦信格式|收據|委託書|聲明書|申請表|檢核表|資料表|附表|附件/;
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
      if (alt !== it.core && np.some(t => t.includes(alt))) it.core = alt;
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
    const dedicated = cands.filter(i => specs(i).some(q => variants(q).some(v => adjacent(page, i.core, v))));
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
    if (FORM_RE.test(np[idx].slice(0, 120)) || np[idx].length < 80) continue;
    deptPage[idx] = Object.assign(new Set(deptPage[idx - 1]), {cont: true});
  }
  deptPage.forEach((owners, idx) => { if (owners) for (const id of owners) assigned.get(id).add(idx + 1); });
  return assigned;
}

/* ---------- 5. pull the 報名資格 paragraph out of a department's pages ---------- */
const loose = w => [...w].map(ch => esc(ch)).join('\\s*');
const QUAL_HEAD = new RegExp(`(${['報考資格', '報名資格', '報名條件', '篩選條件', '申請資格', '招生對象'].map(loose).join('|')})`);
const NEXT_HEAD = new RegExp(`(${['招生名額', '甄試項目', '甄選方式', '甄選項目', '考試方式', '考試項目', '指定繳交', '指定審查', '審查資料', '繳交資料', '應繳資料', '應繳文件', '甄試日期', '成績計算', '甄試說明', '面試日期', '學系特色', '本系特色', '報名費', '備註', '注意事項', '評分', '系(班/組)'].map(loose).join('|')})`);
function qualification(programName, pageNos, pages) {
  const {core} = nameParts(programName);
  for (const n of pageNos) {
    const text = pages[n - 1] || '';
    const at = text.search(new RegExp(loose(core)));
    const from = at >= 0 ? at : 0;
    const rest = text.slice(from);
    const h = rest.search(QUAL_HEAD);
    if (h < 0) continue;
    const body = rest.slice(h).replace(QUAL_HEAD, '').replace(/^[\s:：）)]+/, '');
    const end = body.slice(8).search(NEXT_HEAD);
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
const DOC_HEAD_STRICT = ['指定繳交資料', '指定審查資料', '學系指定應繳文件', '學系指定繳交資料', '指定繳交文件', '應繳交資料', '應繳資料', '應繳文件', '審查資料', '繳交資料', '書面審查資料', '備審資料'];
const DOC_HEAD_LOOSE = ['審查項目', '資料審查', '書面審查'];
const headRe = list => new RegExp(`(${list.map(loose).join('|')})[\\s：:]*`, 'g');
const DOC_STOP = /^(面試|口試|筆試|術科|甄試|甄選|複試|初試|成績|總成績|同分|佔總成|備註|聯絡|其他規定|注意事項|錄取|放榜|報到|時間|地點|日期|參加資格|評分|各項目|上傳|繳交方式|資料繳交|審查方式|審查標準|優先錄取|註[:：]|說明[:：])/;
const ITEM_RE = /^\s*(?:\(?\d{1,2}[.、．)）]|[一二三四五六七八九十]{1,2}[、.．])\s*(.+)$/;
const NOTE_RE = /^[※＊*◎●]|^註[:：]/;
const DOC_WORD = /證明|資料|自傳|成績|表|函|信|作品|計畫|影本|文件|報告|紀錄|證書|證照|履歷|書|單|照片|影片/;
const QUAL_WORD = /^(曾|獲|符合|具有|具備|參加|參與|通過|取得|有|持有|於|在)/;
function requiredDocs(text, from) {
  const lines = text.slice(from).split('\n');
  const items = [];
  let preamble = 0;
  for (const raw of lines.slice(0, 40)) {
    const line = raw.trim();
    if (!line) continue;
    const m = ITEM_RE.exec(line);
    if (m) {
      if (/\d+\s*[%％]/.test(m[1])) { items.length = 0; continue; }   // 甄試項目（書面審查 50%）擠在同一欄
      if (DOC_STOP.test(m[1]) || /\d+\s*年\s*\d+\s*月/.test(m[1])) break;
      items.push(m[1]);
    } else if (items.length) {
      if (NOTE_RE.test(line)) continue;
      if (DOC_STOP.test(line) || /\d+\s*[%％]/.test(line)) break;
      items[items.length - 1] += line;
    } else if (++preamble > 6) break;
  }
  const clean = items.map(i => {
    let t = i.replace(/\s+/g, ' ').trim();
    const stop = t.search(/[。；;]/);
    if (stop >= 8) t = t.slice(0, stop);
    t = t.replace(/[。；;：:，,]+$/, '').trim();
    if (t.length > 70) t = t.slice(0, 70) + '…';
    return t;
  }).filter(t => t.length >= 2 && !/([：:]|包含|如下|如下列|為|分別為)$/.test(t) && !/^優先錄取/.test(t));
  if (!clean.length || clean.filter(t => DOC_WORD.test(t)).length < clean.length / 2 || clean.filter(t => QUAL_WORD.test(t)).length > clean.length / 2) return [];
  return clean.slice(0, 8);
}
function documentList(programName, pageNos, pages) {
  for (const heads of [DOC_HEAD_STRICT, DOC_HEAD_LOOSE]) {
    let best = [];
    for (const n of pageNos) {
      const text = pages[n - 1] || '';
      for (const m of text.matchAll(headRe(heads))) {
        const items = requiredDocs(text, m.index + m[0].length);
        if (items.length >= 2 && items.length > best.length) best = items;
      }
      if (best.length >= 3) break;
    }
    if (best.length) return best;
  }
  return [];
}

/* ---------- 7. 面試注意事項與備審格式規定：從系所頁面抓出相關的句子 ---------- */
// 簡章的這些細節（視訊面試、全英語、簡報幾分鐘、自傳一千字以內、PDF 幾 MB）不在整理資料裡，但會害人。
const IV_TOPIC = /面試|口試|複試|甄試|第二階段|二階/;
const IV_DETAIL = /視訊|線上|英語|英文|簡報|分鐘|攜帶|自備|准考證|投影片|現場|團體|個別|系網|網站|公告|公布|報到|地點|實作|上機|筆試|術科|抽籤|服裝|遲到/;
const FMT_DETAIL = /(\d+|[一二三四五六七八九十]+)\s*(字|頁|張|份|MB|mb|M)|PDF|pdf|檔案|格式|合併|裝訂|手寫|郵戳|確認|密封|直式|橫式|解析度|連結|QR/;
const FMT_LIMIT = /以內|為限|不超過|至多|上限|最多|限|須|請|應|需|不得|勿/;
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
const formatRules = (pageNos, pages) => pickSentences(pageNos, pages, s => FMT_DETAIL.test(s) && FMT_LIMIT.test(s) && !IV_TOPIC.test(s.slice(0, 4)) && !/\d+\s*[%％]/.test(s));

/* ---------- main ---------- */
if (!OFFLINE) await fetchPrograms();
const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
const schoolNames = [...new Set(raw.data.map(r => r.school_name))].sort();
const codeOf = Object.fromEntries(raw.data.map(r => [r.school_name, r.school_code]));
if (!OFFLINE) await fetchBrochures(schoolNames.map(n => codeOf[n]));

const programs = raw.data.map(r => compact(r, schoolNames.indexOf(r.school_name))).sort((a, b) => a.s - b.s || a.i.localeCompare(b.i));
const schools = [];
let mapped = 0;
for (const [s, name] of schoolNames.entries()) {
  const code = codeOf[name];
  const text = await extractText(code, name);
  const own = programs.filter(p => p.s === s);
  if (text) {
    const pages = mapPages(own, text.pages);
    for (const p of own) {
      const pg = [...pages.get(p.i)].sort((a, b) => a - b);
      if (!pg.length) continue;
      p.pg = pg;
      mapped++;
      const q = qualification(p.n, pg, text.pages);
      if (q) Object.assign(p, q);
      const docs = documentList(p.n, pg, text.pages);
      if (docs.length) p.docs = docs;
      const ivn = interviewNotes(pg, text.pages);
      if (ivn.length) p.ivn = ivn;
      const fmt = formatRules(pg, text.pages);
      if (fmt.length) p.fmt = fmt;
    }
  }
  schools.push({name, code, region: regionOf(name), pages: text ? text.pages.length : 0});
}
const out = {source: '特殊選才網 https://sta-tw.org/bochures/（日曆小幫手整理）', year: YEAR, fetched: raw.fetched, schools, programs};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`完成：${programs.length} 個系組、${schools.length} 校；${mapped} 個系組對應到簡章頁面。`);
const missing = programs.filter(p => !p.pg);
if (missing.length) console.log('沒有對應到簡章頁面：' + missing.slice(0, 40).map(p => `${schoolNames[p.s]} ${p.n}`).join('、') + (missing.length > 40 ? ` …等 ${missing.length} 個` : ''));
