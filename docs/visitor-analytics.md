# 管理員瀏覽統計

部署後開啟 `/login.html`，輸入管理員帳號密碼。管理員會進入 `/admin-visitors.html`；一般使用者無法查閱統計。建置帳號、migration 與維護指令見 [帳號與管理員權限](accounts.md)。

GET `/api/presence` 與 `/api/v1/presence` 均需要有效的管理員登入 Cookie，沒有登入回應 401，一般使用者回應 403。使用臨時密碼登入、尚未完成首次密碼變更的帳號同樣回應 403；v1 的 `error.code` 為 `PASSWORD_CHANGE_REQUIRED`，舊版路徑則在頂層回傳 `code`。須先至 `/change-password.html` 建立新密碼才能查詢。這項限制由後端執行，無法透過修改前端或直接呼叫 API 繞過。POST 僅回傳寫入成功，不公開數量。支援 `start`、`end`（YYYY-MM-DD）、`offset`，每頁最多 100 筆。回應禁止快取。舊版 `ADMIN_ANALYTICS_TOKEN` 已停用。

統計沿用既有 SQLite Durable Object，新 `visit_events` 表逐筆保存每次進入或重新載入頁面的事件。同一瀏覽器再次進入會再計數，**不按瀏覽器或日期去重**。同頁面重建導覽、失敗重試不會增加次數。前端跨台北午夜會更新回報的頁面事件 key。事件以首次接收時間所屬的台北日期保存；重試或資料更新不會將舊事件移到其他日。

POST body 為 `{id, visitId?, metadataOnly?}`，上限 512 UTF-8 bytes。`id` 與 `visitId` 使用 UUID v4；`visitId` 每次頁面載入重新生成，網路重試沿用同值，因此重送不會膨脹計數。相容舊版的 `metadataOnly:true` 必須帶 `visitId`，只更新該 `id` 已有事件的邊緣來源資料；不存在不建立，不允許改綁其他瀏覽器，也不新增計數。舊客戶端只有 `id` 時，每次 POST 各計一次。瀏覽器 ID 保留作為明細欄位，不代表唯一人數。

原 `visit_history` 與 `visitors` 保留不刪，舊每日瀏覽器紀錄每列只安全換算為至少一次瀏覽，不能重建當時被去重的重複進入次數。匯入以永久 `legacy_key`、固定事件 key 與完成標記確保重啟／中途重試不重複匯入。時間未知維持 `null`；已刪除的歷史不能回補。此為 DO 內部 schema 升級，不新增 D1 migration；帳號仍需 `0007_auth.sql` 與 `0008_required_password_change.sql`。

事件保留匿名識別碼、首次／最近回報時間、Cloudflare 提供的來源 IP 與國籍（依 IP 推估），不需訪客填寫。既有自填資料欄位原樣保留，但目前事件讀寫與 API 不再使用或回傳；舊版 PWA 傳送的自填值會被忽略，不影響計數。

國籍（依 IP 推估）取可信任的 Cloudflare `request.cf.country`，有效時優先於 `CF-IPCountry`，缺少或無效時才使用該 Cloudflare 覆寫標頭。代碼統一為大寫 ISO 兩碼；`T1`、`XX` 與其他未知／無效代碼回 `null`，畫面顯示未知。來源 IP 取 `CF-Connecting-IP`。JSON 中的國家、IP 或舊自填資料均不作為地理來源；VPN 或代理可能影響推估結果。

管理頁使用 `GET /api/v1/presence?month=YYYY-MM` 自動載入該月每日統計；未指定舊版範圍時預設當月。當月 `end` 截至台北今日。未來月份、無效月份及日期回 400；沒有紀錄的歷史月份仍可查詢並回空陣列，趨勢不補造缺少日期的零值。

- `daily[]` 的 `{day,visitors,visits}` 為每日瀏覽次數，`visits` 與舊欄名 `visitors` 相同。
- `total` 是選定月份或舊範圍的全部事件次數。
- `selectedDay=YYYY-MM-DD` 必須是月份／範圍內的有效日期，而且不晚於今日；只篩選 `visitors[]` 明細與 `detailTotal`，不改變整月趨勢或 `total`。未選日則 `detailTotal` 等於該範圍總筆數。
- 明細依日期、首次接收時間倒序；`offset` 非負整數，每頁固定最多 100 筆。每列含 `event_id`、瀏覽器 `id`、日期、首次／最近回報時間及管理員可見資料。
- `overall:{total,firstDay,lastDay}` 是所有保留事件的累積總次數與最早／最近日期，不隨月份、選日或分頁改變；空資料日期回 `null`。
- `months[]` 為有紀錄的月份加上當月，最新在前；也允許另外查詢沒有紀錄的歷史月份。

舊版 `start`、`end`、`period=day|month`、`scope=range|history` 可繼續使用。每日範圍最多 366 天，按月最多 3651 天，全部歷史自最早保留日期至今日。每日、每月及全部歷史都累加事件次數；保留的 `unique` 僅為舊版相容欄位，管理頁不以它顯示瀏覽量。
