# 前端慣例（給寫各個畫面的人）

DESIGN.md 是規格；這份只講外框（F2）提供了什麼、畫面要怎麼接。共用的東西不要在畫面裡再寫一份。

## 檔案

| 檔案 | 內容 | 誰改 |
|---|---|---|
| `public/index.html` | 頂欄、四個 `<section class="view">`、兩個 `<dialog>`、`#bar`、`#toast`、`#print` | F2 |
| `public/style.css` | 色彩、字級、按鈕、勾選框、列、區段標題、「改」表單、對話框、小選單、提示 | F2 |
| `public/css/{next,schools,calendar,money,add,settings}.css` | 各畫面自己的版面（學校頁的「花費」那一塊在 money.css） | 各畫面 |
| `public/js/core.js` | 時間、狀態 `S`／`P`、載入、`mutate`、提示、logic 的包裝 | F2 |
| `public/js/router.js` | 網址 ↔ 畫面 | F2 |
| `public/js/ui.js` | HTML 小零件、「改」表單、小選單、`openDialog` | F2 |
| `public/js/app.js` | 啟動、分頁、快速鍵、標題、簡章更新提示 | F2 |
| `public/js/logic.js` | 事件模型（純函式） | F1 |
| `public/js/{next,schools,calendar,money,add,settings}.js` | 各畫面（money.js 也畫學校頁的「花費」：`schoolBlock(app)`） | 各畫面 |

舊版（本週、備審、找科系、精靈）的模組已經拿掉，要看就看 git 歷史。

## 畫面模組的介面

```js
// next.js / schools.js / calendar.js / money.js
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
- `route` = `{view, id, month}`（view 是 next／schools／calendar／money）：`#schools/<id>` 的 `id` 是 app id，`#calendar/2026-11` 的 `month` 是 `'2026-11'`（月），`#calendar/2026-11-09` 是 `'2026-11-09'`（那天所在的週），沒有就是 `''`（現在，用上次的看法）。`#schools` 沒有 id 時，學校畫面自己決定開哪一間（規格：接下來第一列的學校），再用 `setUrl({view:'schools', id})` 把網址補齊（不會多一筆上一頁，也不會再 render 一次）。

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
<!-- 按鈕：預設是外框；quiet 沒框（只給設定、表單裡的取消、行事曆的訂閱這種配件；列上的答案和「不去」一律外框）；primary 是實心（只給「儲存」）；sm 28px、lg 36px -->
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
<a class="sch" href="#schools/<id>" style="--hue:var(--c6)">北市大</a>
<span class="when hot">今天</span> <span class="when">11/09（一）</span> <span class="unk">時間未公布</span>
<p class="ref">限時掛號，郵戳為憑　<a class="pg" …>p.25</a></p>   <!-- 簡章：13px 灰 -->
<span class="edited">已改</span>
<!-- 時間欄 ui.timeInput()：空的時候就是空白（placeholder「17:00」只在點進去時出現，style.css 的 input.tm 規則） -->

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
import {S, P, now, today, appById, programOf, linksOf, pdfAt, colourOf, shortName, schoolName, deptName,
        agendaNow, orderNow, nextOf, timelineOf, stageOf, statusOf, eventsFor, clashNow, lopts, seasonItems} from './core.js';
import * as L from './logic.js';
```

- 學校的名字：`shortName(app)`（= `L.appName`）是簡稱；同一間學校加了兩個系組時自動加系（「宜大 資工・資安組」「宜大 資工」），列、同天、提示、行事曆都用它。旁邊已經寫了系的地方（學校清單、右欄標題、已加入提示）用 `schoolName(app)`（只有簡稱），系才不會寫兩次。
- 共用的文字：`namesOf(ids)`（名字陣列，照學校清單的順序，「同天：…」用）、`actionToast(app, id, payload)`、`tickToast(app, key, done, row)`（回答／打勾後的提示字，接下來和學校頁一樣）在 core；`fromAhead`／`fromText`（「今天 09:00 起」「12/21 10:00 起」）、`methodText(p)`、`feeText(f)` 在 ui。
- `S.apps`（照 createdAt 排）、`S.expenses`（花費，records.expenses）、`S.todos`、`S.profile`、`S.meta`（/api/meta）、`S.syncLog`。
- 金額一律 `ui.amt(n)`（「3,240」千分位，表格數字）；合計、月份、提示加「元」，清單裡的金額不加。
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

// 刪除：先從畫面拿掉，提示「已刪除 北市大　復原」，8 秒後、而且提示收起來後才真的送出 DELETE（滑鼠停在提示上就一直可以復原）
removeApp(app.id);

// 花費：一筆一筆存，和學校同一套（佇列、409 重做、重試、刪除 8 秒內可以復原）
saveExpense({date, what, amount, cat, appId, school}, {toast: `已記下 ${amt(amount)} 元`});   // 沒有 id 是新的一筆（復原＝刪掉它）；有 id 就只改給的欄位
saveExpense({id, ...e}, {toast: `已記下：${what} ${amt(amount)} 元`});   // 改一筆：寫出是哪一筆，和新記的「已記下 1,490 元」分得出來
deleteExpense(id, {toast: `已刪除 ${what} ${amt(amount)} 元`});
expensesNow();                           // logic.expenseLines：自動的報名費＋自己記的，新的在上面

saveProfile({hideExams: true});         // 合併進 S.profile，整份送出；回傳 promise：存好 true、伺服器拒絕 false
S.todos.push(t); saveTodos();
```

