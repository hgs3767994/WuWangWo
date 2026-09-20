# Google Play 上架準備

最後更新：2026-09-19
執行基準：Android `1.0.0`／PWA cache v176／套件名稱 `io.github.hgs3767994.wuwangwo`

## 文件用途

本文件是「莫忘」Android App 上架 Google Play 的工程主線。後續應依下列順序執行、驗證並更新勾選狀態；除非發現政策、資安或產品需求衝突，不任意跳過必要階段。

每一階段只有在程式修改、測試、必要部署與文件更新都完成後，才可標記完成。需要開發者本人處理的身分驗證、付款、政策聲明或 Play Console 決策，應停下來提供明確操作步驟。

## 已完成基線

- [x] Android application ID 固定為 `io.github.hgs3767994.wuwangwo`。
- [x] `minSdk 24`、`compileSdk 36`、`targetSdk 36`。
- [x] 正式 release keystore 已由開發者自行保管。
- [x] 本機 release SHA-1／SHA-256 已取得並登錄於目前 Android OAuth client。
- [x] 正式 PWA：`https://wuwangwo.shawnghong.com`。
- [x] 正式 Worker：`https://wuwangwo-api.shawnghong.com`。
- [x] Google OAuth callback、原生 Google OAuth、Worker session 與靜默同步已可運作。
- [x] Android Keystore、生物辨識、兩分鐘前景／背景鎖定、離線資料操作已實作。
- [x] Android Auto Backup 已關閉。
- [x] v170 已完成 Android 實機功能測試，使用者回報功能正常。
- [x] 隱私權政策與服務條款已有初版公開頁面。

## 上架品牌圖示前置工程

- [x] 確認 `assets/icon-512.png` 為 Android 與 Google Play 最終圖示設計。
- [x] 以原圖為唯一母圖，未使用生成式重畫或改變文字、花朵構圖。
- [x] 產生 Android mdpi／hdpi／xhdpi／xxhdpi／xxxhdpi launcher icon。
- [x] 產生 Android 圓形 launcher icon。
- [x] 產生具安全留白的 Android adaptive icon foreground，背景固定為 `#FAFAFA`。
- [x] 產生 Google Play 專用 512 × 512、32-bit RGBA PNG。
- [x] 從正式 Worker 設定重新產生 Web bundle、執行 Capacitor sync 並成功建置 release APK。
- [x] 驗證 release APK 簽章仍為正式 release certificate，並從 APK 反向取出 launcher icon 核對內容。
- [x] 在 Android 實機確認桌面、圓形遮罩、最近使用程式及系統 App 資訊頁的圖示顯示。

產出：

- Android 圖示產生器：`scripts/generate-android-icons.ps1`
- Google Play 圖示：`store-assets/google-play/icon-512.png`
- v172 release APK：`android/app/build/outputs/apk/release/app-release.apk`

## 第一階段：帳號與資料刪除

目標：滿足 Google Play 帳號刪除與使用者資料政策，讓 Google 帳號連結所建立的 Worker 後端記錄可由使用者真正刪除。

- [x] 定義刪除範圍與確認畫面：
  - 刪除 Cloudflare D1 的 OAuth account。
  - 撤銷及刪除所有 Worker sessions。
  - 刪除 handoff、recovery request 等帳號關聯資料。
  - 撤銷 Google OAuth token。
  - 讓使用者明確選擇是否一併刪除 Google Drive `appDataFolder` 內的莫忘加密檔案。
  - 本機資料是否保留或刪除必須清楚分流，不可由模糊文字隱含決定。
- [x] Worker 新增重新驗證後才能執行的帳號／資料刪除 API。
- [x] D1 刪除流程具備交易或可驗證的一致性，並避免殘留有效 session。
- [x] App 設定頁加入清楚且不易誤觸的「刪除雲端帳號與資料」入口。
- [x] 建立公開、無須登入即可閱讀的資料刪除說明／申請頁面。
- [x] 補齊 Worker 單元測試、PWA 測試及 Android 實機測試。

驗收條件：刪除後舊 Worker session 無法使用、D1 無帳號關聯資料、Google 授權已撤銷；使用者選擇刪除 Drive 資料時，加密同步檔亦不存在。

### 第一階段執行紀錄（2026-09-18）

本次開發候選快取版本：`forget-me-not-v171`。v170 原始基線與使用者提供的 APK、`assets/icon.svg` 及其他素材均保留。

