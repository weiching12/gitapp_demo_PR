# 株研 Stock Insight｜台股研究室

繁體中文的股票分析前端，使用原生 JavaScript、CSS、SVG 與 Vite。支援本機示範模式，以及 Cloudflare Workers Static Assets + Workers KV 的正式資料模式。部署與資料來源設定見 [docs/cloudflare.md](docs/cloudflare.md)。

正式網站：[株研台股研究室](https://stock-insight-tw.stock-insight-tw.workers.dev/)。Cloudflare 與 GitHub 已部署同版程式；首次上線已驗證真實資料與手機版面。

## 目前資料狀態

`npm run dev` 與一般建置保留明確標示的示範模式：14 檔上市、上櫃股票／ETF（含禾伸堂 3026、環球晶 6488），各有 180 個模擬交易日，固定截止 **2026-10-16**。

`npm run build:cloudflare` 使用 FinMind 真實日資料，從 Cloudflare KV 讀取股價與法人歷史，保留最近 260 個實際交易日。預設取全部 14 檔價量與法人都完整的共同交易日；排程平日台灣時間 21:00–21:52 分批更新，失敗保留舊資料。價格未還原、非即時報價。正式模式失敗會顯示載入錯誤，不自動改成模擬資料。

兩種模式均由歷史 OHLC 在瀏覽器實際計算 K、D、均線及法人近 5／20 日累計與連續買賣日數。新增的兩檔預設加入自選；既有偏好只遷移一次，後續移除不會自動補回。

## 啟動專案

建議使用 Node.js 22.12 以上或 Node.js 24 LTS。

```bash
npm ci
npm run dev
```

在執行專案的電腦開啟終端顯示的 Local URL，預設為 `http://localhost:5173`。遠端開發環境需使用平台支援的連接埠轉送；遠端的 localhost 不等於你的電腦。

```bash
npm run build
npm run preview
```

正式建置輸出為 `dist/`。本機建置預覽預設位於 `http://localhost:4173`。圖片與程式由專案本身提供，沒有外部字型或第三方 CDN 依賴；正式模式由 Worker 呼叫 FinMind，瀏覽器僅讀取同源快取 API。

## 已完成的功能

- 股票名稱／代碼搜尋、產業篩選、欄位數值排序。
- 上方自選總覽同時顯示所有自選股，每檔各有收盤價、成交量、KD、股價與季線及三大法人買賣明細；桌面並排、手機逐張排列。
- 下方市場觀察清單可用星號新增／移除自選，上方立即同步；自選保存在目前瀏覽器的 localStorage，不會跨裝置同步。搜尋與篩選下方表格不影響上方自選範圍。
- 最近 30 個資料日回看；切換資料日會同步重算指標和法人明細。
- 收盤價、日漲跌與成交量；台股慣例紅漲綠跌。
- KD 預設 (9,3,3)，可調整 RSV 回溯週期及 K、D 平滑係數。
- 觀察清單顯示 D 值與 KD 技術建議、判讀原因；依當日交叉與 MA20 趨勢區分買點、賣點、反彈及觀察狀態，並提供判讀規則視窗。
- 收盤價相對 60 日季線的乖離率；站上季線、K 值低於 20 篩選。
- 外資、投信、自營商買進、賣出與買賣超，畫面統一以張顯示。
- 自選卡片顯示三大法人合計及各法人的近 5／20 個交易日累計買賣超；外資、投信另顯示連買／連賣日數，切換資料日同步重算。
- 手機版排版、可橫向捲動的行情表格、鍵盤搜尋捷徑 `/`，及可用 Escape 關閉的說明視窗。

上方僅呈現自選標的；沒有自選時顯示選股引導，不會自行補上其他股票。原價格與技術走勢區塊、CSV 匯出及市場清單的近月走勢欄位已移除。

## 驗證

```bash
npm test
npm run build
```

單元測試涵蓋獨立計算案例、季線、歷史截斷、篩選、資料一致性、法人累計／連續日數與技術建議。Playwright 測試涵蓋多檔自選指標與法人數值、換日、排序、搜尋、自選增減與保存、空清單、參數調整、建議重算與 320–1920px 排版。

```bash
# 第一次執行瀏覽器測試，在本機安裝 Chromium
npx playwright install chromium
npm run test:e2e
```

若環境有 `/usr/bin/chromium` 則直接使用；也可以用 `CHROMIUM_PATH` 指定瀏覽器執行檔。Playwright 會自動啟動 Vite，不須另開伺服器。

## 程式結構與後續部署

```text
index.html                 入口
src/main.js                自選總覽、畫面、互動與狀態
src/styles.css             桌面與手機版面
src/charts.js              SVG 走勢縮圖與圖表繪製函式
src/indicators.js          技術指標、篩選與 CSV 純函式
src/data.js                模擬資料
src/provider.js            正式快照讀取與共同完整交易日
src/catalog.js             14 檔標的與市場分類
cloudflare/                FinMind 正規化與 Worker API／排程
scripts/seed-market.js     本機初始歷史下載
wrangler.jsonc             部署、KV、排程設定
docs/data-contract.md      正式資料格式與串接注意事項
tests/                     計算與瀏覽器測試
demo1.html                 原專案範例，保留
```

一般 `npm run build` 產出示範模式；`npm run dev:cloudflare` 在 `http://localhost:8787` 預覽正式模式。先用 `npm run seed` 下載資料，再依 Cloudflare 文件匯入本機或雲端 KV。`npm run deploy` 建置正式模式並部署。可選的 `FINMIND_TOKEN` 設在 Worker Secret，不進前端、Git 或 `VITE_*` 變數。

正式資料串接契約與算法約定請見 [docs/data-contract.md](docs/data-contract.md)。

---

## 原專案 Git PR 練習筆記

## 使用Pull Request PR

1. fork 原始專案
2. git clone url
3. 修改你的分支下的檔案
4. push 回你的專案
5. 發PR給原專案作者
6. 原作確認PR

## 如何跟上當初fork專案

1. 砍掉重練

- 重新fork

2. 跟上游同步

- 設定原作遠端
- 抓取原作專案內容
- 推回自己專案