`mutate` 做了這些事，畫面不用管：
1. 立刻改 `S.apps` 裡那一筆，然後重畫目前的畫面。
2. `PUT /api/apps/:id`，帶 `X-Client: 3` 和 body 裡的 `rev`。成功後把新的 `rev` 存回來；如果沒有別的改動在排隊，就換成伺服器回傳的那一份。
3. 遇到 409 而且回應裡有 `app`（別的分頁或手機先改過）：拿伺服器的版本，把還沒確認的 fn 依序重做，再送一次。所以 **fn 要能重做**：用「設成」不要用「切換」。`act(…,'tick',{key, done:true})` 比不帶 `done` 安全。會新增一列的動作（`addDate`、`addDoc`、`promoted`）在 fn 外面先給好 `id: uid()` 放進 payload，重做時就不會多一列。
4. 遇到 409 但沒有 `app`（伺服器擋下舊網頁）：提示列顯示「網頁已更新，請重新整理」。
5. 遇到 500 或斷線：保留這次的改動，提示列顯示「沒有存到，重試中…」，等 1、2、4…30 秒再試。回到網頁或恢復連線時會馬上重試。（伺服器寫檔失敗時會把記憶體退回去，所以同一份、同一個 rev 重試會被接受。）
6. 遇到其他 4xx（例如 410：這間學校已經在別的分頁或裝置刪掉了）：不再重試，重新載入，提示列留著「沒有存到：…」。
7. 復原只會把這次改到的欄位改回去，同時間別的欄位不受影響。

提示的文字：「已記下：北市大 已報名」「已刪除 北市大」「已加入 中教大 資工」。復原、打開由 core 加上。錯誤不要用提示，寫在那一項旁邊（`.form-err`）。

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

## 每件事一個畫面只寫一次（規格 §0.5）

- 學校頁：「下一步」寫了的附註，時程那幾列不再寫；同一句附註在時程裡只寫第一次；右欄「繳件方式」不寫畫面上已經有的附註，附註已經講了郵戳／寄達就不再加「郵寄，郵戳為憑」（`schools.js` 的 `notesShown`）。列印這一間照樣全部寫。
- 「11/02 09:00 起」也一樣：下一步寫了就不寫，同一天的報名・繳費・繳件只寫第一列。
- 時程的粗體是「下一個」：還沒過、也還沒做完的第一個里程碑（`timeline()` 的 `done`）。做完的列（勾完、回答了、報到了、不去面試）和過去的一樣畫灰。

## 簡章更新

- 每一次同步，`app.js` 只會提示一次：「簡章更新：逢甲 報名截止 11/19 → 11/18 23:59，還有 2 項　打開」。寫哪一項由 `logic.syncHeadline(changes)` 挑（報名類的期限提早了最優先，複查、成績、備審最後），前後看起來一樣的不算。
- 學校頁：同步改到的日期列有 `upd`（那次同步的 id）。`syncUnseen(app.id)` 回傳這間還沒看過的同步 id（Set），`row.upd` 在裡面就在那一列寫灰色的「簡章更新」。`syncMarks(app.id)` 回傳變更內容（`{appId, what, from, to, kind, added?, removed?, gone?, conflict?, doc?}`），被刪掉的列只能從這裡看到。打開那間學校時，先把這兩個存進自己的變數，再呼叫 `ackSync(app.id)`，下次打開就不會再出現。

## 快速鍵（app.js 處理，畫面不要再綁）

`1`／`2`／`3`／`4` 切換分頁，`N` 或 `/` 打開加學校；在行事曆：`W` 週、`M` 月、`T` 今天、`J`／`K` 或 `→`／`←` 前後翻（`calendar.key(e)`，跟 Google 日曆一樣，N 已經是加學校所以不用 N／P）；`Esc` 依序關小選單或行事曆的詳細、關對話框、取消「改」，`⌘Z`／`Ctrl+Z` 復原最近一則提示的改動。輸入框裡、「改」表單開著時、對話框開著時，這些鍵都不作用（Esc 除外）。

