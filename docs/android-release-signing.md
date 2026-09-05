# Android 正式簽章

正式 Android 發行版使用獨立的 release keystore；它不是 Android Studio 的 debug keystore，且不得上傳 Git、雲端同步資料夾或傳訊軟體。

## 一次性建立

在 Windows PowerShell 的專案根目錄，以 JDK 21 執行下列指令。keystore 放在使用者的 AppData 私有資料夾，而非專案或雲端同步資料夾；省略密碼參數可讓 `keytool` 以互動提示方式收取密碼，避免把密碼留在 PowerShell 指令歷史中。

```powershell
$env:JAVA_HOME = "$env:LOCALAPPDATA\Programs\EclipseAdoptium\jdk-21.0.12.1+1"
$releaseDir = "$env:LOCALAPPDATA\ShawnGHong\AndroidSigning"
New-Item -ItemType Directory -Force $releaseDir
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -v -keystore "$releaseDir\wuwangwo-release.jks" -alias wuwangwo-release -keyalg RSA -keysize 4096 -validity 10000
```

依互動提示設定 keystore 密碼、姓名、組織與所在地。`keytool` 問到 key password 時，直接按 Enter，讓 key 使用與 keystore 相同的密碼即可。

接著以文字編輯器建立 `android\keystore.properties`，內容如下；兩個 `YOUR-STRONG-PASSWORD` 都填入剛才設定的同一組密碼。此檔案在本機以明文保存密碼，但已被 Git 忽略，絕不能上傳或同步。

```properties
storeFile=C:/Users/jp619/AppData/Local/ShawnGHong/AndroidSigning/wuwangwo-release.jks
storePassword=YOUR-STRONG-PASSWORD
keyAlias=wuwangwo-release
keyPassword=YOUR-STRONG-PASSWORD
```

`android/keystore.properties` 已被 Git 忽略。請把 `.jks` 檔與密碼分開備份，例如將 `.jks` 存至受密碼保護的加密保管庫、密碼存入密碼管理器；遺失 keystore 將無法為同一個 Google Play app ID 發布更新。

## 取得正式 SHA-1／SHA-256

建立完 keystore 後執行：

```powershell
& "$env:JAVA_HOME\bin\keytool.exe" -list -v -keystore "$env:LOCALAPPDATA\ShawnGHong\AndroidSigning\wuwangwo-release.jks" -alias wuwangwo-release
```

輸出中的 `SHA1` 與 `SHA256` 要保存。正式 SHA-1 之後用於 Google Cloud Android OAuth client；若採用 Google Play App Signing，還必須把 Play Console 的 **App signing key certificate** 指紋加入 Android App Link 的 `assetlinks.json`。

## 建置

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
& .\android\gradlew.bat -p .\android :app:bundleRelease --no-daemon
```

輸出為 `android\app\build\outputs\bundle\release\app-release.aab`，供 Google Play Console 使用。沒有本機 `keystore.properties` 時，release build 不會使用 debug 簽章。
