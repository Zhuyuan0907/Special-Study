# 前端慣例（給寫各個畫面的人）

DESIGN.md 是規格；這份只講外框（F2）提供了什麼、畫面要怎麼接。共用的東西不要在畫面裡再寫一份。

## 檔案

| 檔案 | 內容 | 誰改 |
|---|---|---|
| `public/index.html` | 頂欄、三個 `<section class="view">`、兩個 `<dialog>`、`#bar`、`#toast`、`#print` | F2 |
| `public/style.css` | 色彩、字級、按鈕、勾選框、列、區段標題、「改」表單、對話框、小選單、提示 | F2 |
| `public/css/{next,schools,calendar,add,settings}.css` | 各畫面自己的版面 | 各畫面 |
| `public/js/core.js` | 時間、狀態 `S`／`P`、載入、`mutate`、提示、logic 的包裝 | F2 |
| `public/js/router.js` | 網址 ↔ 畫面 | F2 |
| `public/js/ui.js` | HTML 小零件、「改」表單、小選單、`openDialog` | F2 |
| `public/js/app.js` | 啟動、分頁、快速鍵、標題、簡章更新提示 | F2 |
| `public/js/logic.js` | 事件模型（純函式） | F1 |
| `public/js/{next,schools,calendar,add,settings}.js` | 各畫面 | 各畫面 |

舊版（本週、備審、找科系、精靈）的模組已經拿掉，要看就看 git 歷史。

## 畫面模組的介面

```js
// next.js / schools.js / calendar.js
export function init() {}          // 啟動時呼叫一次（資料還沒到）：在自己的 section 上掛事件（委派）
export function render(route) {}   // 資料到了、切到這個畫面、資料改了、回到網頁重新載入、時間跨過某個點時呼叫
// add.js / settings.js
export function init() {}
export function open(opts) {}      // add: {pid, q}；settings: 'ics' | 'notify' | … 要打開哪一頁
export function render() {}
```

- `render(route)` 會被呼叫很多次（每次 `mutate`、每次回到網頁有新資料、每分鐘議程有變時）。它必須是**冪等**的：同樣的資料畫出同樣的畫面，並且保留自己的狀態（選了哪一列、捲到哪裡、展開了什麼）。這些狀態放在模組變數裡，不要靠 DOM。重畫捲動區之前先記下 `scrollTop`，畫完再設回去。
- 事件用委派，在 `init()` 掛在 `#view-next`（或 `#view-schools` 等）上一次就好。`render()` 只換 `innerHTML`，不要每次都重掛。
- 只有目前的畫面會被 `render`。對話框（加學校、設定）如果開著時要跟著資料更新，自己 `onChange(fn)` 訂閱，並且在 `dialog.open` 為 false 時直接 return。
- 資料還沒載完不會呼叫 `render`（`app.js` 等 `core.load()` 完成）。所以 `render` 裡 `S.loaded` 和 `P.loaded` 都是 true。簡章資料萬一沒載入，`P.byId` 是空的，`programOf(app)` 回傳 null，logic 也照樣能跑。
- `route` = `{view, id, month}`：`#schools/<id>` 的 `id` 是 app id，`#calendar/2026-11` 的 `month` 是 `'2026-11'`，沒有就是 `''`。`#schools` 沒有 id 時，學校畫面自己決定開哪一間（規格：接下來第一列的學校），再用 `setUrl({view:'schools', id})` 把網址補齊（不會多一筆上一頁，也不會再 render 一次）。

## 網址與連結

```js
import {go, setUrl, href, route} from './router.js';
go({view: 'schools', id: app.id});      // pushState，上一頁會回來
go('#calendar/2026-12');
go('#next', {replace: true});            // 不多一筆上一頁
href('schools', app.id)                  // '#schools/<id>'
```

- 站內連結直接寫 `<a href="#schools/<id>">`。`app.js` 會把點擊攔下來改走 `go()`（pushState）。在對話框裡點的話，會先把對話框關掉。
- 舊網址 `#week`、`#docs`、`#finder` 由 router 換掉，畫面不用管。
- 切換畫面時，打開的「改」表單和小選單都會被關掉。