- [x] 刪除契約已落實為四個彼此清楚的範圍：Worker 帳號關聯資料與 Google OAuth 授權一定刪除；Drive 加密同步檔與本機資料各自獨立選擇，預設均保留。
- [x] App 內要求輸入 `DELETE`、再次顯示完整範圍，並重新選擇 Google 帳號；若所選帳號與目前同步 Email 不同則中止。
- [x] Worker 原始碼已加入 `POST /v1/account/delete`，只接受五分鐘內由 Google OAuth 新建立的 session。
- [x] D1 原始碼使用單一 `database.batch()` 依序刪除 `recovery_requests`、`oauth_handoffs`、`oauth_sessions`、`oauth_accounts`；批次失敗不回報完成。
- [x] 可選刪除 Google Drive `vault.enc`、`key-package.enc`，之後撤銷 Google refresh token／access token，再清除 D1 帳號資料。
- [x] App 設定頁已加入「刪除雲端帳號與資料」，保留本機資料時轉成本機模式；選擇刪除本機資料時清除 IndexedDB 與原生 trusted session。
- [x] 已建立公開自助頁 `data-deletion.html`，無須登入即可閱讀，並可由網頁直接重新驗證後提出刪除，不要求重新安裝 App。
- [x] `npm run check`、`npm test`、`npm run check:worker`、`npm run test:worker`（33 項）均通過。
- [x] `npm run build:pages` 與使用正式 Worker／OAuth 設定的 `npm run build:web` 均通過；兩個輸出均包含公開刪除頁。
- [x] 已由新產生的 `www` 執行 Capacitor Android sync，並完成 `assembleDebug --offline`（`BUILD SUCCESSFUL`）。
- [x] 最新 debug APK：`android/app/build/outputs/apk/debug/app-debug.apk`；SHA-256 `0EFEF1CE3C050E414DB9FECE1F2CA19137E0A562AC636C4D8FA20F5323DB8D52`。
- [x] `assets/icon.svg` 工作樹 Git blob 與 `HEAD` 均為 `33a666d3ab71bc67608e339790eeaf85146edba6`，確認未被覆寫。
- [x] 正式 Worker 已部署，版本 ID `68c5d212-c619-415e-a46f-c2c9ad921ea6`；`/health` 回報 OAuth、D1 schema 與 recovery storage 均 ready，未帶 session 的刪除請求回覆 `401`。
- [x] GitHub 提交 `fd0dead` 已推送至 `main`；Pages workflow run `35297588180` 成功完成。
- [x] 正式 `data-deletion.html` 回覆 HTTP 200 且包含自助刪除操作；正式 `service-worker.js` 為 v171，正式 `src/app.js` 包含 App 內刪除入口。
- [x] Android 實機已完成兩輪端到端驗收：第一輪保留 Drive／本機資料，第二輪刪除 Drive／本機資料。
- [x] 刪除後已逐項查核 D1、Google 授權、Drive 加密檔與本機資料；詳見下方 2026-09-19 實機驗收紀錄。

### 第一階段實機驗收與 v172 修正（2026-09-19）

- [x] 第一輪刪除前 D1 為 `oauth_accounts=1`、`oauth_sessions=2`、`oauth_handoffs=1`、`recovery_requests=0`；選擇保留 Drive 與本機資料後四表均為 0。
- [x] 第一輪完成後本機仍保留 27 位人物；重新連結相同 Google 帳號時顯示「偵測到雲端資料」，成功解密與合併後仍為 27 位，證明 `vault.enc` 與 `key-package.enc` 均被保留且可用。
- [x] 實機發現 v171 原生刪除流程只繞過莫忘自己的 Worker session；Google Play services 若已有授權會靜默回傳 server auth code，未顯示畫面所承諾的帳號選擇器。
- [x] v172 在原生 `forceReauthorization` 路徑傳入 `selectAccount`，Android `AuthorizationRequest` 設為 `Prompt.SELECT_ACCOUNT`；正常同步路徑維持原有靜默重用行為。
- [x] v172 實機驗證顯示 Google Play services「選擇帳戶」畫面，列出裝置上的兩個 Google 帳號；取消後 App 顯示未刪除任何資料，D1 仍維持 `oauth_accounts=1`、`oauth_sessions=1`。
- [x] 第二輪勾選刪除 Drive 與本機資料並重新選擇正確 Google 帳號；App 回報雲端帳號與選取資料已永久刪除，本機資料也已清除。
- [x] 第二輪完成後 D1 四個帳號關聯表均為 0，App 重新載入後回到只有「開始使用」的初始頁。
- [x] Worker 只有在依序成功刪除 Drive `vault.enc`、`key-package.enc`、撤銷 Google token 並以 D1 batch 清除帳號關聯資料後才回傳成功；任一步失敗均不會進入 App 的完成分支。
- [x] `npm run check`、`npm test`、`npm run check:worker`、`npm run test:worker`（33 項）、正式設定 `npm run build:web`、Capacitor sync 與 `assembleRelease` 均通過。
- [x] v172 release APK：`android/app/build/outputs/apk/release/app-release.apk`；SHA-256 `699425ED17968DDE2A85E2D7E98CA1BF0FB25F7FEA22DE88CCEE355F97FA6BF9`；簽章 SHA-256 與手機原安裝版本相同。

