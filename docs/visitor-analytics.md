# 管理員訪客統計

部署後開啟 `/admin-visitors.html`。以 Cloudflare Worker secret 設定至少 32 字元的隨機 `ADMIN_ANALYTICS_TOKEN`（例如使用 `npx wrangler secret put ADMIN_ANALYTICS_TOKEN`），再以此密鑰登入。密鑰只留在管理頁記憶體，登出或重新載入即清除；請勿放入原始碼或前端環境變數。透過 HTTPS 使用。

GET `/api/presence` 與 `/api/v1/presence` 均需要 `Authorization: Bearer <密鑰>`，未設定密鑰回應 503，驗證失敗回應 401。POST 僅回傳寫入成功，不公開數量。支援 `start`、`end`（YYYY-MM-DD）、`offset`，每頁最多 100 筆。回應禁止快取。

統計沿用既有 SQLite Durable Object，不需新增 D1 migration。啟動時匯入尚未刪除的舊瀏覽器紀錄；原始時間未知則為空值。之後依台北日期永久保留每日匿名識別碼、首次及最近紀錄時間，同時保留 Cloudflare 提供的來源 IP 與訪客選填國籍，不收集完整瀏覽路徑。國籍為自述資料，未驗證身分；IP 可能由多位使用者共用，不可當成唯一人數。正式 Worker 以 Cloudflare 覆寫的 CF-Connecting-IP 為來源，請勿在繞過 Cloudflare 的代理環境信任自訂標頭。最近時間是瀏覽器每日回報的時間，不代表精確離站或持續在線時間。需要容量及保留期限時應另外規劃清理政策。

不同裝置、瀏覽器或清除 localStorage 會視為不同訪客；這是匿名瀏覽器估計，不能辨識真實個人，也不保證排除機器流量。啟用前已刪除的歷史資料無法回補，無紀錄日期不等於零訪客。

連線國家／地區來自 Cloudflare `CF-IPCountry`（ISO 國碼，缺少時顯示未知），不能代表國籍；VPN 或代理可能導致誤差。

趨勢面板整合「每日」、「每月」及「全部歷史（按月）」。每日範圍最多 366 天，每月範圍最多 3651 天；全部歷史自最早保留日期至今日。月統計與期間總人數皆使用 DISTINCT 瀏覽器識別碼，並非每日人數相加。月統計以選定日期範圍計算，首尾月份可能不完整。API 可指定 `period=day|month`、`scope=range|history`，歷史模式固定按月。

國籍可由訪客在工作台右上方「訪客資料說明」選填；同一瀏覽器會記住填寫值，後續每日回報沿用。國籍與 IP 推估的連線國家／地區分開儲存與顯示。
