# T86 資料完整性與交易寫入

這份程式變更必須先建立 D1、執行 migration、確認初始基準，再部署 Worker 才會在正式環境生效。原先只有 KV；KV 不支援資料庫交易，現在 D1 為法人資料的驗證／版本來源，KV 保留為網站的發布快取。

## 排程與發布

- 台灣時間平日 **18:30、20:30** 各取得一次 T86。Cron 為 `30-59 10 * * mon-fri`、`* 11-15 * * mon-fri`（UTC）；其餘分鐘僅接續同一輪的公司名錄、行情及 KV 分組作業，不反覆輪詢當日 T86。
- `syncSlot()` 使用台灣時間判定輪次。即使 18:30 已發布當日資料，20:30 仍會驗證一次；不再以 `manifest.asOf === today` 跳過第二輪。
- 週末不呼叫 TWSE；平日明確無資料回應記 `NoData`。這不宣稱當天已確認為休市，也可能尚未發布；保留舊資料，等待下一輪／後續補抓。日期錯誤、HTML、HTTP 429 等都記 `Failed`，不能誤當休市。
- T86 失敗／待確認即停止該輪，不重複密集請求。公司名錄、行情、KV 的暫時失敗仍以 30 分鐘冷卻接續、每輪最多 3 次，23:59 結束。
- 重複 Cron 遇到仍執行中的 `Running` 會等待原輪次，不重複取得；超過 5 分鐘仍未完成則將原紀錄記為 `Failed` 並保留錯誤證據，下一個 20:30 輪次可獨立執行。
- 18:30 失敗不發布當日排行；20:30 失敗保留已成功的 18:30 D1／KV 版本。初輪正常從 18:30 驗證法人、18:31 名錄、18:32 行情開始，隨後每分鐘合併兩組歷史。128 組全部寫妥並留 2 分鐘傳播時間才切換 KV 索引；18:30／20:30 是同步起點，不是完成發布的保證時間。
- 週五複查最近兩日及漏日回補仍走相同驗證與交易；每分鐘最多一次全市場上游請求。歷史筆數檢核只取該歷史交易日前的成功日期，不偷用未來資料。

## 驗證規則

`cloudflare/t86-validator.js` 的 `T86DataValidator` 是唯一驗證規則來源；日常同步、歷史回補及 seed 共用。既有 `normalizeFlows()` 只作純資料轉換，不是允許寫入的捷徑。

1. HTTP 必須 **200**；能解析 JSON 物件。`stat` 必須 `OK`，日期轉換為西元 `YYYYMMDD` 後與請求完全相符。不接受民國格式猜測或上一交易日資料。
2. `fields`／`data` 為陣列、19 個完整欄名都存在。欄位重新排序可接受；缺欄、重複欄名、非陣列不可接受。若回傳 `selectType`，必須與請求 `ALLBUT0999` 一致；若有 `total` 也要等於原始資料筆數。
3. 每列長度等於 `fields.length`；代號、名稱為非空字串，trim 後代號不可重複。先檢驗整份原始報表，再依上市公司名錄產生網站資料，不能拿篩選後的股票數作筆數基準。
4. 17 個法人數值全部解析。允許整數與正確千分位；拒絕空值、`--`、小數、科學記號、錯誤千分位、非安全整數。買進／賣出不可負，淨額可負；解析失敗不補 0。
5. 外陸資、外資自營商、投信、自營商自行買賣、避險逐一核對買－賣＝淨額。自行買賣淨額＋避險淨額＝自營商彙總；外陸資（不含外資自營商）＋投信＋自營商＝官方三大法人合計。資料庫保存全部原始數值與官方合計，不用重算值取代官方值。
6. 同查詢條件 `TWSE:T86:ALLBUT0999`，取目標日期之前最近 **5 個不同成功交易日**的最新版原始筆數中位數，當次至少 `ceil(中位數 × T86_HISTORY_RATIO)`；預設 **0.90**。
7. 20:30 若當日存在成功／相同的 18:30 版本，至少 `ceil(18:30 原始筆數 × T86_EVENING_RATIO)`；預設 **0.95**。18:30 失敗／無資料則沒有可比較的當日基準，仍須通過歷史檢核。
8. 未滿 5 個成功交易日，標記 **PendingConfirmation**。只有操作者對該日期、查詢條件與 **確切 DataHash** 的確認才能建立初始版本。確認不能豁免數值／結構／已有筆數門檻，也不能自動認可之後的不同內容。沒有固定 2,000 筆門檻。

可調參數在 `wrangler.jsonc`：`T86_HISTORY_RATIO`、`T86_EVENING_RATIO`，範圍大於 0、至多 1。錯誤參數會停止寫入。

## 儲存與錯誤處理

