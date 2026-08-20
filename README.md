# 勿忘我 PWA

「勿忘我」是一個用來記錄人物資料、興趣喜好、自訂欄位與備註的 local-first PWA。

目前專案以純前端靜態檔案運作，資料先保存在瀏覽器本機 IndexedDB；若啟用 Google Drive，同步會使用真實 OAuth 與 `appDataFolder` 儲存加密資料。

## 本機開發

```bash
npm run dev
```

預設測試網址：

```text
http://localhost:4173/
```

## GitHub Pages 部署

此專案已包含 GitHub Pages 部署流程：

```text
.github/workflows/deploy-pages.yml
```

部署流程會自動：

- 執行專案檢查
- 執行核心邏輯測試
- 建立 `dist/` 部署資料夾
- 產生 GitHub Pages 用的 `src/runtime-config.js`
- 上傳並部署到 GitHub Pages

首次部署前，請在 GitHub repository 設定：

```text
Settings → Pages → Build and deployment → Source → GitHub Actions
```

若正式版要啟用真實 Google Drive 同步，請再加入 repository variable：

```text
Settings → Secrets and variables → Actions → Variables
```

新增：

```text
GOOGLE_OAUTH_CLIENT_ID = 你的 OAuth Client ID
```

OAuth Client ID 是前端公開設定，不是密碼；不要加入 client secret。

部署後，請把正式網址加入 Google Cloud Console：

```text
APIs & Services → Credentials → OAuth 2.0 Client IDs → Authorized JavaScript origins
```

GitHub Pages 專案頁通常會是：

```text
https://你的帳號.github.io/你的 repo 名稱
```

若沒有設定 `GOOGLE_OAUTH_CLIENT_ID`，部署版會保持本機模擬同步模式；App 仍可使用，但不會連到真實 Google Drive。

## 專案檢查

```bash
npm run check
```

目前檢查包含：

- 必要檔案是否存在
- manifest JSON 是否有效
- manifest 必要 PWA 欄位
- manifest icon 檔案是否存在
- service worker app shell 檔案是否存在
- 必要檔案是否被 service worker 快取
- `src/config.js` 的 `cacheName` 是否與 `service-worker.js` 的 `CACHE_NAME` 一致
- GitHub Pages 部署流程是否包含檢查、測試、建置與部署

## 核心邏輯測試

```bash
npm run test
```

目前測試包含：

- 設定檔預設值
- 同步合併與資料衝突偵測
- 舊格式自訂欄位值相容
- XLSX 匯出檔案產生

## 目前同步模式

目前程式預設：

```text
driveProvider: mock
```

也就是使用本機模擬 Google Drive。若要切換真實 Google Drive，主要會從這些檔案銜接：

- `src/config.js`
- `src/runtime-config.js`
- `src/drive.js`
- `src/drive-google.js`
- `src/drive-mock.js`

切換真實 Google Drive 時，請在 `src/runtime-config.js` 設定，或直接在 App 的「Google Drive 連線診斷」頁貼上 Client ID：

```js
window.FORGET_ME_NOT_CONFIG = {
  driveProvider: "google",
  googleDrive: {
    clientId: "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com"
  }
};
```

勿忘我使用 Google Drive `appDataFolder`，OAuth scope 為：

```text
https://www.googleapis.com/auth/drive.appdata
```

請勿在前端放入 Google client secret。

切換到 Google Drive 模式並填入 Client ID 後，可到 App：

```text
設定 → Google Drive 同步 → Google Drive 連線診斷
```

診斷會建立暫時檔案、讀回驗證後刪除，不會修改正式資料檔。

目前真實 Google Drive 診斷成功後，代表以下流程已打通：

- Google OAuth 授權
- `appDataFolder` 寫入
- `appDataFolder` 讀取
- 測試檔刪除

一般使用時，人物資料仍會先穩定保存在本機；若 Google 授權暫時失效，畫面會提醒重新授權，不會因此中斷本機資料儲存。

開發測試時，也可以直接在「Google Drive 連線診斷」頁貼上 OAuth Client ID，使用「套用 Google 模式並重新載入」。這會把設定存在目前瀏覽器的 localStorage，不會寫入專案檔案。

診斷頁也會顯示目前 `origin`，請將該值加入 Google Cloud Console：

```text
APIs & Services → Credentials → OAuth 2.0 Client IDs → Authorized JavaScript origins
```

本機測試通常會是：

```text
http://localhost:4173
```

## 快取版本

每次更新 PWA shell 相關檔案後，請同步更新：

- `src/config.js` 的 `cacheName`
- `service-worker.js` 的 `CACHE_NAME`

目前 `npm run check` 會檢查兩者是否一致。

本次快取版本：

```text
forget-me-not-v37
```

## 部署提醒

部署到 GitHub Pages 時需確認：

- `manifest.webmanifest` 的 `start_url`
- service worker scope
- 靜態資源路徑是否都能以相對路徑載入
- 若串接 Google Drive OAuth，Google Cloud Console 需加入正式部署網址到 Authorized JavaScript origins
- GitHub repository variable 已設定 `GOOGLE_OAUTH_CLIENT_ID`

## 安全備註

匯出的 JSON / XLSX 不包含密碼、資料金鑰或救援碼，但仍包含人物資料，應妥善保存。
