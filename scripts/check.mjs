import { access, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const requiredFiles = [
  "README.md",
  "index.html",
  "privacy.html",
  "terms.html",
  "data-deletion.html",
  "oauth-return.html",
  "manifest.webmanifest",
  "package.json",
  "service-worker.js",
  ".github/workflows/deploy-pages.yml",
  "scripts/build-pages.mjs",
  "scripts/build-web.mjs",
  "scripts/generate-android-icons.ps1",
  "capacitor.config.json",
  "scripts/check.mjs",
  "scripts/dev-server.mjs",
  "scripts/smoke-test.mjs",
  "src/app.js",
  "src/account-deletion.js",
  "src/config.js",
  "src/crypto.js",
  "src/native-file-export.js",
  "src/native-trusted-session.js",
  "src/native-oauth.js",
  "src/oauth-return.js",
  "src/db.js",
  "src/drive.js",
  "src/drive-google.js",
  "src/drive-mock.js",
  "src/model.js",
  "src/runtime-config.js",
  "src/sync.js",
  "src/xlsx.js",
  "src/styles.css",
  "android/app/src/main/res/xml/backup_rules.xml",
  "android/app/src/main/res/xml/data_extraction_rules.xml",
  "store-assets/google-play/icon-512.png",
  "android/app/src/main/java/io/github/hgs3767994/wuwangwo/NativeFileExportPlugin.java",
  "android/app/src/main/java/io/github/hgs3767994/wuwangwo/OAuthSessionPlugin.java",
  "android/app/src/main/java/io/github/hgs3767994/wuwangwo/GoogleDriveAuthorizationPlugin.java",
  "android/app/src/main/java/io/github/hgs3767994/wuwangwo/GoogleDriveAuthorizationActivity.java"
];
const appShellRequiredFiles = requiredFiles.filter((file) => ![
  "README.md",
  "package.json",
  "service-worker.js",
  ".github/workflows/deploy-pages.yml",
  "scripts/build-pages.mjs",
  "scripts/build-web.mjs",
  "scripts/generate-android-icons.ps1",
  "capacitor.config.json",
  "scripts/check.mjs",
  "scripts/dev-server.mjs",
  "scripts/smoke-test.mjs",
  "android/app/src/main/res/xml/backup_rules.xml",
  "android/app/src/main/res/xml/data_extraction_rules.xml",
  "store-assets/google-play/icon-512.png",
  "android/app/src/main/java/io/github/hgs3767994/wuwangwo/NativeFileExportPlugin.java",
  "android/app/src/main/java/io/github/hgs3767994/wuwangwo/OAuthSessionPlugin.java",
  "android/app/src/main/java/io/github/hgs3767994/wuwangwo/GoogleDriveAuthorizationPlugin.java",
  "android/app/src/main/java/io/github/hgs3767994/wuwangwo/GoogleDriveAuthorizationActivity.java"
].includes(file));

const checks = [];

await check("required files exist and are readable", () => Promise.all(requiredFiles.map((file) => readFile(file, "utf8"))));

const manifest = await check("manifest JSON is valid", async () => JSON.parse(await readFile("manifest.webmanifest", "utf8")));
const capacitorConfig = await check("Capacitor config JSON is valid", async () => JSON.parse(await readFile("capacitor.config.json", "utf8")));
const packageConfig = await check("package JSON is valid", async () => JSON.parse(await readFile("package.json", "utf8")));

const configSource = await readFile("src/config.js", "utf8");
const serviceWorkerSource = await readFile("service-worker.js", "utf8");
const indexSource = await readFile("index.html", "utf8");
const workflowSource = await readFile(".github/workflows/deploy-pages.yml", "utf8");
const buildPagesSource = await readFile("scripts/build-pages.mjs", "utf8");
const androidManifestSource = await readFile("android/app/src/main/AndroidManifest.xml", "utf8");
const androidBuildSource = await readFile("android/app/build.gradle", "utf8");
const configCacheName = configSource.match(/cacheName:\s*"([^"]+)"/)?.[1];
const serviceWorkerCacheName = serviceWorkerSource.match(/CACHE_NAME\s*=\s*"([^"]+)"/)?.[1];
const appVersion = configSource.match(/appVersion:\s*"([^"]+)"/)?.[1];
const androidVersionName = androidBuildSource.match(/versionName\s+"([^"]+)"/)?.[1];
const androidVersionCode = Number(androidBuildSource.match(/versionCode\s+(\d+)/)?.[1]);

