# Cloudflare 與 TWSE 免費資料

正式來源改為臺灣證券交易所，不需 API Token，也不呼叫 FinMind。一般 Vite 開發仍使用明確標示的示範資料。

## 資料範圍與來源

- 公司名錄：`https://openapi.twse.com.tw/v1/opendata/t187ap03_L`。2026-10-18 實測有 1,096 筆，包含官方名錄內的存託憑證；以每日實際回應為準，不固定檔數。不包含上櫃及 ETF。
- 每日價量：`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date=YYYYMMDD&type=ALLBUT0999`。
- 每日三大法人：`https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=YYYYMMDD&selectType=ALLBUT0999`。
- 後兩項是證交所網站的 JSON 報表介面。`ALLBUT0999` 排除權證等大量無關商品，再以公司名錄精確篩選；不僅依代碼長度判斷股票。歷史行情兼容 `tables` 及 `fields9/data9` 格式。
- 外資不含外資自營商；投信獨立；自營商合併自行買賣與避險。資料單位為股，畫面才除以 1,000 換算成張。
- 未還原價格。新上市公司的歷史從上市日起算，資料不足時 KD／均線顯示資料不足。停牌、無一般交易 OHLC（可能仍有零股量）、法人未列出的資料均保留缺漏，不製造價格或填零。
- 2026-10-16 實測：1,096 家中 1,087 家有 OHLC、5 家無 OHLC、4 家未出現在行情表；有 OHLC 的公司中 13 家未列在 T86。完整名錄和缺漏名單存入 manifest 的 `coverage`，不把缺漏藏起來。
- 曾以證交所官方個股頁使用的 `/rwd/zh/IIH/company/foreign?code=1213&start=20261016&end=20261016` 交叉核對大飲：有股價資料，但法人 `categories` 與各 `series.data` 均為空。因此不把 T86 未列出的公司自動轉成零交易；此介面只作一次性驗證，不加入逐檔每日排程。

## 歷史回補（可中斷續接）

```powershell
npm.cmd run seed -- --end=2026-10-16 --sessions=90
```

預設首次回補最近 90 個市場交易日，初次約 180 次日報請求，加上少量休市日檢查與公司名錄請求，足以提供最近 30 日回看與 MA60 計算（新上市或停牌等個股缺漏除外）。往後每日累積，保留上限為 260 筆；不必首次就抓滿 260 日。按日期整批下載，所有網路請求單線、起始時間至少間隔 10 秒；不按個股下載。這是本專案自行採取的保守頻率，不是宣稱 TWSE 的官方額度。

下載立即快取於 `.wrangler/twse-cache/`，進度見 `progress.json`。遇到 HTTP 403／429、非 JSON、日期不符、欄名改變、筆數異常即停止，不自動密集重試。重新執行同一命令會沿用成功快取。週末不請求；平日僅在回傳明確「沒有符合條件的資料」時跳過。未發布的法人報表不當作零交易。

完成後輸出 `.wrangler/market-seed.json`：128 個壓縮欄位歷史分組與 1 個市場索引，共 129 個 KV key。原始與輸出資料均在 Git 忽略的 `.wrangler/`；不需任何行情來源憑證。

執行 `npm.cmd run verify:market` 可驗證全部公司與歷史格式、上市日期、資料日及涵蓋率，並輸出 `.wrangler/market-verification.json`。另可使用 `-- --calendars=.wrangler`，以已快取的 `calendar-2025.json`／`calendar-2026.json` 交叉檢查所有預定交易日是否完整；年度檔可從官方 `/rwd/zh/holidaySchedule/holidaySchedule?response=json&date=2025`（`date` 為西元年）取得，必須核對回應 `queryYear`，不能把預設的當年度資料當成歷史年度。臨時休市若不在年度表中，驗證會停止並列出日期供核對。

90 日首次下載耗時約 30 分鐘以上，取決於休市及網路延遲；已有快取可立即使用 `--offline` 重建輸出，不連 TWSE。若年度表未列休市日期，另快取官方 `/rwd/zh/afterTrading/FMTQIK?date=YYYYMM01&response=json` 為 `market-calendar-YYYYMM.json`；驗證器核對整個月份的實際成交日期，只有月報也確認沒有市場交易時才接受缺日。2026-07-10 已用七月份月報核對，不列為交易日。

## 本機正式模式

```powershell
npx.cmd wrangler kv bulk put .wrangler/market-seed.json --binding MARKET_DATA --local
npm.cmd run dev:cloudflare
```