### v173 主動連結帳號選擇修正（2026-09-19）

- [x] 實機確認 v172 的「連結 Google Drive」未要求帳戶選擇，Google Play services 直接沿用上次使用的帳號並顯示授權同意畫面。
- [x] 將使用者主動點擊「連結 Google Drive」與刪除前重新驗證拆成獨立意圖；兩者都要求 Android 顯示帳戶選擇器，但一般連結不套用刪除專用重新驗證語意。
- [x] 背景同步、App 啟動時的 Worker session 恢復與既有連線重用維持靜默，不會在一般同步時反覆要求選擇帳號。
- [x] 新增靜態檢查，防止主動連結流程遺失 `selectAccount: true`，並將快取版本升為 v173。
- [x] v173 已覆蓋安裝到 Android 實機；主動點擊「連結 Google Drive」後出現 Google Play services「選擇帳戶」畫面，列出裝置上的兩個帳號與「新增其他帳戶」。
- [x] v173 release APK SHA-256：`A51D74EE9F15EC533EA8AEB5E5BC4B66E7D42E3AFB5E5209E00A9509A5593D86`；簽章 SHA-256 仍為 `6d4d32dbc1491f0de8f41569a92a9b6ee1b3cf680635ad8cbc875a6903f2596e`。

### v174 跨端刪除後重新授權防護（2026-09-19）

- [x] 重現原生 App 刪除成功後，PWA 因保留本機資料與舊連線顯示，可由「立即同步」重新完成 OAuth 並重建雲端資料。
- [x] 新增 Worker `/v1/oauth/session/status`，App/PWA 啟動時只向 D1 驗證短效 session，不接觸 Google token 或 Drive 資料。
- [x] session 已由其他裝置刪除或失效時，PWA 立即轉為未連結並保留本機資料，不再讓「立即同步」啟動 OAuth。
- [x] 只有使用者明確點擊「重新連結 Google Drive」才可重新授權；PWA 與原生 App 都會顯示 Google 帳戶選擇器。
- [x] Worker 測試增加至 36 項，涵蓋明確重新連結的 `select_account`、有效 session status 與遭帳號刪除的 session status。
- [x] 正式 Worker 已部署版本 `e27063c6-76fc-4ec1-834e-703edbcd1f17`；health 顯示 OAuth／D1 ready，未帶 session 的 status 請求回覆 `401 session-required`。
- [x] Worker 與 v174 PWA 部署後再次由原生 App 刪除帳號、Drive 與原生本機資料；刪除完成時 D1 四表全為 0。
- [x] 重新開啟 v174 PWA 後顯示「尚未啟用」與「重新連結 Google Drive」，保留 PWA 本機資料但不提供「立即同步」；再次查核 D1 四表仍全為 0，確認未自動重建帳號。
- [x] v174 release APK SHA-256：`0CB0CAF2F506F287F1A56F4D4A70220FDAB032BF0B23F99290333180A64D46E1`；正式 release certificate SHA-256 維持不變。

### v177 Worker session 自動續期修正（2026-09-20）

