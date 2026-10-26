# 我的特選紀錄

給大學「特殊選才」考生用的個人紀錄網站。一個畫面看完：投了哪些學校、每個系的報名／面試／放榜日期、備審進度、面試筆記、放榜結果，以及 116 學年度 57 校、926 個系組的簡章全文搜尋。

- **找科系・搜尋簡章**：輸入「資工」「清大 電機」，或簡章裡的任何字，例如「AIS3」「金盾獎」「APCS」，都能找到相關系組，並顯示原文出現在簡章第幾頁。
- **一鍵加入**：從搜尋結果加入後，那個系的報名、繳件、推薦函、面試、放榜、報到、放棄截止日都會排進時程。
- **時程**：月曆、接下來的日期、自動提醒（快截止還沒報名、備審沒交齊、面試撞期、錄取後要決定是否就讀）。
- **紀錄存在 JSON 檔**：`data/records.json`，不需要資料庫。

## 執行

需要 Node.js 18 以上，不需要安裝任何套件。

```bash
node server.js
# 我的特選紀錄已啟動：http://localhost:5180
```

在同一個內網的其他電腦，用畫面上印出的「內網」網址開啟。要換連接埠或只允許本機連線：

```bash
PORT=3000 node server.js
HOST=127.0.0.1 node server.js
```

畫面是針對 MacBook Pro 13 吋（1440×900）Chrome 全螢幕設計，不需要捲動頁面；視窗較小時會自動改成可以捲動的單欄。

## 資料檔

| 檔案 | 內容 | 要不要上傳到 Git |
| --- | --- | --- |
| `data/records.json` | 你的個人紀錄（第一次儲存時建立） | 不要，已在 `.gitignore` |
| `data/records.example.json` | 沒有個人紀錄時顯示的三筆範例 | 要 |
| `data/programs.json` | 926 個系組的整理資料，以及每個系對應的簡章頁碼 | 要 |
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
| GET | `/api/export` | 下載備份 |
| POST | `/api/import` | 從備份還原 |

## 資料來源與聲明

- 系組資料與簡章 PDF：[特殊選才網・簡章搜尋](https://sta-tw.org/bochures/)（簡章資料由日曆小幫手整理）。本專案僅供個人、非商業使用；如要大量或商業使用，請先取得特殊選才網同意。
- 116 學年度統計數字：[大學問](https://www.unews.com.tw/News/Info/11591)。
- 簡章頁面與系組的對應、報名資格節錄是程式自動判斷的，可能有誤。報名前一定要以各校最新簡章為準。

## 授權

程式碼採 MIT 授權。簡章內容的著作權屬於各大學。
