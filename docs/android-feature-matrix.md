# Android 實機功能矩陣與測試清單

此文件只適用於 App ID `io.github.hgs3767994.wuwangwo` 的 Capacitor Android 版。每次測試前先確認使用的是本機剛建置的 debug APK；不要把尚未完成的原生 OAuth 結果當成 Google Drive 功能失敗。

## 現階段功能矩陣

| 範圍 | 現況 | 實機驗證方式 | 備註 |
| --- | --- | --- | --- |
| 離線啟動 | 可測試 | 關閉 Wi-Fi／行動網路後啟動 App | 不應依賴 PWA service worker；使用固定 Web bundle。 |
| 本機資料檢視與編輯 | 可測試 | 建立或編輯人物，離開再開啟確認仍存在 | 不使用 Google Drive。 |
| JSON 匯出／匯入 | 可測試 | 匯出、確認檔案存在，再匯入測試資料 | 匯入前先保留自己的備份。 |
| Excel 匯出 | 可測試 | 匯出後以 Android 檔案管理員或 Excel 開啟 | 不修改本機資料。 |
| 忘記密碼／Recovery v2 | 程式可用，完整 Drive 情境待測 | 僅用測試 vault 驗證 | 不要對唯一正式資料做測試。 |
| Android 返回鍵 | 可測試 | 子頁返回上一層；首頁按返回鍵結束 App | 原生 handler 已接管，不應回到舊 OAuth 頁。 |
| 背景鎖定 | 程式已完成，待真實 Drive session | 有 trusted session 後，切到背景再回來 | 回到前景應要求裝置驗證。 |
| 重開／生物辨識或螢幕鎖解鎖 | 程式已完成，待真實 Drive session | 強制關閉後重新開啟 | Android Keystore session 不會把 DEK 放到 IndexedDB。 |
| 登出所有裝置／session epoch | 程式已完成，待真實 Drive session | 使用兩台測試裝置 | 舊 session 必須失效。 |
| Google Drive 連結與同步 | 原生 OAuth + PKCE 骨架完成，尚不可端到端測試 | 等待自有網域、App Link、Google Cloud 設定與 Worker 部署 | 未設定時顯示明確提示，不會退回 WebView popup。 |
| 更新後資料保留 | 可測試 | 建立測試人物，再以 `adb install -r` 安裝新版 APK | 不可先解除安裝；解除安裝會移除 App 私有資料。 |

## 每次 debug APK 的可重複流程

1. 連接手機，開啟 USB 偵錯；在 PowerShell 執行 `adb devices`，狀態必須是 `device`。
2. 在專案根目錄設定 `GOOGLE_OAUTH_API_URL` 為 Worker URL，執行 `npm run cap:sync`。
3. 以 JDK 21 建置：`./android/gradlew.bat -p ./android :app:assembleDebug --no-daemon`。
4. 安裝但保留資料：`adb install -r ./android/app/build/outputs/apk/debug/app-debug.apk`。
5. 核對安全旗標：`adb shell dumpsys package io.github.hgs3767994.wuwangwo`；輸出應顯示 `allowBackup=false`。
6. 逐項執行上表中狀態為「可測試」的項目；記錄裝置型號、Android 版本、APK 安裝時間與結果。
7. 若發現 crash，先擷取 `adb logcat -d -t 500`，再重新啟動 App；不要解除安裝或清除資料，以免破壞重現條件。

## 安全性固定規則

- `android:allowBackup="false"` 禁止雲端／ADB 備份；Android 12 以上另以 `data_extraction_rules.xml` 排除 cloud backup 與 device-to-device transfer。
- 不因測試方便而開啟 Auto Backup、把 keystore、密碼、DEK、recovery code 或 OAuth secret 寫入 Git。
- 測試匯入、忘記密碼、清除或登出所有裝置前，先匯出一份 JSON 備份並保管在測試範圍外。
