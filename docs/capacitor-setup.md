# Capacitor 技術驗證

## 固定識別

- App ID / Android application ID / iOS bundle ID：`io.github.hgs3767994.wuwangwo`
- App 顯示名稱：`莫忘`
- Web bundle：`www/`（由 `npm run build:web` 產生，不提交 Git）

## 安全邊界

- 原生 App 仍只取得短效 Worker session；Google access token、refresh token、DEK、主密碼與救援碼不得進入 Web bundle、Android resources、iOS plist 或 Git。
- Android 原生 OAuth 只在 Capacitor 原生環境呼叫 Google Play services `AuthorizationClient`；以 `requestOfflineAccess(serverClientId)` 取得一次性 server auth code，再送到 Worker 交換 refresh token。Google 密碼、access token、refresh token與 Web client secret都不會進入 WebView bundle。
- Worker 的 native exchange endpoint只接受一次性 server auth code，並以伺服器端 Web client secret完成交換後建立短效 Worker session。Android OAuth client仍以 package name與簽章 SHA-1識別正式 App。
- Android trusted session 已改為 Android Keystore：DEK 僅以 Keystore 的不可匯出 AES 金鑰加密，IndexedDB 只保存 vault／裝置／session epoch 中繼資料；每次重新開啟，或離開背景滿2分鐘後回到前景，均要求生物辨識或裝置螢幕鎖。iOS Keychain 仍待實作。
- 這項 Android 實作已通過 Java 編譯、Web 安全邊界測試與 debug APK 建置；但完整實機解鎖驗證需等待原生 OAuth + PKCE 完成，讓 App 可建立真實的 Drive trusted session。

## 建立環境

1. 安裝 Node.js LTS（含 npm）與 Android Studio／Android SDK。Capacitor Android 8 需使用 JDK 21；本機使用 `C:\Users\jp619\AppData\Local\Programs\EclipseAdoptium\jdk-21.0.12.1+1`，不能使用目前 Android Studio 內建的 Java 25 直接建置。
2. 在專案根目錄執行 `npm install`，此步會產生 lockfile。
3. 建置固定 bundle：設定 `GOOGLE_OAUTH_API_URL` 為 Worker URL 後執行 `npm run build:web`。
4. 產生原生專案：`npx cap add android`、`npx cap add ios`；後者可在 Windows 產生檔案，但必須在 macOS + Xcode 編譯與簽署。
5. 每次 Web 改動後執行 `npm run cap:sync`。

## Android 實機與正式簽章

- Debug APK：`android\app\build\outputs\apk\debug\app-debug.apk`；僅供實機測試，不能作為商店正式版。
- Release keystore、正式 SHA-1／SHA-256 與 AAB 建置步驟見 [android-release-signing.md](android-release-signing.md)。keystore 與密碼永遠留在本機且不提交 Git。

## 尚待建立前的外部設定

- Android：在 Google Auth Platform建立 Android OAuth client，package name為 `io.github.hgs3767994.wuwangwo`，正式 SHA-1為 `CA:83:23:D0:02:68:C0:00:22:70:0B:59:BF:6E:26:42:4C:B5:14:AA`。若用 debug APK測試，還要另建一個相同 package name、debug SHA-1的 client。
- iOS：登入 Apple Developer、註冊 bundle ID，建立 iOS OAuth client並改用 Google Sign-In for iOS／AppAuth支援的原生流程；Windows無法完成 Xcode簽署與真機驗證。
- Google Cloud：Android `requestOfflineAccess` 使用既有 Cloudflare Web backend client ID 作為 server client ID。Web client secret只存在 Worker secret；Android bundle只包含公開 client ID。

## `shawnghong.com` 正式環境啟用順序

1. PWA 使用 `https://wuwangwo.shawnghong.com`；Worker 使用 `https://wuwangwo-api.shawnghong.com`，Web callback固定為 `https://wuwangwo-api.shawnghong.com/v1/oauth/google/callback`。
2. 在 Cloudflare把 `wuwangwo-api.shawnghong.com` 設成 `forget-me-not-oauth` 的 Custom Domain；在 DNS建立 `wuwangwo` 指向 `hgs3767994.github.io`，再到 GitHub Pages設定相同 Custom domain。
3. 在 Google Auth Platform的 Cloudflare Web backend client加入新的 callback；OAuth品牌頁的首頁、隱私權政策與服務條款改用 `wuwangwo.shawnghong.com`。
4. 建立 Android OAuth client（package name + 正式 SHA-1）。原生 App不使用任意 HTTPS App Link作為 Google redirect URI；Google Play services會把結果直接交回原生 Activity。
5. Android bundle設定 `GOOGLE_OAUTH_API_URL=https://wuwangwo-api.shawnghong.com` 與公开的 `GOOGLE_OAUTH_SERVER_CLIENT_ID`，再執行 `npm run cap:sync`。
6. 實機測試取消、拒絕授權、成功交換、關閉重開、背景鎖定、Worker session到期與 `sessionEpoch` 失效；通過後才產生正式 AAB／APK。