await check("config cacheName matches service worker CACHE_NAME", () => {
  if (!configCacheName || !serviceWorkerCacheName || configCacheName !== serviceWorkerCacheName) {
    throw new Error("Config cacheName and service-worker CACHE_NAME must match.");
  }
});

await check("manifest has required PWA fields", () => {
  ["name", "short_name", "start_url", "display", "icons"].forEach((field) => {
    if (!manifest[field]) throw new Error(`manifest.webmanifest is missing ${field}.`);
  });
  if (!Array.isArray(manifest.icons) || !manifest.icons.length) throw new Error("manifest.webmanifest must include at least one icon.");
});

await check("Capacitor uses the fixed application ID and web bundle", () => {
  if (capacitorConfig.appId !== "io.github.hgs3767994.wuwangwo") throw new Error("Capacitor appId must remain io.github.hgs3767994.wuwangwo.");
  if (capacitorConfig.appName !== "莫忘") throw new Error("Capacitor appName must remain 莫忘.");
  if (capacitorConfig.webDir !== "www") throw new Error("Capacitor webDir must remain www.");
});

await check("manifest uses GitHub Pages friendly relative start_url", () => {
  if (manifest.start_url !== "./") throw new Error('manifest.webmanifest start_url must be "./" for project pages.');
});

await check("manifest icon files exist", async () => {
  await Promise.all(
    manifest.icons.map((icon) => {
      if (!icon.src) throw new Error("manifest icon is missing src.");
      return access(stripRelativePrefix(icon.src));
    })
  );
});

await check("runtime config loads before app module", () => {
  const runtimeConfigIndex = indexSource.indexOf("./src/runtime-config.js");
  const appModuleIndex = indexSource.indexOf("./src/app.js");
  if (runtimeConfigIndex < 0) throw new Error("index.html must load src/runtime-config.js.");
  if (appModuleIndex < 0) throw new Error("index.html must load src/app.js.");
  if (runtimeConfigIndex > appModuleIndex) throw new Error("runtime-config.js must load before app.js.");
});

await check("native runtime bypasses the PWA service worker", async () => {
  const appSource = await readFile("src/app.js", "utf8");
  if (!appSource.includes("Capacitor?.isNativePlatform?.()")) throw new Error("Native runtime must bypass PWA service worker registration.");
});