## 其他

- 分頁標題：「特選」，接下來的第一列是今天時加上「· 今天 北市大 15:30」（app.js 算）。
- 列印：把內容放進 `#print`，再呼叫 `window.print()`。列印時只會印 `#print`，裡面可以用 table、h1、h2、ul 和 `.pmeta`。
- `copyText(text)`、`download(name, text, type)`、`setTheme('dark'|'light'|'')`、`theme()`、`ls.get/set`（localStorage，無痕模式也不會出錯）、`CONDITIONS`／`COND_BY_ID`（我的條件）都在 core。

## 測試

```sh
cd scratchpad/dev && DATA_DIR=$(sh ../tools/mkdata.sh <key>) PORT=<port> HOST=127.0.0.1 node server.js
node ../tools/fit.mjs "http://127.0.0.1:<port>/?now=2026-11-04T12:00#next" out.png 1440 789 [dark]
```
在 Playwright 裡要動資料，可以 `await import('/js/core.js')`，拿到的是同一個模組（例如 `c.S.apps`、`c.mutate`）。

## 花費（#money）

- 規格 DESIGN §12。「記一筆」是唯一平常就開著的表單（新增是這個畫面的主要動作）：日期・項目・金額・類別・學校・記下，Enter 送出。類別跟著項目猜（`L.guessCat`），學校跟著日期猜（`L.guessSchool`）；自己選過就不再猜。這個表單不重畫（render 只換清單和右欄），打到一半的字、游標、輸入法都不會被每分鐘的重畫或重新載入打斷；草稿記在 money.js。
- 清單的一行點了就變成同一行的「改」表單（key `mn:<id>`），自動的報名費（`mn:fee:<appId>`）只有金額能改，刪除換成「沒繳」（`setFee`）。
- 學校頁「花費」：只有那間有花費（或報名費按了沒繳）才畫；「＋ 記花費」是 `mnadd:<appId>` 的「改」表單，學校就是這間（`appId` 是隱藏欄位，不放學校選單，一行放得下；要換學校到花費頁改）。不叫「＋ 記一筆」：紀錄空著的時候那一塊是「＋ 記一筆」，兩個一樣的字疊在一起分不出來。點一行和花費頁一樣變成「改」表單，key 是 `mns:<id>`（不用 `mn:`：換分頁後舊畫面的表單還在 DOM 裡，同一個 key 會找到看不見的那個），一樣不放學校選單。
- 手機（≤600px）：依類別縮成合計底下的一行字（報名費 1,700　交通 3,745…），記一筆還在第一個畫面；依學校放在清單後面。下載 CSV 在「這次特選花了」那一行的右邊。
- 匯出的 CSV、同步到試算表的文字開頭是 = + - @ 的，伺服器前面加 '（不然試算表當成公式）；金額是數字不動。

## 行事曆（#calendar）

- 資料是 `calendarNow()`（`L.calendarItems`）：接下來的列（`state` now／late／tent），加上還沒到那個階段的名單・面試・放榜（`later`，準備中的學校報名前就看得到面試日），和過去或做完的里程碑（`done`）。同校兩個系組的同一件事併成一件（`appIds`、`name` 只寫學校）。`clashDays` 是不同學校的面試同一天。
- 三種深淺：要做的正常、`later`／`tent` 淡（學校色混一點底色、字 `--ink-3`）、`done` 全灰；逾期 `--accent`。不加別的標記。
- 月：一件事一行（`white-space: nowrap`）。`fit()` 量過放不下的換短的寫法（`.v-short`：「報名」「面試」「名單」「放榜」），短的也放不下才換行（`.wrap`）；格子真的滿了，先收 done、later、大考日期，再從最後一件收，寫「還有 N 件」，點了在旁邊列出那天全部。`・` 後面的換行點用零寬空白，不用 `<wbr>`（Chrome 在 nowrap 裡還是會在 `<wbr>` 換行，一件事就變兩行、把別的擠成「＋1」）。
- 週：七欄，每件事寫完整（時間、學校、各部分、各部分自己的時間、「名單公布後才確定」、合併的系）。今天那欄有現在的線。點月格子的日期數字到那天的週。
- 點一件事：`#cal-pop` 在旁邊打開詳細（日期、要做的部分、起始時間、同一天面試的學校、簡章附註、狀態、報名系統、打開學校），那間學校的其他事留著、別的變淡（`.cal.focus`）。點外面、Esc、換頁、捲動就關；重畫後那件事還在就跟著它。⌘／Ctrl 點照樣在新分頁開學校。

