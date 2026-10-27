# 我的特選紀錄

給大學「特殊選才」考生用的個人紀錄網站，自己架在電腦或內網就能用，資料全部存在本機。一個畫面看完：投了哪些學校、每個系的報名／面試／放榜日期、備審進度、面試筆記、放榜結果，以及 116 學年度 57 校、926 個系組的簡章全文搜尋。

- **找科系・搜尋簡章**：輸入「資工」「清大 電機」，或簡章裡的任何字，例如「AIS3」「金盾獎」「APCS」，都能找到相關系組，並顯示原文出現在簡章第幾頁。
- **一鍵加入**：從搜尋結果加入後，那個系的報名、繳件、推薦函、面試、放榜、報到、放棄截止日都會排進時程，截止時間（例如 12:00、17:00）一起帶入。
- **時程**：月曆、接下來的日期、自動提醒（快截止還沒報名、備審沒交齊、面試撞期、錄取後要決定是否就讀）。
- **每間學校的報名系統**：學校紀錄上方直接有「網路報名系統」「學校招生網」「簡章 PDF」的連結（`data/school-links.json`）。
- **行事曆訂閱**：`/api/calendar.ics` 可以加進 Apple、Google 日曆，日期自動同步，截止前一天提醒，有時間的截止再於 3 小時前提醒。
- **紀錄存在 JSON 檔**：`data/records.json`，不需要資料庫。

## 給其他特選生：三步驟開始用

1. 安裝 [Node.js](https://nodejs.org/)（18 以上）。
2. 下載這個專案：按右上角 **Code → Download ZIP** 解壓縮，或 `git clone https://github.com/Zhuyuan0907/Special-Study.git`。
3. 在專案資料夾打開終端機，執行：

```bash
node server.js
# 我的特選紀錄已啟動：http://localhost:5180
```

用瀏覽器打開 http://localhost:5180 。第一次會看到三筆示範用的範例，按「清除範例」後就是你自己的紀錄；資料存在 `data/records.json`，不會上傳到任何地方。

不需要 `npm install`：系組資料、簡章全文、各校連結都已經在 `data/` 裡。簡章 PDF 原檔沒有放進專案（110 MB），所以「簡章 PDF」按鈕預設不會出現；想要的話執行下面「更新系組與簡章資料」的指令就會下載。

在同一個內網的其他電腦，用畫面上印出的「內網」網址開啟。要換連接埠或只允許本機連線：

```bash
PORT=3000 node server.js
HOST=127.0.0.1 node server.js
```

畫面是針對 MacBook Pro 13 吋（1440×900）Chrome 全螢幕設計，不需要捲動頁面；視窗較小時會自動改成可以捲動的單欄。

**安全提醒**：這個伺服器沒有帳號密碼，同一個網路上的人都能看到和修改你的紀錄。請只在家裡或信任的內網使用，不要把連接埠開到網際網路。

## 資料檔

| 檔案 | 內容 | 要不要上傳到 Git |
| --- | --- | --- |
| `data/records.json` | 你的個人紀錄（第一次儲存時建立） | 不要，已在 `.gitignore` |
| `data/records.example.json` | 沒有個人紀錄時顯示的三筆範例 | 要 |
| `data/programs.json` | 926 個系組的整理資料，以及每個系對應的簡章頁碼 | 要 |
| `data/school-links.json` | 57 校的招生資訊網與網路報名系統網址 | 要 |
| `data/search-terms.json` | 搜尋用的簡稱與同義詞（清大、資工…） | 要 |
| `data/brochures/text/*.json` | 57 份簡章逐頁全文 | 要 |
| `data/brochures/pdf/*.pdf` | 簡章 PDF 原檔（約 110 MB） | 不要，用下面的指令重新下載 |

`records.json` 的格式：

```json
{
  "version": 1,
  "apps": [
    {
      "id": "…",
      "school": "國立清華大學",
      "dept": "資訊工程學系A組",
      "programId": "116-002-004",
      "status": "prep",
      "dates": [{"id": "…", "kind": "reg", "date": "2026-10-13", "end": "", "time": "17:00", "note": "網路報名"}],
      "docs": [{"id": "…", "name": "自傳／個人陳述", "done": false}],
      "notes": "", "prep": "", "asked": ""
    }
  ],
  "profile": {}
}
```

`status` 可以是 `prep`（準備中）、`applied`（已報名）、`interview`（一階通過）、`waiting`（已面試）、`admitted`（正取）、`waitlist`（備取）、`rejected`（未錄取）、`out`（一階未通過）。

## 下一個學年度怎麼更新

學年度、資料日期都來自 `data/programs.json`，畫面會自動顯示。等特殊選才網放出新學年度的資料後，把 `scripts/build-data.mjs` 裡的 `YEAR` 改掉，執行 `npm run build-data`，再檢查 `data/school-links.json` 的連結還能不能用。「特選須知」裡的校數與名額數字是 116 學年度的，請一併更新 `public/index.html`。

## 更新系組與簡章資料

```bash
npm install            # 只需要 pdfjs-dist，用來抽出 PDF 文字
npm run build-data     # 從特殊選才網下載最新資料與簡章，重建 data/
npm run build-data:offline   # 不下載，只用已有的檔案重建
```

下載時每個請求之間會等待數秒，請不要調短。

## API

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/api/records` | 讀取所有紀錄 |
| PUT | `/api/apps/:id` | 新增或更新一間學校 |
| DELETE | `/api/apps/:id` | 刪除一間學校 |
| GET | `/api/search?q=AIS3` | 搜尋系組與簡章全文 |
| GET | `/api/brochure/:code?pages=31,32` | 讀取簡章指定頁的文字 |
| GET | `/api/calendar.ics` | iCalendar 訂閱（所有日期＋提醒） |
| GET | `/api/export` | 下載備份 |
| POST | `/api/import` | 從備份還原 |

## 資料來源與聲明

- 系組資料與簡章 PDF：[特殊選才網・簡章搜尋](https://sta-tw.org/bochures/)（簡章資料由日曆小幫手整理）。本專案僅供個人、非商業使用；如要大量或商業使用，請先取得特殊選才網同意。
- 116 學年度統計數字：[大學問](https://www.unews.com.tw/News/Info/11591)。
- 簡章頁面與系組的對應、報名資格節錄是程式自動判斷的，可能有誤。報名前一定要以各校最新簡章為準。
- 來源資料裡的截止時間「00:00」不可靠（有的學校其實是 18:00，有的是沒寫時間），本專案一律顯示「時間請看簡章」。
- 各校連結整理自簡章與學校網站，少數學校簡章只寫校網首頁，就只放招生資訊網。

## 授權

程式碼採 MIT 授權。簡章內容的著作權屬於各大學。