await check("app messages use the themed Traditional Chinese dialog", async () => {
  const appSource = await readFile("src/app.js", "utf8");
  ["function alert(message)", "function confirmDialog(message", "message-dialog-card", "closeActiveMessageDialog", "historyLeaveGuard", "restoreHistorySteps"].forEach((text) => {
    if (!appSource.includes(text)) throw new Error(`src/app.js is missing themed message dialog support: ${text}`);
  });
  if (/\bconfirm\(/.test(appSource)) throw new Error("src/app.js must not use browser-native confirm dialogs.");
});

await check("unlock page renders before an encrypted local vault is loaded", async () => {
  const appSource = await readFile("src/app.js", "utf8");
  const viewStart = appSource.indexOf("function view() {");
  const viewEnd = appSource.indexOf("function welcomeView()", viewStart);
  const viewSource = appSource.slice(viewStart, viewEnd);
  const unlockIndex = viewSource.indexOf('if (state.route.name === "unlock")');
  const vaultIndex = viewSource.indexOf("if (!state.vault)");
  if (unlockIndex < 0 || vaultIndex < 0 || unlockIndex > vaultIndex) {
    throw new Error("The unlock route must render before the missing-vault loading state.");
  }
});

await check("password changes force one password-only unlock across devices", async () => {
  const appSource = await readFile("src/app.js", "utf8");
  [
    "passwordRequiredEpoch",
    "passwordChangeId",
    "checkForRemoteSecurityChange",
    "lockForRemoteSecurityChange",
    'allowBiometric: false',
    'await writeDriveFile(driveFileName("keyPackage"), updatedKeyPackage)',
    'await readDriveFile(driveFileName("keyPackage"))'
  ].forEach((text) => {
    if (!appSource.includes(text)) throw new Error(`src/app.js is missing password-change invalidation support: ${text}`);
  });
});

await check("PWA locks after background timeout and on a fresh launch", async () => {
  const appSource = await readFile("src/app.js", "utf8");
  [
    "PWA_RUNTIME_SESSION_KEY",
    "PWA_BACKGROUND_AT_KEY",
    "registerPwaRuntimeSession",
    "rememberPwaBackgroundStart",
    "handlePwaReturnFromBackground",
    "freshPwaLaunch",
    "App 已重新開啟，請驗證身分以繼續使用"
  ].forEach((text) => {
    if (!appSource.includes(text)) throw new Error(`src/app.js is missing PWA lock support: ${text}`);
  });
});

await check("Drive security writes require a current remote key package", async () => {
  const appSource = await readFile("src/app.js", "utf8");
  [
    "reuseDriveAuthorizationOrNotify",
    "prepareSecurityWrite",
    "securityWriteFailureMessage",
    "Google Drive 連線已失效；本機資料仍安全保留。請到設定頁明確點擊【重新連結 Google Drive】並選擇帳號。",
    "connectDrive({ interactive: false })",
    "recoveryChangeId",
    "globalLogoutId",
    "password-reset-cloud-verification-failed"
  ].forEach((text) => {
    if (!appSource.includes(text)) throw new Error(`src/app.js is missing Drive security preflight support: ${text}`);
  });
  if (appSource.includes("openSecurityWriteOAuthPopup")) throw new Error("security operations must not open an OAuth window automatically");
});

await check("sensitive security forms show a non-repeatable processing state", async () => {
  const [appSource, styleSource] = await Promise.all([
    readFile("src/app.js", "utf8"),
    readFile("src/styles.css", "utf8")
  ]);
  [
    "runSingleSecuritySubmission",
    'unlock: "登入中…"',
    '"drive-merge-unlock": "同步中…"',
    '"change-password": "更改中…"',
    '"regenerate-recovery": "產生中…"',
    '"forgot-password": "重設中…"',
    '"drive-recovery-reset": "重設中…"',
    '"recovery-v3-complete": "重設中…"',
    '"logout-all-devices": "登出中…"',
    'form.dataset.submitting === "true"',
    'submitButton.disabled = true'
  ].forEach((text) => {
    if (!appSource.includes(text)) throw new Error(`src/app.js is missing security-form processing support: ${text}`);
  });
  if (!styleSource.includes("button.is-processing:disabled")) throw new Error("src/styles.css is missing the processing button style");
});

await check("long-running recovery actions cannot be submitted repeatedly", async () => {
  const appSource = await readFile("src/app.js", "utf8");
  [
    "runSingleAction",
    'data-action="refresh-recovery-requests" data-pending-label="查詢中…"',
    'data-action="approve-recovery-request" data-pending-label="核准中…"',
    'button.dataset.processing === "true"',
    "button.disabled = true"
  ].forEach((text) => {
    if (!appSource.includes(text)) throw new Error(`src/app.js is missing action processing support: ${text}`);
  });
});

await check("cloud restore copy explains local password and recovery-code replacement", async () => {
  const appSource = await readFile("src/app.js", "utf8");
  const expected = "請輸入雲端同步資料<strong>原先設定的密碼</strong>；完成同步後，這台裝置原先設定的登入密碼與救援碼會失效，一律同步成此雲端資料最後設定的密碼及最後產生的救援碼";
  if (!appSource.includes(expected)) throw new Error("cloud restore password notice is not the approved text");
  if (appSource.includes('data-action="check-version-update"')) throw new Error("settings must not show a manual version-check button");
});

await check("idle unlock restores the in-memory route and unsaved draft", async () => {
  const appSource = await readFile("src/app.js", "utf8");
  [
    "suspendedRouteAfterIdleLock",
    "captureRouteForIdleUnlock",
    "resumeRouteAfterIdleUnlock",
    "scrollY: window.scrollY"
  ].forEach((text) => {
    if (!appSource.includes(text)) throw new Error(`src/app.js is missing idle route restoration support: ${text}`);
  });
});

await check("native Android back button exits only from root routes", async () => {
  const appSource = await readFile("src/app.js", "utf8");
  ["registerNativeBackButton", "addListener(\"backButton\"", "nativeApp.exitApp()", "navigateBack({ name: \"home\" })"].forEach((text) => {
    if (!appSource.includes(text)) throw new Error(`src/app.js is missing ${text}.`);
  });
});

await check("native Android OAuth uses Google AuthorizationClient and a one-time server auth code", async () => {
  const appSource = await readFile("src/app.js", "utf8");
  const nativeOAuthSource = await readFile("src/native-oauth.js", "utf8");
  const driveGoogleSource = await readFile("src/drive-google.js", "utf8");
  const pluginSource = await readFile("android/app/src/main/java/io/github/hgs3767994/wuwangwo/GoogleDriveAuthorizationPlugin.java", "utf8");
  const activitySource = await readFile("android/app/src/main/java/io/github/hgs3767994/wuwangwo/GoogleDriveAuthorizationActivity.java", "utf8");
  const oauthSessionPluginSource = await readFile("android/app/src/main/java/io/github/hgs3767994/wuwangwo/OAuthSessionPlugin.java", "utf8");
  ["GoogleDriveAuthorization.authorize", "nativeServerClientId", "server_auth_code", "selectAccount: forceReauthorization || selectAccount"].forEach((text) => {
    if (!nativeOAuthSource.includes(text)) throw new Error(`native OAuth adapter is missing ${text}.`);
  });
  ["GoogleDriveAuthorizationActivity", "serverAuthCode", "AuthorizationClient", "requestOfflineAccess", "drive.appdata", "result.hasResolution()", "AuthorizationRequest.Prompt.SELECT_ACCOUNT"].forEach((text) => {
    if (!pluginSource.includes(text)) throw new Error(`native OAuth Capacitor plugin is missing ${text}.`);
  });
  ["EXTRA_PENDING_INTENT", "PendingIntent", "getAuthorizationResultFromIntent"].forEach((text) => {
    if (!activitySource.includes(text)) throw new Error(`native OAuth Android activity is missing ${text}.`);
  });
  ["AndroidKeyStore", "AES/GCM/NoPadding", "OAuthSession", "renewalToken", "renewalExpiresAt"].forEach((text) => {
    if (!oauthSessionPluginSource.includes(text)) throw new Error(`native OAuth session storage is missing ${text}.`);
  });
  if (!nativeOAuthSource.includes("restoreNativeGoogleOAuthSession")) throw new Error("native OAuth adapter must restore the renewable Worker device session from Android Keystore.");
  if (!driveGoogleSource.includes('credentials: "include"') || !driveGoogleSource.includes("PERSISTENT_SESSION_MARKER_KEY")) {
    throw new Error("PWA OAuth must reuse the HttpOnly Worker session without persisting its bearer token.");
  }
  if (!appSource.includes("isNativeOAuthRuntime() || isSimulatedDrive() || sessionReusable")) {
    throw new Error("native OAuth must bypass the web popup reservation.");
  }
  if (!appSource.includes("beginDriveSetup({ ...oauthOptions, selectAccount: true })")) {
    throw new Error("a user-initiated Google Drive connection must show the native account selector.");
  }
  ["connectDrive({ interactive: false })", "disconnectedDriveState(previousGoogleDrive)", "重新連結 Google Drive"].forEach((text) => {
    if (!appSource.includes(text)) throw new Error(`expired Drive sessions must require explicit relinking: ${text}`);
  });
  ["/v1/oauth/session/refresh", "persistNativeGoogleOAuthSession", 'reauth: reauthorization'].forEach((text) => {
    if (!driveGoogleSource.includes(text)) throw new Error(`renewable device-session support is missing ${text}.`);
  });
  if (!driveGoogleSource.includes("if (popupWindow && !popupWindow.closed) popupWindow.close()")) {
    throw new Error("native OAuth must close any stale reserved web popup.");
  }
  if (!driveGoogleSource.includes("isNativeOAuthRuntime()")) throw new Error("Google Drive adapter must select native OAuth outside the WebView popup flow.");
  const authorizationActivityDeclaration = androidManifestSource.match(/<activity\s+[\s\S]*?android:name="\.GoogleDriveAuthorizationActivity"[\s\S]*?\/>/)?.[0] ?? "";
  if (!authorizationActivityDeclaration.includes('android:theme="@style/AppTheme.NoActionBar"')) {
    throw new Error("Google Drive authorization activity must use an AppCompat theme.");
  }
  const workerConfigSource = await readFile("workers/oauth/wrangler.jsonc", "utf8");
  if (!workerConfigSource.includes("https://localhost")) {
    throw new Error("Worker APP_ORIGINS must allow the Android Capacitor https origin.");
  }
});

await check("Android backup and device transfer exclude app data", async () => {
  if (!androidManifestSource.includes('android:allowBackup="false"')) throw new Error("Android Auto Backup must be disabled.");
  ["@xml/backup_rules", "@xml/data_extraction_rules"].forEach((text) => {
    if (!androidManifestSource.includes(text)) throw new Error(`AndroidManifest.xml is missing ${text}.`);
  });
  const legacyRules = await readFile("android/app/src/main/res/xml/backup_rules.xml", "utf8");
  const modernRules = await readFile("android/app/src/main/res/xml/data_extraction_rules.xml", "utf8");
  ["file", "database", "sharedpref", "external", "root"].forEach((domain) => {
    if (!legacyRules.includes(`domain="${domain}"`)) throw new Error(`Legacy backup rules must exclude ${domain}.`);
    if (!modernRules.includes(`domain="${domain}"`)) throw new Error(`Android 12 backup rules must exclude ${domain}.`);
  });
  if (!modernRules.includes("<device-transfer>")) throw new Error("Android 12 backup rules must block device-to-device transfer.");
});

await check("Android trusted session uses the native Keystore bridge", async () => {
  const cryptoSource = await readFile("src/crypto.js", "utf8");
  const bridgeSource = await readFile("src/native-trusted-session.js", "utf8");
  const pluginSource = await readFile("android/app/src/main/java/io/github/hgs3767994/wuwangwo/TrustedSessionPlugin.java", "utf8");
  ["schemaVersion: 2", "storage: \"android-keystore\"", "storeNativeTrustedSession"].forEach((text) => {
    if (!cryptoSource.includes(text)) throw new Error(`src/crypto.js is missing ${text}.`);
  });
  ["Plugins?.TrustedSession", "dekBase64"].forEach((text) => {
    if (!bridgeSource.includes(text)) throw new Error(`native trusted-session bridge is missing ${text}.`);
  });
  ["AndroidKeyStore", "BiometricPrompt", "DEVICE_CREDENTIAL", "Lifecycle.Event.ON_RESUME", "PROMPT_WINDOW_READY_DELAY_MS"].forEach((text) => {
    if (!pluginSource.includes(text)) throw new Error(`Android trusted-session plugin is missing ${text}.`);
  });
});

await check("native Android exports use the public Downloads folder", async () => {
  const bridgeSource = await readFile("src/native-file-export.js", "utf8");
  const pluginSource = await readFile("android/app/src/main/java/io/github/hgs3767994/wuwangwo/NativeFileExportPlugin.java", "utf8");
  ["Plugins?.NativeFileExport", "saveNativeExport"].forEach((text) => {
    if (!bridgeSource.includes(text)) throw new Error(`native file export bridge is missing ${text}.`);
  });
  ["MediaStore.Downloads", "RELATIVE_PATH", "莫忘"].forEach((text) => {
    if (!pluginSource.includes(text)) throw new Error(`native file export plugin is missing ${text}.`);
  });
});

await check("public legal pages exist for OAuth production readiness", async () => {
  const privacy = await readFile("privacy.html", "utf8");
  const terms = await readFile("terms.html", "utf8");
  ["PWA", "Android App", "Google Drive", "appDataFolder", "Cloudflare D1", "Email", "資料保留期限", "永久刪除", "Shawn G. Hong", "mailto:hgs3767994@gmail.com", "隱私權政策"].forEach((text) => {
    if (!privacy.includes(text)) throw new Error(`privacy.html must mention ${text}.`);
  });
  ["PWA", "Android App", "Google Drive", "加密", "救援碼", "資料備份", "服務變更或中止", "Shawn G. Hong", "mailto:hgs3767994@gmail.com", "服務條款"].forEach((text) => {
    if (!terms.includes(text)) throw new Error(`terms.html must mention ${text}.`);
  });
  if (!privacy.includes('./data-deletion.html') || !terms.includes('./data-deletion.html')) {
    throw new Error("public policies must link to the account and data deletion page.");
  }
});

await check("mobile PWA OAuth fallback completes outside the main history", async () => {
  const appSource = await readFile("src/app.js", "utf8");
  const driveSource = await readFile("src/drive-google.js", "utf8");
  const returnPage = await readFile("oauth-return.html", "utf8");
  const returnSource = await readFile("src/oauth-return.js", "utf8");
  [
    "registerOAuthPopupFallbackListener",
    "consumeOAuthPopupCompletion",
    "OAUTH_POPUP_COMPLETION_KEY",
    "popupDriveConnectionCompleted",
    "if (oauthReturnRoute) state.suspendedRouteAfterIdleLock = oauthReturnRoute",
    "reloadScheduled"
  ].forEach((text) => {
    if (!appSource.includes(text)) throw new Error(`src/app.js is missing isolated popup fallback support: ${text}`);
  });
  ["oauth-return.html", "oauth_purpose", "drive-connect", "connectGoogleDriveInPopup"].forEach((text) => {
    if (!driveSource.includes(text)) throw new Error(`src/drive-google.js is missing isolated popup fallback support: ${text}`);
  });
  if (!driveSource.includes("forget-me-not-oauth-handoff-accepted")) throw new Error("PWA opener must acknowledge a delivered OAuth handoff.");
  ["runtime-config.js", "oauth-return.js", "oauth-return-status"].forEach((text) => {
    if (!returnPage.includes(text)) throw new Error(`oauth-return.html is missing ${text}`);
  });
  [
    "forget-me-not-oauth-session-marker-v1",
    "forget-me-not-oauth-popup-completion",
    "BroadcastChannel",
    'window.setTimeout(() => window.close()',
    'credentials: "include"',
    'Authorization: `Bearer ${sessionToken}`'
  ].forEach((text) => {
    if (!returnSource.includes(text)) throw new Error(`src/oauth-return.js is missing secure popup fallback support: ${text}`);
  });
  const workerSource = await readFile("workers/oauth/src/index.js", "utf8");
  ["forget-me-not-oauth-handoff-accepted", "if(!accepted)window.location.replace(fallback)"].forEach((text) => {
    if (!workerSource.includes(text)) throw new Error(`OAuth popup callback is missing acknowledged fallback delivery: ${text}`);
  });
});

await check("PWA OAuth return removes Google pages from Settings Home navigation", async () => {
  const appSource = await readFile("src/app.js", "utf8");
  [
    "pendingOAuthSettingsBackBarrier",
    "completePendingOAuthSettingsBackBarrier",
    "installOAuthSettingsBackBarrier",
    'oauthHandoffCompleted && oauthReturnRoute?.name === "settings"',
    "completePendingOAuthSettingsBackBarrier();"
  ].forEach((text) => {
    if (!appSource.includes(text)) throw new Error(`src/app.js is missing post-unlock OAuth history isolation: ${text}`);
  });
});

await check("public and Android release versions match", () => {
  if (!appVersion || packageConfig.version !== appVersion || androidVersionName !== appVersion) {
    throw new Error("package version, APP_CONFIG.appVersion, and Android versionName must match.");
  }
  if (!Number.isSafeInteger(androidVersionCode) || androidVersionCode < 1) {
    throw new Error("Android versionCode must be a positive integer.");
  }
});

await check("approved Android and Google Play launcher icons are intact", async () => {
  const densities = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
  const iconNames = ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"];
  const generatedIcons = densities.flatMap((density) =>
    iconNames.map((name) => `android/app/src/main/res/mipmap-${density}/${name}`)
  );
  const requiredIconFiles = [
    "scripts/generate-android-icons.ps1",
    "store-assets/google-play/icon-512.png",
    "android/app/src/main/res/values/ic_launcher_background.xml",
    ...generatedIcons
  ];
  const expectedHashes = new Map([
    ["assets/icon-512.png", "BD7D55E737C9873BA63B7CD5D4CF92F6CC4B960FFB6DAD03638E48632AF2F6DB"],
    ["store-assets/google-play/icon-512.png", "DF4D359BFDE79727723A2FD619061A89828F10BDE0109CA43BE5A12542BB2B6E"],
    ["android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png", "6A2C9DF38BF50086F63FF63EAA658975A6D6978E3CC6ECE688EB20C7D97E06FA"],
    ["android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png", "33A29A327705B53FEC8C02E1869233A58951BC5DA6DD4032436FCAC086658C70"],
    ["android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png", "B039A4119B099EA33396BA35E4E434CD43D1EF9CC0EF372F11DCBB27B336F99F"]
  ]);

  try {
    await Promise.all(requiredIconFiles.map((file) => access(file)));
    const backgroundSource = await readFile("android/app/src/main/res/values/ic_launcher_background.xml", "utf8");
    if (!backgroundSource.includes("#FAFAFA")) throw new Error("adaptive icon background must remain #FAFAFA");
    for (const [file, expectedHash] of expectedHashes) {
      const actualHash = createHash("sha256").update(await readFile(file)).digest("hex").toUpperCase();
      if (actualHash !== expectedHash) throw new Error(`${file} SHA-256 changed`);
    }
  } catch (error) {
    throw new Error(`Approved launcher icon assets are missing or changed (${error.message}). Re-run scripts/generate-android-icons.ps1 from the project root.`);
  }
});

await check("account deletion is available in-app and on a public self-service page", async () => {
  const [appSource, deletionPage, deletionSource, workerSource, storeSource, renewalMigrationSource] = await Promise.all([
    readFile("src/app.js", "utf8"),
    readFile("data-deletion.html", "utf8"),
    readFile("src/account-deletion.js", "utf8"),
    readFile("workers/oauth/src/index.js", "utf8"),
    readFile("workers/oauth/src/oauth-store.js", "utf8"),
    readFile("workers/oauth/migrations/0005-session-renewals.sql", "utf8")
  ]);
  ["刪除雲端帳號與資料", "Google Drive appDataFolder 中的莫忘加密同步檔", "deleteLocalData", "data-deletion.html"].forEach((text) => {
    if (!appSource.includes(text)) throw new Error(`src/app.js is missing account deletion support: ${text}`);
  });
  ["Cloudflare D1", "Google Drive appDataFolder", "data-delete-submit"].forEach((text) => {
    if (!deletionPage.includes(text)) throw new Error(`data-deletion.html is missing ${text}`);
  });
  if (!deletionSource.includes("deleteGoogleCloudAccount")) throw new Error("public deletion page must execute self-service account deletion");
  if (deletionPage.includes("data-delete-drive") || deletionSource.includes("data-delete-drive")) {
    throw new Error("public account deletion must not allow Google Drive data retention");
  }
  ["/v1/account/delete", "ACCOUNT_DELETION_REAUTH_MS", "revokeGoogleToken", "deleteAccountData"].forEach((text) => {
    if (!workerSource.includes(text)) throw new Error(`Worker is missing account deletion support: ${text}`);
  });
  ["name: \"vault.enc\"", "name: \"key-package.enc\"", "driveDataDeleted: true"].forEach((text) => {
    if (!workerSource.includes(text)) throw new Error(`Worker must always delete account-owned Drive data: ${text}`);
  });
  ["/v1/oauth/session/status", "/v1/oauth/session/refresh", "rotateRenewalAndCreateSession", "WORKER_RENEWAL_COOKIE", 'reauthorization === "account-selection"'].forEach((text) => {
    if (!workerSource.includes(text)) throw new Error(`Worker is missing cross-client session invalidation support: ${text}`);
  });
  ["ACCESS_SESSION_LIFETIME_MS = 60 * 60 * 1000", "DEVICE_RENEWAL_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000", "oauth_session_renewals"].forEach((text) => {
    if (!storeSource.includes(text)) throw new Error(`Worker session separation is missing ${text}`);
  });
  ["CREATE TABLE IF NOT EXISTS oauth_session_renewals", "UPDATE oauth_sessions", "+1 hour"].forEach((text) => {
    if (!renewalMigrationSource.includes(text)) throw new Error(`session-renewal migration is missing ${text}`);
  });
  if (!storeSource.includes("database.batch(statements)")) throw new Error("D1 account deletion must use an atomic batch");
});

await check("GitHub Pages workflow builds deployable dist", () => {
  ["actions/deploy-pages", "npm run check", "npm run test", "npm run build:pages", "GOOGLE_OAUTH_CLIENT_ID"].forEach((text) => {
    if (!workflowSource.includes(text)) throw new Error(`GitHub Pages workflow is missing ${text}.`);
  });
  ["dist", "runtime-config.js", ".nojekyll", "GOOGLE_OAUTH_CLIENT_ID", "oauth-return.html"].forEach((text) => {
    if (!buildPagesSource.includes(text)) throw new Error(`scripts/build-pages.mjs is missing ${text}.`);
  });
});

const appShell = parseAppShell(serviceWorkerSource);

await check("service worker app shell files exist", async () => {
  await Promise.all(appShell.filter((file) => file !== "./").map((file) => access(stripRelativePrefix(file))));
});

await check("service worker rejects mixed-version Pages deployments", async () => {
  const serviceWorkerSource = await readFile("service-worker.js", "utf8");
  [
    "precacheVersionedAppShell",
    'fetchUrl.searchParams.set("sw-version", CACHE_NAME)',
    'cache: "no-store"',
    'path === "./src/config.js"',
    "app-shell-version-mismatch",
    "await caches.delete(CACHE_NAME)"
  ].forEach((text) => {
    if (!serviceWorkerSource.includes(text)) throw new Error(`service worker is missing mixed-version deployment protection: ${text}`);
  });
  if (serviceWorkerSource.includes("cache.addAll(APP_SHELL)")) throw new Error("service worker must not precache unversioned app-shell responses.");
});

await check("required files are included in service worker app shell", () => {
  const appShellSet = new Set(appShell.map(stripRelativePrefix));
  appShellRequiredFiles.forEach((file) => {
      if (!appShellSet.has(file)) throw new Error(`${file} is not included in APP_SHELL.`);
    });
});

checks.forEach((item) => console.log(`${item.ok ? "✓" : "✗"} ${item.name}`));
console.log("Deployment checks passed.");

async function check(name, fn) {
  try {
    const result = await fn();
    checks.push({ name, ok: true });
    return result;
  } catch (error) {
    checks.push({ name, ok: false });
    checks.forEach((item) => console.log(`${item.ok ? "✓" : "✗"} ${item.name}`));
    throw error;
  }
}

function parseAppShell(source) {
  const match = source.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  if (!match) throw new Error("service-worker.js APP_SHELL was not found.");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function stripRelativePrefix(path) {
  return path.replace(/^\.\//, "");
}