- [x] 重現 PWA 與原生 App 重新連結約一小時後同時顯示「Google Drive 連線已失效」；根因為 60 分鐘 Worker session 到期被誤當成 Google 授權失效。
- [x] 裝置 session 改為最長 30 天，App 正常啟動時由 Worker 產生替代憑證並原子撤銷舊憑證；PWA 替代憑證只寫入 HttpOnly Cookie，原生 App 替代憑證保存於安全儲存。
- [x] session 輪替保留原始 Google 授權時間，不會繞過永久刪除帳號前五分鐘內必須重新驗證的安全限制；帳號刪除仍會清除所有裝置 sessions。
- [x] 靜態檢查、8 項核心 smoke tests與 39 項 Worker tests 全部通過；正式 Worker 已部署版本 `4d3a86c0-63ac-45c9-83af-dbb7d6b11667`。
- [x] v177 release APK SHA-256：`3951807318086BF5569D00FC6B17FB1AB7913110234C09391AFFD767663D43C0`；v177 release AAB SHA-256：`2756727C977F13CDD215E18984ED3EA078316F1C78331BBD6D84BE6A2712B7C9`。

## 第二階段：正式隱私政策與服務條款

- [x] 更新 `privacy.html`：
  - 同時適用 PWA 與 Android App。
  - 明列開發者名稱及可直接聯絡的隱私信箱。
  - 完整描述 Google 帳號識別碼、Email、加密 refresh token、Worker session 與加密同步檔的處理方式。
  - 說明 Google Drive、Cloudflare Worker／D1 的角色。
  - 加入資料保留期限與永久刪除政策。
  - 加入 App 內及網頁版帳號／資料刪除方式。
  - 內容必須與 Play Console Data safety 回答完全一致。
- [x] 更新 `terms.html`：
  - 移除「個人開發中的 PWA」等不適用正式上架的文字。
  - 同時涵蓋 PWA 與 Android App。
  - 說明同步、加密、備份、救援碼、服務中斷與使用者責任。
- [x] 確認 App 內可直接開啟隱私政策、服務條款及資料刪除頁。
- [x] 部署至正式網域並驗證公開 URL、HTTPS、手機版面與無登入可存取性。

### 第二階段部署與 v175 建置紀錄（2026-09-19）

- [x] 帳號永久刪除改為一律刪除 Google Drive appDataFolder 中的 `vault.enc` 與 `key-package.enc`；舊版若要求保留 Drive，Worker 會拒絕且不刪除任何資料。
- [x] 正式 Worker 已部署版本 `a6e05899-af56-4724-b8f3-edac0a53ba7e`，health 回報 OAuth、D1 schema 與 recovery storage 均 ready。
- [x] GitHub 提交 `467b4dc` 已推送至 `main`；Pages workflow run `35443120133` 成功完成。
- [x] 正式 `privacy.html`、`terms.html`、`data-deletion.html` 與 `service-worker.js` 均以 HTTPS 回覆 HTTP 200；政策頁含手機 viewport，Service Worker 為 v175。
- [x] 從正式設定重新產生原生 `www`、執行 Android Capacitor sync 並成功建置 v175 release APK；包內確認使用 `https://wuwangwo-api.shawnghong.com`、正式 OAuth Web client 且不含 mock Drive runtime 設定。
- [x] v175 release APK：`莫忘-v175-native-release.apk`；SHA-256 `3B6B056E6785B8F7BB5A7AC5C8AC6CC4AF1ADBE44BB6F082411F693F77F3F8C6`；正式 release certificate SHA-256 `6D4D32DBC1491F0DE8F41569A92A9B6EE1B3CF680635AD8CBC875A6903F2596E`。
- [x] Android 實機確認版本 `0.1.0`、快取版本 `forget-me-not-v175`，隱私政策與服務條款可開啟並顯示正式開發者名稱及聯絡信箱；返回 App 後依安全設計重新解鎖。
- [x] 以單一測試人物連結 Google Drive，帳號選擇器正常、未偵測到既有雲端資料且同步成功；取消刪除重新驗證後沒有刪除資料，再次同步正常。
- [x] 未勾選清除本機資料時，刪除流程永久刪除雲端帳號與 Drive 加密同步檔並保留本機測試人物；重新連結同一帳號時未偵測到舊雲端資料，確認舊同步檔已刪除。
- [x] 勾選清除本機資料後再次完成永久刪除，App 顯示雲端帳號與選取資料已刪除、本機資料已清除，並正確返回首次設定狀態。

## 第三階段：正式版本與 AAB

