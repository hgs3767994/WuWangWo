# Capacitor 技術驗證

## 固定識別

- App ID / Android application ID / iOS bundle ID：`io.github.hgs3767994.wuwangwo`
- App 顯示名稱：`莫忘`
- Web bundle：`www/`（由 `npm run build:web` 產生，不提交 Git）

## 安全邊界

- 原生 App 仍只取得短效 Worker session；Google access token、refresh token、DEK、主密碼與救援碼不得進入 Web bundle、Android resources、iOS plist 或 Git。
- 原生 OAuth 會採系統瀏覽器 + Authorization Code + PKCE，不能沿用 Web PWA 的 popup flow。
- Worker 要在原生 OAuth 開始前新增 Android/iOS public client 的允許設定與 PKCE code exchange；本階段不會以 Web client secret 冒充原生 client。
- trusted session 將由原生 Keychain（iOS）或 Android Keystore 保護；尚未完成前不可宣稱原生版已可安全保存 trusted session。

## 建立環境

1. 安裝 Node.js LTS（含 npm）與 Android Studio／Android SDK。
2. 在專案根目錄執行 `npm install`，此步會產生 lockfile。
3. 建置固定 bundle：設定 `GOOGLE_OAUTH_API_URL` 為 Worker URL 後執行 `npm run build:web`。
4. 產生原生專案：`npx cap add android`、`npx cap add ios`；後者可在 Windows 產生檔案，但必須在 macOS + Xcode 編譯與簽署。
5. 每次 Web 改動後執行 `npm run cap:sync`。

## 尚待建立前的外部設定

- Android：Google 已停止支援 Android custom URI scheme OAuth 回跳。必須先有自有 HTTPS 網域，建立並驗證 Android App Link，才可安全完成系統瀏覽器 + PKCE；不能以目前的 `workers.dev` 或自訂 scheme 冒充正式回跳。
- iOS：登入 Apple Developer、註冊 bundle ID，建立 iOS OAuth client；其回跳設定要與日後 Android 的正式 HTTPS callback 策略一併確認。
- Google Cloud：原生 client callback 與 Worker PKCE exchange 設計完成後才新增，不把 web client secret 複製到原生端。