## 版面

- 頂欄 52px（`--nav`）。`main` 高度是 `100vh - 52px`。每個 `.view` 填滿 `main`，裡面的格線由畫面自己的 css 決定，例如 `#view-next { display: grid; grid-template-columns: minmax(0,1fr) 420px; padding: 0 36px; }`。
- 1440×900 和 1440×789 整頁都不能捲動，文字也不能被裁掉或出現「…」。內容放不下的區塊加 `.scroll`（`overflow-y: auto`），它的爸爸要是 flex／grid 並且有 `min-height: 0`。
- **緊湊模式** `@media (max-width: 1180px), (max-height: 620px)`：style.css 已經讓 body 可以捲動、`main` 和 `.view` 高度變成 auto，`main` 裡的 `.scroll` 也不再自己捲。畫面只要把多欄改成單欄。對話框裡的 `.scroll` 不受影響。
- **手機** `@media (max-width: 600px)`：390px 寬，左右各留 16px，只能是單欄，不能有橫向捲動。頂欄會隱藏「我的特選紀錄」字樣，分頁仍然在。
- 不用卡片、陰影和底色塊分區，一律用細線 `border-top: 1px solid var(--line)`。選到的列用 `.tint`。

## 色彩與字

| token | 用途 |
|---|---|
| `--bg` `--bg-2` `--bg-3` | 紙色底、hover、更深一階 |
| `--tint` | 選到的列（`.tint`／`.sel`） |
| `--ink` `--ink-2` `--ink-3` | 主文字、次要、最淡（簡章、提示性文字） |
| `--line` `--line-2` | 細線、輸入框和按鈕的框 |
| `--accent` | **只用在「今天」和逾期的日期**（`.hot`、`.when.hot`） |
| `--danger` | 錯誤文字（`.form-err`）、刪除 |
| `--c0`…`--c9` | 學校顏色。元素上寫 `style="--hue:var(--cN)"`，用 `ui.hue(app)` 或 `ui.hueAttr(app)` 產生 |

- 字級只有 **12 / 13 / 15 / 20 / 32**，粗細只有 400／600。body 是 15px。焦點列 20px，焦點的日期字 32px。簡章和次要資訊 13px，小標 12px。
- 行高建議：15px → 24px，13px → 20px，20px → 30–34px，32px → 40px。
- 深色模式：所有顏色都用 token，不要寫死 `#fff` 或 `rgba(0,0,0,…)`。token 有三種來源：系統深色、`data-theme="dark"`、`data-theme="light"`。測試時用 `?theme=dark`，或用 `fit.mjs … dark`。

## 元件（class）

```html
<!-- 按鈕：預設是外框；quiet 沒框（設定）；primary 是實心（只給「儲存」）；sm 28px、lg 36px -->
<button class="btn sm" data-act="passed">在名單上</button>
<button class="btn primary sm" type="submit">儲存</button>
<a class="btn sm ext" href="…" target="_blank" rel="noopener">報名系統</a>   <!-- ↗ 由 CSS 加 -->

<!-- 文字連結：ui.ext(href, '報名系統') → <a class="link ext">；改：<button class="link edit" data-edit="key">改</button> -->
<a class="link ext" href="…" target="_blank" rel="noopener">招生網</a>
<!-- 簡章頁碼：ui.pg(app, 25) → <a class="pg">p.25</a>（↗ 由 CSS 加；沒有 PDF 就回傳 ''） -->

<!-- 勾選框（自繪）：ui.check({label, checked, lg, opt, attrs}) -->
<label class="check task"><input type="checkbox" data-part="pay"><span>繳費</span></label>
<label class="check lg task">…</label>          <!-- 18px，焦點列用 -->
<label class="check task"><input type="checkbox"><span>推薦函 <span class="opt">（選繳）</span></span></label>
<!-- .task：打勾後字變灰。勾選框和第一行文字會自動垂直置中（用 1lh） -->

<!-- 學校名、日期 -->
<a class="sch" href="#schools/<id>" style="--hue:var(--c6)">市北</a>
<span class="when hot">今天</span> <span class="when">11/09（一）</span> <span class="unk">時間未公布</span>
<p class="ref">限時掛號，郵戳為憑　<a class="pg" …>p.25</a></p>   <!-- 簡章：13px 灰 -->
<span class="edited">已改</span>

<!-- 列：欄寬用 --cols -->
<div class="grid-row" style="--cols: 84px 3.4em minmax(0,1fr) auto">…</div>
<div class="rows-hair">…</div>     <!-- 子元素之間畫細線 -->
<div class="grid-row pickable tint">…</div>   <!-- 可點、選到 -->

<!-- 區段標題，右邊「改」：ui.secHead('時程', {count:'全部 10 個日期', edit:'sched:'+id}) -->
<section class="sec"><div class="sec-h"><h3>時程</h3><span class="count">…</span><button class="link edit" data-edit="sched:…">改</button></div>…</section>
<div class="col-h">簡章</div>      <!-- 欄位小標，12px 灰 -->

<!-- 其他 -->
<div class="dot" style="--hue:…"></div>  <span class="bar-hue" style="--hue:…"></span>
<p class="empty">現在沒有要處理的事。</p>
<p class="form-err">日期要填</p>     <!-- 錯誤寫在那一項旁邊，不要用提示 -->
```

