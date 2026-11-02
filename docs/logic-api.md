# logic.js API (for the views)

`public/js/logic.js` is pure ES module code: no DOM, no clock. The server imports the same file. Every time-dependent function takes `now`, which is Taipei wall-clock time: `'2026-11-02T02:30'` (what `core.now()` returns), a `Date`, or an ISO string with an offset. Dates are `'YYYY-MM-DD'` and times are `'HH:MM'` everywhere.

`programs` can be a `Map` (id → program), an array of programs, the `programs.json` object, or a function `id => program`. A program is a `programs.json` entry. For links it also needs `.code` (the client's `P.byId` entries already have it).

`opts` is shared by `agenda`, `nextStep`, `timeline` and `clashes`:

| key | value | used for |
|---|---|---|
| `aliases` | `search-terms.json` aliases (`P.aliases`) | short school names inside row labels (swap and giveup rows) |
| `links` | `school-links.json` `.schools` (`P.links`) | `href` of the link actions |
| `season` | `season.json` events (`P.season`) | 學測成績 date for the giveup row (`key:'gsatScore'`) |
| `apps`, `programs` | all apps and programs | `nextStep` and `timeline` need them for the held seat and same-day facts |

## Labels and formatting

- `STATUS`: the 9 status keys, in menu order. `STATUS_LABEL[key]`: 準備中 · 已報名 · 待面試 · 等放榜 · 正取 · 備取 · 未錄取 · 一階未通過 · 沒有報名.
- `KIND_LABEL[kind]`: 報名截止, 一階名單, 面試…, used for info rows and the 改 form's kind names.
- `PART_NAME`: `{reg:'報名', pay:'繳費', docs:'繳件', letter:'推薦函', ticket:'印准考證', intent:'填寫遞補意願'}`.
- `statusWord(app, program, now)`: the one status word used everywhere. Values: 已放棄, 已報到, 不去, 沒去面試, 備取 5, 待面試, 等放榜, or `STATUS_LABEL`.
- `displayStage(app, program, now)`: one of `'prep' | 'applied' | 'interview' | 'waiting' | 'admitted' | 'held' | 'waitlist' | 'ended'`. `'ended'` means it goes under the rail's 結束 divider.
- `dayLabel(date, now)`: 今天 · 明天 · 後天 · 週五 11/06 (3–6 days ahead) · 11/24（二） (otherwise, past days included).
- `timeText(rowOrPart, now)`: 「15:30」. For postmark rows it gives 「今天郵戳」 or 「郵戳 11/16」, never a clock time. For arrival rows it gives 「11/16 前寄達」. When there is no time it returns 「」. Only the school-page timeline writes 時間未公布.
- `fmtDate(d)` 「11/09（一）」, `md(d)` 「11/09」, `weekday(d)` 「一」, `addDays(d, n)`, `daysBetween(a, b)`, `clock(now)` → `{date, time}`.
- `shortSchool(name, aliases)`: 市北, 成大, 興大, 淡江… `shortDept(dept)`: 資工, 資工・資安組, 醫資・資安外加, 軟工・資安外加. `splitDept(dept)` → `{main, quals}`.
- `shortDoc(full)`: a 備審 name at most 12 characters wide. Docs already store `name` (short) and `full` (brochure text).
- `rowLabel(dateRow)` / `rowNote(dateRow)`: a date row's `note` is stored as `標籤｜簡章附註`. Use these instead of reading `note`.
- `userNotes(app)`: 筆記 without the old auto 「甄選：…」 line. That line is kept in the data, just not shown.
- `isEdited(dateRow)`: 「已改」 (a brochure row whose values differ from `bro`).

## Records v3 (what the server stores)

App: all v2 fields, plus `v:3`, `rev` (the server bumps it on every write), `hidden:[ref]` (tombstones), `seen:[rowId]` (遞補公告 rows answered 還沒), and `ivTime` ('HH:MM', the student's own interview time, which overrides the brochure time on 面試 rows).

Date row: `{id, kind, date, time, end, from, fromTime, note, src:'brochure'|'mine', ref, bro, upd?, gone?, brochureNow?, mail?}`.
- `date`/`time` is the deadline or the event moment. `from`/`fromTime` is when a deadline range opens. `end` is used only for multi-day events.
- `bro` holds the brochure values the row was last synced from. `upd` is the id of the sync that changed the row, so the school page shows 「簡章更新」 until that school is opened (compare against the last `syncLog` id the client has seen).
- `gone`: a row you edited whose brochure row has since disappeared. `brochureNow`: a conflict; the brochure changed after you edited the row.

Doc: `{id, name, full, done, src:'brochure'|'mine'|'placeholder', ref, opt?, gone?}`. `opt` means 選繳 (shown as a grey suffix, no tick). `gone` means a ticked item the brochure no longer lists.

regSteps: `{id, key, name, done}`. A tick is stored per `key` per app (`reg`, `pay`, `docs`, `letter`, `ticket`, `intent`), and is shown wherever that part appears.

## Events

`eventsOf(app, program)` returns one event per date row, sorted by date and then time:

```
{appId, rowId, rowIds:[rowId], kind, role, type, date, time, from, fromTime, end,
 label, raw, note, parts:[Part], mail, scr?, src, ref, edited, upd, gone, brochureNow}
```

| `role` | `type` | rows |
|---|---|---|
| `reg` | do | reg/pay/upload/letter, expanded into parts |
| `ticket` | do | 印准考證 (scr:false rows and other rows whose label says 准考證 plus a print step) |
| `intent` | do | 備取 意願 rows (意願, 登記, 填寫, 備取生報到) |
| `confirm` | do | 報到 |
| `giveup` | do | the held-seat decision |
| `go` | go | interview, exam |
| `stage1` | check | a screening list (scr:true), with a question |
| `notice` | check | a non-screening list, e.g. 公布面試順序・地點; no question |
| `release` | check | 放榜, with a question |
| `waitcheck` | check | 開始遞補 / 遞補名單 |
| `info` | info | 複查, 成績單, 遞補作業截止…; school page only |

`Part`: `{key, name, date, time, mail, opt, done, rowId, kind, own?}`. In an agenda row, `own` is the text to print after the part's name: its own time when it differs from the row's time, 「時間未公布」 when the row has a time and this part has none, and 「今天郵戳」 or 「郵戳 11/16」 for a mailed part. Empty means print nothing.

Program flags read by logic. The build merges these in from `data/overrides.json`, and the server serves the merged `programs.json`. Each one is optional:

| flag | effect |
|---|---|
| `p.scr: false` | the stage1 rows are not a screening, so there is no 在名單上／沒有 |
| `p.mail: {[ref or kind]: 'postmark'\|'arrive'}` | sets the mail type of a row; otherwise it is derived from 郵寄, 郵戳, 掛號, 寄達 and 親送 in the label or note |
| `p.how: {confirm, giveup}` | method text, appended to the row's `note` |
| `p.rl` | contains 非必繳/選繳 → the 推薦函 part is optional |

## Relevance and the agenda

`relevant(app, ev, now, apps, program, opts)` → bool, per DESIGN §3.4. `agenda(apps, programs, now, opts)` returns `{rows, focalIndex, clashes, upcoming}`:

```
Row = {key, appId, date, time, sortKey, type, role, kind, label, parts:[Part], rowIds,
       from, fromTime, mail, note, context?, overdue, question?, actions:[Action],
       clash?:[appId], tentative?, sameDay?:[{date, with:[appId]}], sendBy?, edited, upd}
```

- `rows` is already sorted (date, then time with untimed first, then school order, then type) and merged: one row per school, per day and per role. Registration parts come in process order. Ticked parts stay visible until every required part of the row is ticked; then the row disappears.
- `focalIndex` is the first row that is not `overdue` (−1 when there is none). Rows above it are past and unresolved: draw them small with an accent date.
- `key` is stable for selection: `appId|date|role`.
- `overdue`: the deadline or day has passed and the row is still unresolved.
- `note`: brochure note(s), e.g. 「限時掛號，郵戳為憑」 or the method from `p.how`.
- `sameDay` (registration rows only): this school's interview days that fall on the same day as other active schools, prep included. It is the detail-panel fact 「12/04 面試和 逢甲、興大、高師大 同一天」.
- `sendBy` (arrival-deadline rows, also on parts with `mail:'arrive'`): the date minus 3 days, for 「最晚 11/13 寄出」.
- `context`: one fact for the detail panel. Examples: 「通過的話 12/04 面試」 (stage1), 「其他 6 間還沒放榜」 (confirm), 「學測成績 02/25（暫定）」 (giveup).
- `clash`: the other apps whose go row falls on the same day (applied or 待面試 only). Build the day header 「同天：…」 from the rows of that day, or use `clashes`.
- `tentative`: a go row of an applied school whose list hasn't been answered yet; draw it muted.
- `from`/`fromTime`: show 「12/21 10:00 起」 when it is still ahead. The confirm actions are `disabled` until then.
- `upcoming` (only when `rows` is empty): `{date, time, appId, label}`, the next dated thing, for the empty state.

`Action = {id, label, kind:'primary'|'quiet'|'link', href?, disabled?, ask?, payload?, also?}`:
- `kind:'link'`: `id:'link'`, `label` 報名系統 / 上傳 / 公告 / 招生網; add ↗ yourself. It is omitted when no URL is known.
- `ask`: show a follow-up control after the tap, then call `applyAction` with the result.
  - `{type:'number', label:'備取幾號', optional:true}` → payload `{no}`.
  - `{type:'datetime', label:'報到期限'}` → payload `{date, time}`.
  - `{type:'confirm', text:'成大 的放棄已經辦好了嗎？', ok:'辦好了'}` → no payload; only proceed on ok.
- `payload`: pass it as-is (e.g. `notYet` carries `{rowIds}`).
- `also: [{appId, id}]`: apply these actions to the other apps in the same `mutateMany` (換到 B also sets `gaveUp` on A).

`question` names the open question on a row: `registered`, `stage1`, `release`, `confirm`, `swap`, `giveup` or `promoted`. It is absent when the row asks nothing. Notably, a `notice` row (scr:false) never has one.

`nextStep(app, program, now, {apps, programs, ...opts})`: that app's first agenda row, or null. It is the school page's 下一步.

`clashes(apps, programs, now)`: `Map date → [appId]` (go rows on or after today, apps at applied or 待面試, not ivSkip, at least two apps).

`sameDay(app, apps, programs, now)` → `[{date, label, rowId, with:[appId]}]`: this app's go dates that coincide with any other active app, prep included. Use it for the plain fact on the school page and in the detail panel.

`pendingResults(apps, programs, now, exceptId)` → apps still waiting for a result.

`orderApps(apps, programs, now)` → `{active, ended}` in rail order: first 報名 deadline, then createdAt.

## School page helpers

- `timeline(app, program, now, {apps, programs})` → every event, each with `milestone`, `past`, `next` (the first milestone not yet past), and `clash:[appId]` on go rows. Show `milestone` rows by default and the rest behind 「全部 N 個日期」.
- `docsMode(app, program, now)` → `'list'` (準備中, or 已報名 with a 繳件 part still ahead) or `'summary'` (「備審 4 項・已隨報名送出」).
- `recordFields(app, program, now)` → `[{key, label, value}]` for the fields that apply at this stage: `regNo` 准考證號, `ivTime` 面試時間, `place` 面試地點, `asked` 面試被問了什麼, `notes` 筆記. A 紀錄 with no values shows 「＋ 記一筆」.

## Actions: `applyAction(app, id, payload, ctx)` → new app (pure)

`ctx = {program, now, uid}`. `program` is needed for `tick`/`registered` (to know the required parts) and for `unhide`/`unhideDoc`. `uid` is optional. It throws on an unknown id. In the client: `mutate(app.id, a => L.applyAction(a, id, payload, {program}))`.

| id | payload | effect |
|---|---|---|
| `tick` | `{key, done?}` | tick a registration part (toggles without `done`). When the last required part is ticked on a prep app, the status becomes `applied` (show 復原) |
| `registered` | – | 有報名: tick all required parts, status applied |
| `notRegistered` | – | 沒報: status skipped |
| `passed` / `notPassed` | – | 在名單上 → interview / 沒有 → out |
| `admitted` / `rejected` | – | 正取 / 未錄取 |
| `waitlisted` | `{no?}` | 備取 (waitNo) |
| `confirmed` | – | 已報到 (`confirmDone`) |
| `decline` | – | 不去 (choice decline) |
| `swap` | – | 換到 B: B.confirmDone. The action's `also` applies `gaveUp` to A |
| `stay` | – | 留在 A: B.choice = 'decline' |
| `keep` / `gaveUp` | – | 留下 (choice keep) / 已放棄 (giveupDone) |
| `promoted` | `{date, time}` | 遞補上了: status admitted, plus a `mine` confirm row |
| `notYet` | `{rowIds}` | 還沒: hide that 遞補公告 row |
| `skipInterview` / `attendInterview` | – | 不去 on go rows (ivSkip) / undo |
| `setStatus` | `{status}` | status menu: any `STATUS` key, or `'held'` (已報到), `'gaveup'` (已放棄), `'declined'` (不去). Plain keys clear confirmDone, giveupDone and choice |
| `editDate` | `{rowId, date?, time?, from?, fromTime?, end?, label?}` | 改 in 時程 |
| `restoreDate` | `{rowId}` | 還原 (copies `bro` back) |
| `addDate` | `{label, date, time?, kind?}` | ＋新增日期 (src mine) |
| `removeDate` | `{rowId}` | delete. A brochure row is tombstoned in `hidden` so sync won't re-add it |
| `unhide` | `{ref}` | undo a removal; re-adds the brochure row |
| `tickDoc` | `{docId, done?}` | 備審 tick |
| `addDoc` / `hideDoc` / `unhideDoc` | `{name}` / `{docId}` / `{ref}` | own items; brochure items are hidden (tombstoned), never renamed |
| `editRecord` | `{regNo?, ivTime?, place?, asked?, notes?, prep?}` | 紀錄. `notes` replaces only the user part |
| `setColor` | `{color}` | ⋯ › 顏色 |
| `editInfo` | `{school?, dept?, url?, fee?}` | manual apps |

## New apps

- `newApp(program, {apps, uid, nowMs})` → a v3 app from the brochure, with dates, docs (placeholder items when the brochure has none) and the next free colour. Pass `nowMs: Date.now()` for `createdAt`.
- `blankApp({school, dept, date, time}, {apps, uid, nowMs})` → a manual app.
- `nextColor(apps)`.

## Server-side (also pure)

- `migrateApp(app, program, idx, {uid})` → a v3 app; returns the same object unchanged when `app.v === 3`.
- `syncApp(app, program, now, {uid, syncId})` → `{app, changes:[{appId, school, what, from, to, added?|removed?|conflict?|gone?|doc?}], skipped}`.
- `brochureRows(program)`.

The server runs these at startup: it backs up first, migrates per app, and syncs only when the hash of `programs.json` plus `overrides.json` has changed. Each sync that changes something appends `{id, at, changes}` to `records.syncLog`. `GET /api/meta` returns `{…, lan:[ip], port, recovered, example, syncLog: last entry}`.

## Server write contract

- Every write needs the header `X-Client: 3`. Without it the server answers `409 {error:'網頁已更新，請重新整理'}` with no `app`.
- `PUT /api/apps/:id` takes the whole app including `rev`. On a stale `rev` it answers `409 {error, app: current}`. On success it answers `200` with the saved app and the new `rev`. Write failures answer `500`.
- `POST /api/import?dry=1` → `{apps, replace}` (for 「會取代 N 間學校」). Without `dry`, it backs up, migrates and merges, then returns `{imported, replaced}`.