- [x] 決定首版公開 `versionName` 為 `1.0.0`。
- [x] 首次上架使用 `versionCode 1`；後續每次上傳 Google Play 的新版本，必須先將 `versionCode` 遞增且不得重複使用。
- [x] 從最新原始碼與最新 `www` 重新建置，不沿用舊 APK 或舊 bundle。
- [x] 確認原生 bundle 使用正式 `GOOGLE_OAUTH_API_URL=https://wuwangwo-api.shawnghong.com`，啟動 runtime 為 Google Drive 而非 mock Drive。
- [x] 執行完整程式檢查、PWA 測試、Worker 測試、Web build 與 Capacitor sync。
- [x] 使用正式 upload keystore 產生簽章 `app-release.aab`。
- [x] 驗證 AAB 簽章、套件名稱、版本、正式網址與包內資源。
- [x] 保留對應版本的建置紀錄與 SHA-256 檔案雜湊。

### 第三階段 1.0.0 AAB 建置紀錄（2026-09-19）

- [x] `package.json`、App 顯示版本與 Android `versionName` 統一為 `1.0.0`；Android `versionCode` 為 `1`，PWA cache 升至 v176。
- [x] `npm run check`、8 項 PWA smoke tests、36 項 Worker tests、正式設定 Web build、Android Capacitor sync 與 `bundleRelease` 全部通過。
- [x] AAB 合併後 manifest：套件 `io.github.hgs3767994.wuwangwo`、`versionName 1.0.0`、`versionCode 1`。
- [x] AAB 包內確認 `appVersion 1.0.0`、cache v176、正式 Worker `https://wuwangwo-api.shawnghong.com` 與正式 OAuth Web client。
- [x] AAB 已由正式 upload certificate 簽署；certificate SHA-256 `6D4D32DBC1491F0DE8F41569A92A9B6EE1B3CF680635AD8CBC875A6903F2596E`。
- [x] 正式 AAB：`莫忘-v1.0.0-release.aab`；SHA-256 `5769CF445F48290DB475BEB4B9EBB26C8BD0B3B834D469D76B0883D12F60BFA1`。

## 第四階段：Play Console 帳戶與 App 建立

此階段含需開發者本人完成的動作。

- [ ] 建立或確認 Google Play Console 開發者帳戶。
- [ ] 選擇正確帳戶類型：個人或組織。
- [ ] 完成法律姓名、地址、聯絡 Email、電話、付款資料與身分驗證。
- [ ] 若為組織帳戶，準備並驗證 D-U-N-S 資料。
- [ ] 啟用兩步驟驗證。
- [ ] 在 Play Console 建立「莫忘」App。
- [ ] 確認永久套件名稱為 `io.github.hgs3767994.wuwangwo`。
- [ ] 決定免費／付費、發行國家與地區、預設語言及公開開發者名稱。

## 第五階段：Play App Signing 與 Google OAuth

- [ ] 上傳簽章 AAB 至 Internal testing，啟用 Play App Signing。
- [ ] 保存 Play Console 提供的 App signing certificates。
- [ ] 複製 Play App Signing 的 SHA-1／SHA-256；若 Console 提供多組傳統／混合簽章憑證，全部依官方要求登錄。
- [ ] 在 Google Cloud 為 `io.github.hgs3767994.wuwangwo` 登錄 Play 簽章 SHA。
- [ ] 保留現有本機 release／upload SHA，確保側載測試版仍可使用 OAuth。
- [ ] 由 Google Play 測試軌安裝 App，驗證 Google 帳號連結、Drive 同步與靜默 session。
- [ ] 確認 Google OAuth Audience 為 External、Publishing status 為 In production。
- [ ] 確認正式 Branding 已發布，首頁、隱私政策、服務條款及授權網域皆使用已驗證的 `shawnghong.com`。
- [ ] 確認只要求必要 scope；`drive.appdata` 維持非敏感最小權限。

驗收條件：由 Play 商店安裝的版本可正常完成原生 Google OAuth 與同步，不只側載 APK 正常。

## 第六階段：Google Play 商店資料與政策表格

### 商店資訊與素材

- [ ] App 名稱（最多 30 字元）。
- [ ] 短描述（最多 80 字元）。
- [ ] 完整描述（最多 4,000 字元）。
- [ ] 分類與標籤；初步方向為「生產力工具」。
- [ ] 必填支援 Email、網站及必要聯絡資訊。
- [ ] 512 × 512 PNG 商店圖示。
- [ ] 1024 × 500 JPG 或無透明背景 PNG feature graphic。
- [ ] 最新版本手機截圖。
- [ ] 建議提供 7 吋／10 吋平板截圖及相應大螢幕品質驗證。
- [ ] 所有文案與圖片均不得誤導、宣稱未驗證功能或洩露真實人物資料。