不要做：pills／badges／tag 雲、說明句（「照時間排…」「點這裡可以…」）、卡片、平常就開著的無框輸入框、`alert()`／`confirm()`、新的顏色、`new Date()`。

## 時間

- `now()` 回傳台北時間 `'YYYY-MM-DDTHH:MM'`，`today()` 回傳 `'YYYY-MM-DD'`。網址有 `?now=2026-11-24T10:00` 時時間會固定在那裡（測試用）。logic.js 的 `now` 參數一律傳 `now()`。
- 日期文字：`L.dayLabel(date, now())`（今天／明天／後天／週五 11/06／11/24（二））、`L.timeText(row, now())`，或 `ui.md(d)`（11/09）、`ui.mdw(d)`（11/09（一））。

## 資料

```js
import {S, P, now, today, appById, programOf, linksOf, pdfAt, colourOf, shortName, deptName,
        agendaNow, orderNow, nextOf, timelineOf, stageOf, statusOf, eventsFor, clashNow, lopts, seasonItems} from './core.js';
import * as L from './logic.js';
```

- 共用的文字：`namesOf(ids)`（簡稱陣列，照學校清單的順序，「同天：…」用）、`actionToast(app, id, payload)`、`tickToast(app, key, done, row)`（回答／打勾後的提示字，接下來和學校頁一樣）在 core；`fromAhead`／`fromText`（「今天 09:00 起」「12/21 10:00 起」）、`methodText(p)`、`feeText(f)` 在 ui。
- `S.apps`（照 createdAt 排）、`S.todos`、`S.profile`、`S.meta`（/api/meta）、`S.syncLog`。
- `P.programs`、`P.byId`（Map：programId → 系組；每個系組多了 `school`、`code`、`region`）、`P.schools`、`P.links`（代碼 → {apply, adm}）、`P.aliases`、`P.synonyms`、`P.season`、`P.fetched`、`P.year`、`P.pdf`（有 PDF 的學校代碼）。
- `linksOf(app)` → `{apply, adm, dept, pdf, code}`，沒有的就是 `''`。`pdfAt(app, page)` 回傳 PDF 那一頁的網址。
- 呼叫 logic 時用 core 的包裝（`agendaNow()`、`nextOf(app)`、`timelineOf(app)`、`stageOf(app)`、`statusOf(app)`、`orderNow()`、`clashNow()`）。它們會傳一樣的 `now`、programs Map 和 `lopts()`（apps、aliases、links、schools、season）。這樣接下來、學校頁、行事曆、標題算出來的東西才會一致。要直接呼叫 `L.xxx` 時，參數也用 `lopts()`。

## 改資料：一律透過 core