- `t86_sync_runs`：每次同步的 `TradeDate`、`SyncTime`（UTC ISO 格式）、`Source`、`RecordCount`、`DataHash`、`Status`、`ValidationResult`、`ErrorMessage`，另含 `RunId`、`QueryKey`、`Slot`、`RawJson`、`HttpStatus`、`VersionId`。原始回應包含非 JSON 錯誤頁也會保留；大型回應改存 `t86_raw_chunks`，透過 `T86Store.raw()` 可還原全文，避免 D1 單列大小限制影響錯誤留存。沒有收到回應時 RawJson／HttpStatus 為 null。尚未完成的呼叫保留 `Running` 便於追查。
- 必要檢核失敗只寫稽核紀錄，不寫 business／staging 表。預期狀態為 `Success`、`Unchanged`、`Failed`、`NoData`、`Skipped`、`PendingConfirmation`。
- Hash 為 SHA-256：固定查詢條件＋交易日＋19 欄完整欄名＋依代號排序的正規化數值與名稱。無關 JSON 空白、欄位順序、資料列排序不會造成假更新；日期、名稱、任何必要數值改變均會改變 Hash。
- 通過全部檢核後，`T86Store.commit()` 才呼叫 D1 `batch()`：競態保護 → `t86_staging` → 保存 `t86_versions` → `t86_daily` Upsert → 刪除本版已不存在的當日資料 → 切換 `t86_heads` → 記錄成功 → 清除暫存。整批是一個交易，中途任一 SQL 失敗會全部回滾，再另外記錄 `Failed`。
- `t86_versions.RowsJson` 保留歷次完整版本；`t86_daily.OfficialTotal` 保存官方三大法人合計。Hash 相同只更新同步紀錄／head 時間，不改逐股資料或新增資料版本。
- 交易內比對預期的現有 VersionId 與 SyncTime，阻止較舊／競爭中的呼叫覆蓋新版本。每日每輪有唯一索引，避免重複 Cron 重複擷取。公開 API 不提供匯入、確認基準或原始錯誤資料的入口。
- D1 成功不等於 KV 已發布。KV 必須完成所有分組；失敗時仍顯示最後成功的公開版本。發布前再核對 D1 VersionId，避免將過期 staged 版本公開。

交易語義參照 [Cloudflare D1 batch 官方文件](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)。

## 本機操作

要求 Node.js 22.12 以上；測試使用 Node SQLite，產品程式不依賴該模組。所有管理命令預設只操作本機 D1，不會部署或推送。

```powershell
npm.cmd run t86:admin -- --migrate
npm.cmd run t86:admin -- --date=2026-10-16 --file=.wrangler/twse-cache/flows-2026-10-16.json
npm.cmd run t86:admin -- --status
```

首次匯入會輸出 `PendingConfirmation` 與 RunId，結束碼 1 表示尚未准許入庫。操作者先核對原始報表、日期、查詢條件及筆數，之後才執行：

```powershell
npm.cmd run t86:admin -- --approve=上一步的RunId --confirmed-by=實際確認者
```

此命令保存確認紀錄後以相同原始 JSON 再跑整套驗證／交易，產生新的同步紀錄；原待確認紀錄保留。不能核准一般 Failed，也不能以確認豁免資料錯誤。

建立基準時，**依交易日期從舊到新**匯入並逐筆確認至少 5 份完整報表。若要 seed 90 日，基準的日期須早於最早目標日期；否則該歷史日期仍會待確認。seed 需要本機 D1 migration 與基準，通過後才輸出可匯入 KV 的檔案。原始快取不足時仍循序請求、至少相隔 10 秒，並使用同一個 `syncT86()`；HTTP／驗證錯誤都會保留同步紀錄，不會繞過檢核。歷史回補通常使用已下載的原始檔，避免重複呼叫 TWSE。

## 正式啟用（尚未由本次修改執行）

1. `npx.cmd wrangler d1 create stockapps-t86`，將回傳的真正 `database_id` 補到 `wrangler.jsonc` 的 `T86_DB`；目前刻意未填，不偽造遠端 ID。
2. `npm.cmd run t86:admin -- --migrate --remote`，套用交易式 migration。`d1_migrations` 使用 Wrangler 標準 migration 名稱追蹤，已套用不重跑。
3. 對最近 5 個、早於預定首輪交易日的完整官方快取，依日期匯入與人工核對，使用上述 `--file`、`--approve` 命令加 `--remote`。未提供 `database_id` 時管理命令會拒絕遠端操作。只有本機基準不會自動成為正式基準。
4. `npm.cmd test`、`npm.cmd run test:t86-runtime`、`npm.cmd run build:cloudflare`、`npx.cmd wrangler deploy --dry-run`。
5. 經使用者要求發布時才推送、部署，再檢查真正排程紀錄及網站資料日期。

`wrangler.jsonc` 只宣告 D1 binding，單靠部署不會替代 migration 或基準確認。缺少 D1／資料表時流程停止，既有公開 KV 不會被改寫。

若建立／列出 D1 回傳 Cloudflare `Authentication error [code: 10000]`，且 `wrangler whoami` 顯示缺少 `d1:write`，需先補充 OAuth 授權。原有 Worker／KV 權限不能代替 D1 權限；保留目前部署所需權限並加入 D1：

```powershell
npx.cmd wrangler login --scopes user:read account:read workers:write workers_kv:write workers_scripts:write workers_tail:read d1:write
```

在開啟的 Cloudflare 官方頁完成登入與授權後，再建立資料庫。OAuth 頁面逾時時重新執行此命令；不要將權杖貼到對話或提交到 Git。

## 驗證

`tests/t86.test.js` 涵蓋欄名重排、缺少全部必要欄位、每個數值欄位異常、算式不符、錯誤日期、筆數邊界、待確認 Hash、Upsert、版本保留、競態、失敗原始資料與兩輪排程。

`npm.cmd run test:t86-runtime` 使用隔離且不持久化的本機 workerd/D1，測試 1,000 檔資料、建立 5 日基準、相同 Hash 跳過，並在 Upsert 之後以 SQLite trigger 故意中止，確認資料、版本與暫存均回滾、失敗 JSON 仍保留。不呼叫 TWSE，不接觸遠端資料庫。
