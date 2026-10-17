# Cloudflare 與 FinMind

已部署網址：[株研台股研究室](https://stock-insight-tw.stock-insight-tw.workers.dev/)。

前端用 Workers Static Assets，後端用 Worker 與 KV。公開 `/api/stocks/代碼` 與 `/api/market` 只讀快取；瀏覽器不直接呼叫 FinMind。自選仍存在各瀏覽器，不會跨裝置同步。

## 資料與額度

- 目前標的為 `src/catalog.js` 的 150 檔代表性上市櫃股票與 ETF（含禾伸堂 3026、環球晶 6488），依交易所／櫃買官方名錄中的實收資本額挑選，不代表全市場；各產業分布不均。
- 每檔首次下載約 400 個日曆日、保留最近 260 筆實際交易資料，需股價及法人各 1 次請求；150 檔初次建立約 300 次請求，需確認 FinMind 目前使用量並在額度允許時執行。
- 每次排程處理一檔，回抓最近 14 個日曆日以接收近期修正，再與舊資料合併。平日台灣時間 21:00–23:29 每分鐘更新一檔，每日約 300 次 API 請求；任一小時約 120 次，低於免費註冊會員 600 次／小時上限。雲端 Cron 使用 UTC（設定為 `* 13-15 * * mon-fri`）。
- 免費未帶 Token 為 300 次／小時；免費註冊且帶 Token 為 600 次／小時。此額度與 Cloudflare 免費額度分開計算。未設定 `FINMIND_TOKEN` 時走公開匿名 API；共用出口 IP 也可能受到供應商限制。
- 更新失敗會拋出錯誤供 Workers Logs 追蹤，保留舊快照。畫面以 150 檔價量與法人都完整的共同日期為準；日期可能落後最新日，請查看交易日與資料說明。
- 以實際回傳的股價交易日期為準，不自行產生平日或補休市日；歷史法人缺漏保留，累計／連續日數不補零。
- 外資用 `Foreign_Investor`（不含外資自營商）；投信用 `Investment_Trust`；自營商合併 `Dealer_self` 和 `Dealer_Hedging`，缺任一組不視為零。`Foreign_Dealer_Self` 不另外加進三大法人合計。
- 股價未做除權息或分割還原；KD 與 MA60 在瀏覽器依最近歷史計算，不另外耗用 API 額度。滾動暖機窗口不同時，KD 初期可能與其他網站不同。

## 本機預覽

一般 `npm run dev` 仍提供明確標示的模擬資料。正式模式沒有自動退回示範資料的功能。

```powershell
npm.cmd run seed
npx.cmd wrangler kv bulk put .wrangler/market-seed.json --binding MARKET_DATA --local
npm.cmd run dev:cloudflare
```

開啟 `http://localhost:8787`。本機排程測試可呼叫 `http://localhost:8787/cdn-cgi/local/scheduled`；每次按 UTC 時間 13:00 起算的分鐘槽更新一檔。初次補資料會有約 300 次上游請求，先確認 FinMind 使用量；本機與雲端共用同一個 FinMind Token 額度。

## 首次部署

```powershell
npx.cmd wrangler login --device --use-keyring
npx.cmd wrangler kv namespace create MARKET_DATA
```

把命令回傳的 namespace id 填入 `wrangler.jsonc` 的 `kv_namespaces`。不要新增付費方案。若有多帳號，以自己的目標帳號執行。

```powershell
npm.cmd run seed
npx.cmd wrangler kv bulk put .wrangler/market-seed.json --binding MARKET_DATA --remote
npm.cmd run deploy
```

部署後驗證首頁、`/api/market`、各檔 `/api/stocks/2330`、交易日與手機排版；Cron 設定生效可能需 15 分鐘，實際自動執行結果由 Workers Logs 確認。

## FinMind Token 與安全輸入

本機匿名 API 可取得初始資料，但本次實測 Cloudflare 共用出口的匿名 API 回覆 HTTP 402（額度已滿），因此正式雲端排程需設定免費會員 Token。已完成 Secret 設定，並以 Cloudflare 遠端排程成功重新抓取禾伸堂（3026）及寫回 KV；部署設定要求 `FINMIND_TOKEN` 必須存在，避免日後漏設。

Windows 可執行安全輸入工具；輸入會隱藏，先向 FinMind 驗證，再設定 Cloudflare Secret 與 Git 忽略的本機 `.dev.vars`：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/set-finmind-token.ps1
```

工具不會印出 Token；`.wrangler/token-setup-status.json` 只記錄成功／失敗狀態與時間。也可複製 `.dev.vars.example` 成 `.dev.vars`，僅在本機設定 `FINMIND_TOKEN`，供本機 seed 與 Wrangler dev 使用。生產環境需另執行以下命令，在互動輸入框貼入 Token：

```powershell
npx.cmd wrangler secret put FINMIND_TOKEN
```

Token 不進前端、不放 GitHub、不進 seed 檔或回應內容。授權憑證由 Wrangler 保存於 Windows 認證儲存區。`.wrangler/`、`.dev.vars` 均排除於 Git。

修改後依序執行單元測試、瀏覽器測試、Cloudflare 本機預覽與部署乾跑，通過後從本機推送 GitHub，再部署。

來源：[FinMind 方案](https://finmind.github.io/Pricing/)、[技術資料](https://finmind.github.io/tutor/TaiwanMarket/Technical/)、[法人資料](https://finmind.github.io/tutor/TaiwanMarket/Chip/)、[Cloudflare 排程](https://developers.cloudflare.com/workers/configuration/cron-triggers/)、[免費限制](https://developers.cloudflare.com/workers/platform/limits/)。