```js
import {mutate, mutateMany, act, actx, addApp, removeApp, saveProfile, saveTodos, S, shortName, deptName} from './core.js';
import {go} from './router.js';
import * as L from './logic.js';

// 按鈕動作（logic.applyAction）。提示裡自動有「復原」，8 秒。
act(app.id, 'tick', {key: 'pay', done: input.checked}, {toast: `已記下：${shortName(app)} 繳費`});
act(app.id, 'passed', {}, {toast: `已記下：${shortName(app)} 在名單上`});

// 自己改：fn 拿到複本，直接改或回傳新物件都可以
mutate(app.id, a => { a.place = form.place.value.trim(); });

// 一次改兩間（換到 B）：一則提示、一個復原
mutateMany([[A.id, a => L.applyAction(a, 'gaveUp', {}, actx(a))], [B.id, b => L.applyAction(b, 'confirmed', {}, actx(b))]], {toast: `已換到 ${shortName(B)}`});

// 加學校
const app = L.newApp(program, {apps: S.apps, nowMs: Date.now()});
addApp(app, {toast: `已加入 ${shortName(app)} ${deptName(app)}`, action: {label: '打開', fn: () => go({view: 'schools', id: app.id})}});

// 刪除：先從畫面拿掉，提示「已刪除 市北　復原」，8 秒後才真的送出 DELETE
removeApp(app.id);

saveProfile({hideExams: true});         // 合併進 S.profile，整份送出；回傳 promise：存好 true、伺服器拒絕 false
S.todos.push(t); saveTodos();
```

`mutate` 做了這些事，畫面不用管：
1. 立刻改 `S.apps` 裡那一筆，然後重畫目前的畫面。
2. `PUT /api/apps/:id`，帶 `X-Client: 3` 和 body 裡的 `rev`。成功後把新的 `rev` 存回來；如果沒有別的改動在排隊，就換成伺服器回傳的那一份。
3. 遇到 409 而且回應裡有 `app`（別的分頁或手機先改過）：拿伺服器的版本，把還沒確認的 fn 依序重做，再送一次。所以 **fn 要能重做**：用「設成」不要用「切換」。`act(…,'tick',{key, done:true})` 比不帶 `done` 安全。
4. 遇到 409 但沒有 `app`（伺服器擋下舊網頁）：提示列顯示「網頁已更新，請重新整理」。
5. 遇到 500 或斷線：保留這次的改動，提示列顯示「沒有存到，重試中…」，等 1、2、4…30 秒再試。回到網頁或恢復連線時會馬上重試。
6. 復原只會把這次改到的欄位改回去，同時間別的欄位不受影響。

提示的文字：「已記下：市北 已報名」「已刪除 市北」「已加入 中教大 資工」。復原、打開由 core 加上。錯誤不要用提示，寫在那一項旁邊（`.form-err`）。

## 「改」表單

規格：畫面平常是純文字，只有按了區段的「改」，那一段才變成輸入框，排版不變，下面是 儲存／取消。Enter 存單行欄位，Esc 取消。同一時間只有一段在改。

```js
import {secHead, isEditing, editForm, onEditSave, timeInput, normTime, closeEdit} from './ui.js';

// render 裡
const key = 'sched:' + app.id;
html += `<section class="sec">${secHead('時程', {edit: isEditing(key) ? '' : key})}
  ${isEditing(key) ? editForm(key, rowsAsInputs(app), {extra: '<button class="link" type="button" data-add-date>＋ 新增日期</button>'}) : rowsAsText(app)}</section>`;

// init 裡註冊存檔（冒號前面那段對應）：回傳 false 表示有錯、表單留著
onEditSave('sched', (form, key) => {
  const id = key.split(':')[1];
  const t = normTime(form.elements.time.value);
  if (t === null) { form.querySelector('.form-err').textContent = '時間寫成 17:00'; return false; }
  act(id, 'editDate', {rowId: …, date: form.elements.date.value, time: t});   // payload 名稱以 logic.js 的 applyAction 為準
});
```

