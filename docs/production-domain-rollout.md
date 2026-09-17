# `shawnghong.com` 正式網域切換清單

## 固定網址

- PWA：`https://wuwangwo.shawnghong.com`
- OAuth／Drive Worker：`https://wuwangwo-api.shawnghong.com`
- Google Web OAuth callback：`https://wuwangwo-api.shawnghong.com/v1/oauth/google/callback`
- Android application ID：`io.github.hgs3767994.wuwangwo`
- Android 正式 SHA-1：`CA:83:23:D0:02:68:C0:00:22:70:0B:59:BF:6E:26:42:4C:B5:14:AA`
- Android 正式 SHA-256：`6D:4D:32:DB:C1:49:1F:0D:E8:F4:15:69:A9:2A:9B:6E:E1:B3:CF:68:06:35:AD:8C:BC:87:5A:69:03:F2:59:6E`

## 外部控制台設定

1. Cloudflare Worker `forget-me-not-oauth` 加入 Custom Domain `wuwangwo-api.shawnghong.com`。Wrangler設定已寫入專案，部署後 Cloudflare會建立 DNS與憑證。
2. Cloudflare DNS建立 `CNAME wuwangwo -> hgs3767994.github.io`。先使用 DNS only；待 GitHub Pages核發憑證並確認 HTTPS後，再評估是否開啟 proxy。
3. GitHub repository Pages設定 Custom domain `wuwangwo.shawnghong.com` 並啟用 Enforce HTTPS。
4. GitHub Actions repository variables：
   - `PWA_CUSTOM_DOMAIN=wuwangwo.shawnghong.com`
   - `GOOGLE_OAUTH_API_URL=https://wuwangwo-api.shawnghong.com`
   - `GOOGLE_OAUTH_CLIENT_ID` 保留目前公開的 PWA client ID。
5. Google Auth Platform的「莫忘 Cloudflare 開發後端」Web client新增 `https://wuwangwo-api.shawnghong.com/v1/oauth/google/callback`；遷移驗證完成前保留舊 `workers.dev` callback。
6. Google Auth Platform Branding：
   - App homepage：`https://wuwangwo.shawnghong.com/`
   - Privacy policy：`https://wuwangwo.shawnghong.com/privacy.html`
   - Terms of service：`https://wuwangwo.shawnghong.com/terms.html`
   - Authorized domain：`shawnghong.com`
7. 建立 Android OAuth client：package name `io.github.hgs3767994.wuwangwo` + 正式 SHA-1。若要安裝 debug APK測試，另建 debug SHA-1 client；正式與 debug client不要混用。

## Worker公開變數與 secrets

公開變數已寫入 `workers/oauth/wrangler.jsonc`：

- `APP_ORIGINS=https://hgs3767994.github.io,https://wuwangwo.shawnghong.com,https://localhost,http://localhost,capacitor://localhost`
- `GOOGLE_WEB_CLIENT_ID=302767053218-g8vn882h0o5iijh0ckr49s6csjrkmlno.apps.googleusercontent.com`
- `GOOGLE_OAUTH_REDIRECT_URI=https://wuwangwo-api.shawnghong.com/v1/oauth/google/callback`

以下 secrets必須保留在 Cloudflare，不得寫入 Git或 APK：

- `GOOGLE_WEB_CLIENT_SECRET`
- `OAUTH_STATE_SIGNING_KEY`
- `TOKEN_ENCRYPTION_KEY`

## Android 重建

PowerShell建置環境：

```powershell
$env:GOOGLE_OAUTH_API_URL = "https://wuwangwo-api.shawnghong.com"
$env:GOOGLE_OAUTH_SERVER_CLIENT_ID = "302767053218-g8vn882h0o5iijh0ckr49s6csjrkmlno.apps.googleusercontent.com"
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
npm run cap:sync
```

重建前必須以目前 HEAD重新產生 `www/`，不得複用舊 bundle。正式簽章檔與密碼只留在本機 `android/keystore.properties` 指向的位置。

## 驗收順序

1. `https://wuwangwo-api.shawnghong.com/health` 回報 OAuth、D1與 schema ready。
2. 新 PWA網址可安裝、登入、同步，舊 GitHub Pages網址仍可完成既有使用者遷移。
3. Android原生授權畫面由 Google Play services顯示，不在 WebView內打開 Google登入頁。
4. Worker只收到一次性 server auth code；APK與 Web bundle不包含 client secret、refresh token或 Google access token。
5. 測試同步、重新啟動、背景兩分鐘鎖定、Worker session到期、安全性寫入、跨裝置密碼變更與永久刪除同步。
6. 全部通過後才移除舊 `workers.dev` callback或關閉 `workers_dev`。