### App content 與政策聲明

- [ ] Privacy policy URL。
- [ ] Data deletion URL。
- [ ] Data safety：如實申報 Google 帳號識別資訊、Email、加密 token、加密同步資料、資料用途、是否必要、是否分享及是否可刪除。
- [ ] Ads：若正式版本仍無廣告及廣告 SDK，申報「不含廣告」。
- [ ] App access：提供審查人員完整操作說明；說明可自行建立本機密碼，Google Drive 為選用同步功能。
- [ ] Target audience：依真實產品定位選擇；若不以兒童為目標，不選兒童年齡層。
- [ ] 完成 Content rating 問卷。
- [ ] 完成 News、Government、Health、Financial、權限及其他 Console 顯示的適用聲明。
- [ ] 確認政策回答、App 行為、商店文案與隱私政策互相一致。

## 第七階段：Google Play 測試

- [ ] Internal testing：由 Play 安裝而非只側載 APK。
- [ ] 執行並檢查 Pre-launch report。
- [ ] 修正 crash、ANR、無障礙、相容性、安全性與版面問題。
- [ ] 驗證乾淨安裝與首次設定。
- [ ] 驗證舊版本升級後資料、Keystore trusted session 與設定保留。
- [ ] 驗證 Google OAuth、首次同步、靜默同步、登出及重新連結。
- [ ] 驗證前景／背景兩分鐘鎖定、關閉重開、生物辨識。
- [ ] 驗證離線啟動、新增、編輯、刪除、匯入與匯出。
- [ ] 驗證更改密碼、救援碼、舊裝置核准、登出所有裝置及 session epoch 失效。
- [ ] 驗證 Worker session 過期、撤銷、網路中斷與 Google Drive 錯誤處理。
- [ ] 至少涵蓋多個 Android 版本、手機尺寸及平板尺寸。
- [ ] 建立可重複執行的正式上架驗收紀錄。

若開發者帳戶是 2023-11-13 後建立的個人帳戶：

- [ ] 建立 Closed testing 測試名單。
- [ ] 至少 12 名測試者連續加入測試 14 天。
- [ ] 收集並記錄測試回饋與實際修正。
- [ ] 完成 Production access 申請問卷。

## 第八階段：正式發布

- [ ] 所有 Play Console dashboard 必要項目均顯示完成。
- [ ] 建立 Production release 與清楚的 release notes。
- [ ] 使用 Managed publishing 或確認審查通過後發布時機。
- [ ] 建議先以 staged rollout 小比例發布。
- [ ] 監控 Android vitals、Crash、ANR、OAuth／Worker Logs 與使用者回報。
- [ ] 無重大問題後逐步擴大至 100%。
- [ ] 保存正式 AAB、版本資訊、Git commit、建置雜湊與 Play release 記錄。

## 每次發行的固定規則

1. 先確認工作區中的使用者檔案與未提交變更，不覆蓋 `assets/icon.svg` 或其他使用者素材。
2. 更新版本號及快取版本。
3. 執行 PWA、Worker、Android 自動檢查。
4. 從最新正式設定重新產生 Web bundle、Capacitor 專案與 AAB。
5. 先進測試軌，再進 Production；不以未經 Play 簽章驗證的側載 APK 取代 Play 測試。
6. 任何資料處理變更都同步檢查隱私政策、Data safety 與帳號刪除流程。

## 官方參考資料

- Target API：https://support.google.com/googleplay/android-developer/answer/11926878
- Android App Bundle：https://support.google.com/googleplay/android-developer/answer/9844679
- Play App Signing：https://support.google.com/googleplay/android-developer/answer/9842756
- 帳號刪除：https://support.google.com/googleplay/android-developer/answer/13327111
- User data：https://support.google.com/googleplay/android-developer/answer/10144311
- 新個人帳戶測試要求：https://support.google.com/googleplay/android-developer/answer/14151465
- 商店素材：https://support.google.com/googleplay/android-developer/answer/9866151
- Google Drive scopes：https://developers.google.com/workspace/drive/api/guides/api-specific-auth