- 按 `[data-edit="key"]` 會打開（`openEdit(key)`）。這時 `document.body.dataset.editing = key`，回到網頁時不會重新載入，也會停用快速鍵。按 `[data-edit-cancel]`、按 Esc，或切換畫面就會取消（`closeEdit()`）。
- `editForm` 會產生 `<form class="edit-form" data-edit-form="key">…儲存 取消</form>`。送出由 ui 攔下，呼叫你用 `onEditSave` 註冊的函式；函式沒有回傳 false 就會關掉表單。用輸入法選字時按的 Enter 不會送出。
- 剛打開時，游標會放在第一個欄位。表單開著時如果重畫（例如在別的地方打勾），打到一半的字會保留，條件是欄位數量沒變。表單會增減列（＋新增日期）的話，草稿請自己放在模組變數裡。
- 欄位：日期用 `<input type="date">`，時間用 `timeInput(name, value)`（24 小時制文字框），讀值用 `normTime()`（'1730' → '17:30'，空白 → ''，看不懂 → null）。排列用 `<div class="edit-row" style="--cols: 9.5em 6em minmax(0,1fr) auto 24px">`，刪除鈕是 `<button class="rm" type="button" aria-label="刪除">✕</button>`。

## 小選單、對話框

```js
import {popMenu, closeMenu, openDialog} from './ui.js';
popMenu(button, [{head: '狀態'}, {id: 'prep', label: '準備中', checked: true}, {id: 'applied', label: '已報名', checked: false}, '-', {id: 'del', label: '刪除這間學校', danger: true}], id => { … });
openDialog($('#dlg-add'));   // 一定要用這個打開，提示才看得到（會搬到對話框裡）
```

- 小選單點外面、按 Esc、捲動或換頁都會關掉，也可以用方向鍵加 Enter 選。
- 對話框：`#dlg-add`（`.modal.wide`，1100×720）的內容放在 `#add-body`，`#dlg-settings`（`.modal`，860×640）的內容放在 `#settings-body`。標題列和 ✕ 已經有了。要換標題就改 `#add-title`／`#set-title`。`.modal-foot` 是底下那一行。點背景、按 Esc、按 ✕ 都會關。

## 簡章更新

- 每一次同步，`app.js` 只會提示一次：「簡章更新：逢甲 報名截止 11/19 → 11/18 23:59，還有 2 項　打開」。
- 學校頁：同步改到的日期列有 `upd`（那次同步的 id）。`syncUnseen(app.id)` 回傳這間還沒看過的同步 id（Set），`row.upd` 在裡面就在那一列寫灰色的「簡章更新」。`syncMarks(app.id)` 回傳變更內容（`{appId, what, from, to, added?, removed?, gone?, conflict?}`），被刪掉的列只能從這裡看到。打開那間學校時，先把這兩個存進自己的變數，再呼叫 `ackSync(app.id)`，下次打開就不會再出現。

## 快速鍵（app.js 處理，畫面不要再綁）

`1`／`2`／`3` 切換分頁，`N` 或 `/` 打開加學校，`Esc` 依序關小選單、關對話框、取消「改」，`⌘Z`／`Ctrl+Z` 復原最近一則提示的改動。輸入框裡、「改」表單開著時、對話框開著時，這些鍵都不作用（Esc 除外）。

## 其他

- 分頁標題：「特選」，接下來的第一列是今天時加上「· 今天 市北 15:30」（app.js 算）。
- 列印：把內容放進 `#print`，再呼叫 `window.print()`。列印時只會印 `#print`，裡面可以用 table、h1、h2、ul 和 `.pmeta`。
- `copyText(text)`、`download(name, text, type)`、`setTheme('dark'|'light'|'')`、`theme()`、`ls.get/set`（localStorage，無痕模式也不會出錯）、`CONDITIONS`／`COND_BY_ID`（我的條件）都在 core。

## 測試

```sh
cd scratchpad/dev && DATA_DIR=$(sh ../tools/mkdata.sh <key>) PORT=<port> HOST=127.0.0.1 node server.js
node ../tools/fit.mjs "http://127.0.0.1:<port>/?now=2026-11-04T12:00#next" out.png 1440 789 [dark]
```
在 Playwright 裡要動資料，可以 `await import('/js/core.js')`，拿到的是同一個模組（例如 `c.S.apps`、`c.mutate`）。
