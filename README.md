# 株研 Stock Insight｜台股研究室

繁體中文的股票分析前端，使用原生 JavaScript、CSS、SVG 與 Vite。可建置成純靜態網站，供日後部署至 Cloudflare Pages。**目前沒有設定或執行 Cloudflare 部署。**

## 目前資料狀態

所有價格、成交量與三大法人數據均為**可重現的模擬資料**，不是交易所報價。示範範圍為 12 檔上市股票／ETF、每檔 180 個模擬交易日，截止日固定為 **2026-10-16**，不會自動更新。日期以平日模擬，未套用正式休市日曆。

K、D 與均線由這些模擬歷史資料實際計算，並非硬填指標。正式資料 API 是下一階段工作。

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

正式建置輸出為 `dist/`。本機建置預覽預設位於 `http://localhost:4173`。所有圖片與程式均由專案本身提供，沒有外部字型、行情 API 或第三方 CDN 依賴。

## 已完成的功能

- 股票名稱／代碼搜尋、產業篩選、欄位數值排序。
- 自選清單，保存在目前瀏覽器的 localStorage，不會跨裝置同步。
- 30 個示範資料日回看；切換資料日會同步重算指標和法人明細。
- 收盤價、日漲跌與成交量；台股慣例紅漲綠跌。
- SVG 日 K 線、MA5／MA20／MA60、成交量、K／D 走勢，可選 1／3／6 個月（22／66／132 個交易日）。
- KD 預設 (9,3,3)，可調整 RSV 回溯週期及 K、D 平滑係數。
- 觀察清單顯示 D 值與 KD 技術建議、判讀原因；依當日交叉與 MA20 趨勢區分買點、賣點、反彈及觀察狀態，並提供判讀規則視窗。
- 收盤價相對 60 日季線的乖離率；站上季線、K 值低於 20 篩選。
- 外資、投信、自營商買進、賣出與買賣超，畫面統一以張顯示。
- 匯出目前篩選後清單的 UTF-8 CSV，包含法人明細、當前指標參數、KD 技術建議、判讀原因及 MA20。
- 手機版排版、可橫向捲動的行情表格、鍵盤搜尋捷徑 `/`，及可用 Escape 關閉的說明視窗。

CSV 代碼為字串並保留原始前導零。若試算表軟體自動把 `0050` 轉成數字，匯入時請將代碼欄指定為文字。

## 驗證

```bash
npm test
npm run build
```

單元測試涵蓋獨立計算案例、季線、歷史截斷、篩選、資料一致性、CSV，以及技術建議的交叉、邊界、趨勢確認與資料不足情況。Playwright 測試涵蓋換股／換日、排序、搜尋、自選保存、參數調整、建議重算、匯出與手機排版。

```bash
# 第一次執行瀏覽器測試，在本機安裝 Chromium
npx playwright install chromium
npm run test:e2e
```

若環境有 `/usr/bin/chromium` 則直接使用；也可以用 `CHROMIUM_PATH` 指定瀏覽器執行檔。Playwright 會自動啟動 Vite，不須另開伺服器。

## 程式結構與後續部署

```text
index.html                 入口
src/main.js                畫面、互動、狀態與匯出
src/styles.css             桌面與手機版面
src/charts.js              SVG K 線、均線、KD 與縮圖
src/indicators.js          技術指標、篩選與 CSV 純函式
src/data.js                模擬資料與 provider 介面
docs/data-contract.md      正式資料格式與串接注意事項
tests/                     計算與瀏覽器測試
demo1.html                 原專案範例，保留
```

未來接 Cloudflare Pages 時可使用 `npm run build` 與輸出目錄 `dist`。此版不需要伺服器、資料庫或環境變數。正式行情若需要機密金鑰，請在後端處理，不能放在前端程式或 `VITE_*` 環境變數。

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
