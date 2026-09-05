# Android 正式簽章

正式 Android 發行版使用獨立的 release keystore；它不是 Android Studio 的 debug keystore，且不得上傳 Git、雲端同步資料夾或傳訊軟體。

## 一次性建立

在 Windows PowerShell 的專案根目錄，以 JDK 21 執行下列指令。`YOUR-STRONG-PASSWORD` 必須改成你保存於密碼管理器的長密碼，並在兩個密碼位置使用相同密碼。

```powershell
$env:JAVA_HOME = "$env:LOCALAPPDATA\Programs\EclipseAdoptium\jdk-21.0.12.1+1"
New-Item -ItemType Directory -Force android\release
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -v -keystore android\release\wuwangwo-release.jks -alias wuwangwo-release -keyalg RSA -keysize 4096 -validity 10000 -storepass 'YOUR-STRONG-PASSWORD' -keypass 'YOUR-STRONG-PASSWORD' -dname 'CN=Shawn G Hong, OU=Mobile, O=ShawnGHong, L=Taipei, ST=Taiwan, C=TW'
@"
storeFile=release/wuwangwo-release.jks
storePassword=YOUR-STRONG-PASSWORD
keyAlias=wuwangwo-release
keyPassword=YOUR-STRONG-PASSWORD
"@ | Set-Content -NoNewline android\keystore.properties
```

`android/release/` 與 `android/keystore.properties` 已被 Git 忽略。請將 `.jks` 檔與密碼分開備份；遺失 keystore 將無法為同一個 Google Play app ID 發布更新。

## 取得正式 SHA-1／SHA-256

建立完 keystore 後執行：

```powershell
& "$env:JAVA_HOME\bin\keytool.exe" -list -v -keystore android\release\wuwangwo-release.jks -alias wuwangwo-release
```

輸出中的 `SHA1` 與 `SHA256` 要保存。正式 SHA-1 之後用於 Google Cloud Android OAuth client；若採用 Google Play App Signing，還必須把 Play Console 的 **App signing key certificate** 指紋加入 Android App Link 的 `assetlinks.json`。

## 建置

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
& .\android\gradlew.bat -p .\android :app:bundleRelease --no-daemon
```

輸出為 `android\app\build\outputs\bundle\release\app-release.aab`，供 Google Play Console 使用。沒有本機 `keystore.properties` 時，release build 不會使用 debug 簽章。
