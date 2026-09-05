# Cloudflare Workers 與 Capacitor 前置設計

## 已確認的安全決策

- Google Drive 的 vault 與 key package 維持在使用者自己的 `appDataFolder`；Workers 只傳遞加密 blob，絕不解密人物資料。
- Workers 可保存**加密後**的 Google refresh token，以代表使用者存取其 Drive；token 資料庫、加密金鑰與資料明文必須分離。
- 救援碼只可授權「啟動密碼重設」，不能作為 DEK 的解密材料。
- 保留既有資料的密碼重設必須由至少一部已登入且能解開 DEK 的舊裝置核准，並由該裝置產生新的 `masterPasswordWrapper`。
- 若主密碼與救援碼皆遺失，且沒有任何已登入舊裝置，既有 vault 不可復原；使用者只能建立新 vault。

## Recovery v2 流程

1. 使用者在新裝置輸入救援碼。App 僅比對 `recoveryAuthorizationVerifier`，不得嘗試解開 DEK。
2. 驗證後建立具有到期時間與單次使用識別碼的 recovery request；其中不得含 DEK、主密碼、救援碼或未加密資料。
3. 已登入舊裝置顯示核准請求。使用者先以既有解鎖狀態進入，並明確確認新密碼與新裝置。
4. 舊裝置用其已解開的 DEK 建立新的 `masterPasswordWrapper`，更新 key package，並提高 `sessionEpoch` 使其他舊 session 失效。
5. 新裝置以新密碼解開同一把 DEK；舊 vault 不被重新加密，資料得以保留。

### 從現有格式遷移

目前版本的 `recoveryCodeWrapper` 可解開 DEK，與 Recovery v2 不相容。遷移時必須在使用者仍能以主密碼或既有 trusted session 解開 DEK 的情況下，將它替換為只可驗證救援碼的 `recoveryAuthorizationVerifier`，再上傳新的 key package。未完成遷移的舊 key package 必須在 UI 清楚標為「舊式救援碼仍可解密資料」，不可默默宣稱已符合新政策。

## Workers OAuth 與同步 API

`workers/oauth/` 提供 health、Google OAuth callback、一次性 handoff 與受限的 Drive proxy。health endpoint 會以 `SELECT 1` 確認 `OAUTH_DB` 綁定可用；Google refresh token 只以加密 envelope 存於 D1。Worker 只接受 `key-package.enc`、`vault.enc` 與短暫診斷檔，不能存取 Drive 其他檔案，也不會解密 vault、DEK、主密碼或救援碼。

在啟用 OAuth 前，先由 D1 Console 執行 `workers/oauth/schema.sql`；既有資料庫還必須依序補執行 `workers/oauth/migrations/0002-sessions.sql` 與 `workers/oauth/migrations/0003-recovery-requests.sql`。後者只建立短效 recovery request 的路由 metadata（request ID、vault ID、裝置 ID、配對碼、到期與核准狀態）；不存 vault、DEK、主密碼、救援碼、任何 DEK wrapper、access token 明文或 refresh token 明文。執行成功後 health endpoint 會回傳 `schemaReady: true`。

部署前必須由管理者設定：

- `APP_ORIGINS`：允許呼叫 API 的 PWA 與 Capacitor origin 清單。
- `GOOGLE_WEB_CLIENT_ID` 與 `GOOGLE_OAUTH_REDIRECT_URI`：可公開的 Web OAuth 設定。
- `GOOGLE_WEB_CLIENT_SECRET`：僅以 Worker secret 保存。
- `OAUTH_STATE_SIGNING_KEY`：僅以 Worker secret 保存；用於 state／一次性登入授權。
- `TOKEN_ENCRYPTION_KEY`：僅以 Worker secret 保存；用於資料庫中的 refresh token envelope。

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