開啟 `http://localhost:8787`。`/api/market` 回傳來源、公司名錄、交易日、涵蓋率及分組網址；`/api/market/版本/編號` 回傳不可變歷史分組；`/api/stocks/2330` 提供單檔展開格式便於檢查。公開 API 僅讀快取，不觸發 TWSE 請求。正式模式讀取失敗會顯示錯誤，不退回模擬資料。

## 每日排程

Cloudflare Cron 為 `* 13-15 * * mon-fri`，對應台灣時間平日 21:00–23:59。正常流程：

1. 21:00 公司名錄、21:01 整批價量、21:02 整批法人，各一次請求；檢查日期、欄名、股數、價格及全市場涵蓋率。
2. 後續每分鐘合併兩個歷史分組，只讀寫 KV，不再呼叫 TWSE；各股票保留最近 260 筆有 OHLC 的交易記錄。
3. 128 個分組全部寫妥並留 2 分鐘供 KV 傳播後，才切換市場索引。正常約 22:08 完成；網路及實際 Cron 時間會影響完成時間。
4. 錯誤冷卻 30 分鐘後由後續 Cron 接續，當日最多 3 次失敗，保留上一份公開版本。不承諾 TWSE 固定發布時間，以回傳報表日期判定。

週五另複查最近兩個已發布交易日的行情與法人，以接收近期修正，額外四個整批請求；正常約 22:12 完成。其他平日正常三個整批請求。

若曾更新失敗，從最後成功交易日之後接續補抓，跳過週末、以明確無資料回應識別過去休市日，不會只抓今天而漏掉中間交易日。單晚最多處理 10 個待查平日，長期積欠分夜補齊；每個交易日仍只需行情、法人各一個整批請求，每分鐘至多一個上游請求。補抓全部完成後才合併與發布，市場日期標示最後實際取得的報表日。

正常每日約 200 次 KV 寫入，低於免費方案 1,000 次／日；不再逐檔寫入超過千個 key。保留目前及前一個發布版本，建立新分組時回收更舊版本。分組使用簡短數值陣列降低儲存與傳輸，前端最多六個並行請求。停牌與新上市公司不再拖住整個市場的共同日期；當日沒有 OHLC 的公司不加入當日排行，法人缺漏仍顯示資料不足。

Cloudflare 的免費 KV 仍有每日 100,000 次讀取及 1 GB 容量限制；一次完整載入讀取 129 個 key，流量成長時須觀察用量，不代表網站可無限使用免費資源。Worker 亦有 CPU 限制，因此採小分組、跨 Cron 分批處理。

## 部署

先完成回補、單元／瀏覽器測試、本機正式模式及部署乾跑，再匯入雲端與部署。

```powershell
npx.cmd wrangler kv bulk put .wrangler/market-seed.json --binding MARKET_DATA --remote
npm.cmd run deploy
```

沿用既有 KV namespace，不需新增付費資源或行情 Secret。上傳初始資料與 Worker 都使用 `twse:v2:` key，舊資料 key 不會與新資料混用。若需回退，舊 Worker 及舊 key 仍可復原。不要在初始歷史尚未準備好時部署至正式站。

### 2026-10-18 上線驗證

- Worker 版本：`090a6e24-79ee-4158-80e7-a8ce98822e8e`；已部署上述 Cron。
- 初始資料：2026-06-08 至 2026-10-16，90 個市場交易日、1,096 筆公司名錄、97,854 筆個股歷史、129 個 KV key，未壓縮約 6.72 MiB。
- 日期完整性：年度休市表加官方七月份成交月報交叉核對通過，7 月 10 日無市場交易；個股缺漏不補零。
- 驗證：37 項單元測試、37 項既有瀏覽器測試、3 項本機真實資料測試及同 3 項正式網站測試均通過；正式網站已讀取 TWSE schema 2 與全部 128 個歷史分組，手機與桌面操作正常。
- 今天為週日，此紀錄確認部署及設定，不代表已觀察到下一個平日晚間排程執行。

本專案頻率控制不代表官方的服務承諾或授權聲明。介面可能調整，維護時參照 [TWSE OpenAPI](https://openapi.twse.com.tw/)、[三大法人日報](https://www.twse.com.tw/zh/trading/foreign/t86.html)、[網站使用條款](https://www.twse.com.tw/zh/terms/use.html)、[Cloudflare KV 限制](https://developers.cloudflare.com/kv/platform/limits/)與 [Cron 說明](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。
