# 帳號與管理員權限

共用 `/login.html` 輸入帳號、密碼。一般使用者登入後回研究工作台；管理員登入後可進入 `/admin-visitors.html`，查看每日、每月與歷史訪客統計。公開市場資料仍可瀏覽。帳號由維護者建立，本版不提供自行註冊或 Email 重設密碼。

## 首次上線

在部署此版本前，先套用 D1 migration（新增獨立帳號資料表，不修改股票資料）：

```sh
npx wrangler login
npx wrangler d1 migrations apply stockapps-t86 --remote
node scripts/manage-user.mjs create your-admin --role admin --remote
node scripts/manage-user.mjs create your-user --role user --remote
npm run deploy
```

建立帳號會提示輸入密碼，終端機不顯示輸入內容；密碼需 12～128 字元。沒有預設帳號或預設密碼。帳號不分大小寫，限 3～64 個英文字母、數字與 `_.@-`，以字母或數字開頭。若本機測試，以上 migration 與帳號指令改用 `--local`，使用 `npm run dev:cloudflare`（http://127.0.0.1:8787）。若本機尚未匯入行情，可另外執行 `npm run dev`（http://127.0.0.1:5173），用標明示範資料的工作台查看畫面；登入與統計 API 仍代理到本機 8787。

不再使用 `ADMIN_ANALYTICS_TOKEN`。舊密鑰無法登入或取得統計，正式環境可刪除該 secret。

## 帳號維護

```sh
node scripts/manage-user.mjs reset-password your-user --remote
node scripts/manage-user.mjs set-role your-user --role admin --remote
node scripts/manage-user.mjs disable your-user --remote
node scripts/manage-user.mjs enable your-user --remote
node scripts/manage-user.mjs revoke-sessions your-user --remote
```

上述操作皆會撤銷該帳號的既有登入。`create` 不會覆寫同名帳號；修改密碼使用 `reset-password`。只有具 Cloudflare 資料庫維護權限的人能執行這些指令。SQL 暫存檔只包含加鹽密碼雜湊，使用 0600 權限，執行後刪除；不要保存明文密碼到 Git、命令列參數或日誌。

## 驗證與權限

- 密碼以 PBKDF2-SHA256（100,000 次、獨立隨機 salt）雜湊保存，不儲存明文。
- 登入建立隨機 256-bit session；D1 只保存 token 的 SHA-256 雜湊。
- Cookie 使用 HttpOnly、Secure、SameSite=Strict、Path=/，12 小時後到期；登出在伺服器撤銷 session。正式網站需 HTTPS。
- 每次查詢紀錄都由後端讀取帳號目前角色與停用狀態。沒有登入回 401，一般使用者回 403，前端修改角色或舊管理員密鑰均不會取得權限。
- 登入限制每帳號 5 次／15 分鐘、每來源 IP 30 次／15 分鐘；成功登入會清除該帳號的失敗計數。錯誤密碼與不存在帳號使用相同錯誤訊息。
- Auth API 與統計 API 不快取，也不寫入 PWA 離線快取。

端點：`POST /api/v1/auth/login`（JSON `{ username, password }`）、`GET /api/v1/auth/me`、`POST /api/v1/auth/logout`。請求使用同源 Cookie，勿把 session 存進 localStorage。變更角色只能透過可信任的維護工具，登入 API 不接受使用者指定的角色。
