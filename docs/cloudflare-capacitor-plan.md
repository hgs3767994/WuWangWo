# Cloudflare Workers 與 Capacitor 前置設計

## 已確認的安全決策

- Google Drive 的 vault 與 key package 維持在使用者自己的 `appDataFolder`；Workers 只傳遞加密 blob，絕不解密人物資料。
- Workers 可保存**加密後**的 Google refresh token，以代表使用者存取其 Drive；token 資料庫、加密金鑰與資料明文必須分離。
- Recovery v3 的救援碼是由使用者保管的高強度復原憑證，可解開救援用 DEK 包裝並直接重設主密碼。
- 救援碼遺失時，可由一部已登入且能解開 DEK 的舊裝置，透過一次性公鑰把加密救援封包安全轉交給新裝置。
- Worker 只能中繼加密救援封包、短效驗證碼雜湊與路由資訊，永遠不能取得 DEK、主密碼、救援碼或 vault 明文。
- 若主密碼與救援碼皆遺失，且沒有任何已登入舊裝置，既有 vault 不可復原。

## Recovery v3 流程

### 使用救援碼

1. 使用者輸入救援碼、新密碼及再次輸入新密碼。
2. App 以救援碼解開 `recoveryCodeWrapper`，取得原 DEK 並確認可解密 vault。
3. App 以新密碼建立新的 `masterPasswordWrapper`，同時產生新救援碼及新的 `recoveryCodeWrapper`。
4. 成功更新後提高 `sessionEpoch`；舊密碼、舊救援碼及其他裝置的舊 session 失效。

### 使用已登入舊裝置授權

1. 新裝置產生一次性 RSA-OAEP 公私鑰與配對碼，建立綁定 vault、Google 帳戶、裝置及當前 `sessionEpoch` 的請求。
2. 舊裝置核對配對碼並以已解鎖的 DEK 建立只能由新裝置一次性私鑰解開的救援封包。
3. Worker 產生8位數驗證碼，只保存其雜湊；請求、驗證碼與救援封包均在5分鐘後失效，最多允許5次錯誤驗證。
4. 新裝置輸入驗證碼、取得加密封包並在本機解開 DEK，之後才設定新密碼。
5. 新裝置確認新 key package 已寫入且可解開 vault 後，才完成請求、提高 `sessionEpoch` 並產生新救援碼。
6. 核准裝置在線時會於完成後鎖定；其他裝置下次連線時失效。新密碼不會傳送給 Worker 或其他裝置。

### 從現有格式遷移

Recovery v2 的 key package 只有 `recoveryAuthorizationVerifier`，不能在沒有舊裝置時直接恢復 DEK。既有使用者必須在仍可解鎖時執行「重新產生救援碼」，建立新的 `recoveryCodeWrapper` 並妥善保存新碼；已完全鎖定的 v2 vault 仍須先走一次舊裝置授權。新建 vault 直接採 Recovery v3。

## Workers OAuth 與同步 API

`workers/oauth/` 提供 health、Google OAuth callback、一次性 handoff 與受限的 Drive proxy。health endpoint 會以 `SELECT 1` 確認 `OAUTH_DB` 綁定可用；Google refresh token 只以加密 envelope 存於 D1。Worker 只接受 `key-package.enc`、`vault.enc` 與短暫診斷檔，不能存取 Drive 其他檔案，也不會解密 vault、DEK、主密碼或救援碼。

在啟用 OAuth 前，先由 D1 Console 執行 `workers/oauth/schema.sql`；既有資料庫還必須依序套用 `0002-sessions.sql`、`0003-recovery-requests.sql` 與 `0004-recovery-v3.sql`。Recovery v3 資料表只保存短效路由資訊、一次性公開金鑰、驗證碼雜湊與加密救援封包；不存 vault、DEK、主密碼、救援碼、任何可由 Worker 解開的 DEK wrapper、access token 明文或 refresh token 明文。

部署前必須由管理者設定：

- `APP_ORIGINS`：允許呼叫 API 的 PWA 與 Capacitor origin 清單。
- `GOOGLE_WEB_CLIENT_ID` 與 `GOOGLE_OAUTH_REDIRECT_URI`：可公開的 Web OAuth 設定。
- `GOOGLE_WEB_CLIENT_SECRET`：僅以 Worker secret 保存。
- `OAUTH_STATE_SIGNING_KEY`：僅以 Worker secret 保存；用於 state／一次性登入授權。
- `TOKEN_ENCRYPTION_KEY`：僅以 Worker secret 保存；用於資料庫中的 refresh token envelope。
- `GOOGLE_NATIVE_CLIENT_ID`：Android/iOS public OAuth client ID；可公開，但尚未設定前 native OAuth endpoint 會保持停用。
- `NATIVE_OAUTH_APP_LINK_URI`：唯一的正式 HTTPS App Link callback；native start endpoint 只接受 PKCE code challenge，native exchange endpoint 只接受同一 state 所對應的 verifier。

在沒有自有網域時，可將 `https://<worker>.<account-subdomain>.workers.dev` 作為開發 callback。它不應作為正式 OAuth 或上架的長期網址；正式環境應採已驗證的自有網域。

## 下一階段的 API 邊界

1. Web OAuth BFF：`/v1/oauth/google/start`、`/callback`、`/session`、`/logout`。
2. 原生 OAuth：Android/iOS 從系統瀏覽器啟動 Authorization Code + PKCE，回傳 app deep link；不在 WebView 載入 GIS popup。
3. 共用同步 API：只接受與回傳已加密的 key package、vault 和 recovery request；所有 API session 都採短效、可撤銷憑證。
4. Token store：採 D1 schema 保存加密 token envelope、Google subject、scope、更新時間與撤銷狀態；不保存 DEK、主密碼、救援碼或 vault 明文。

## Capacitor 前置條件

在建立 `capacitor.config.*` 與原生專案前，仍需要：

- Android application ID 與簽署憑證 SHA-1。
- iOS bundle ID 與 Apple Developer Team 設定。
- 固定 Web bundle 產物與可重現的 `cap sync` 流程。
- Worker 的開發 URL；正式階段再換成自有網域。

建立後，Capacitor 將以現有靜態 Web core 為唯一 UI 來源，並以原生 secure storage（iOS Keychain／Android Keystore）取代 trusted session 的 IndexedDB key 保存。
