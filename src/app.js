import { getItem, removeItem, setItem } from "./db.js";
import { approveDriveRecoveryRequest, connectDrive, createDriveRecoveryRequest, disconnectDrive, driveAuthStatus, driveReadiness, getDriveRecoveryRequest, listDriveFileRevisions, listDriveFiles, listDriveRecoveryRequests, readDriveFile, readDriveFileRevision, writeDriveFile } from "./drive.js";
import { completeGoogleOAuthHandoff } from "./drive-google.js";
import { APP_CONFIG, driveFileName, driveProviderLabel } from "./config.js";
import { mergeVaults } from "./sync.js";
import { buildVaultXlsx } from "./xlsx.js";
import {
  createKeyPackage,
  createRecoveryAuthorizationVerifier,
  createLocalStorageKey,
  decryptLocalEnvelope,
  createTrustedSessionWithDek,
  decryptVaultEnvelope,
  encryptLocalEnvelope,
  encryptVaultEnvelope,
  generateRecoveryCode,
  normalizeRecoveryCode,
  restoreDekFromTrustedSession,
  unwrapDek,
  verifyRecoveryAuthorizationVerifier,
  wrapDekForSecret
} from "./crypto.js";
import {
  DEFAULT_INTEREST_TAGS,
  DEFAULT_PERSON_GROUP_TAGS,
  RETIRED_PERSON_GROUP_TAG_IDS,
  createDeviceId,
  createEmptyVault,
  createPerson,
  daysUntil,
  formatDateTime,
  sortPeople,
  touchVault
} from "./model.js";

const app = document.querySelector("#app");
const FAMILY_RELATIONSHIP_ORDER = ["父", "母", "配偶", "子", "女", "兄", "姊", "弟", "妹"];
const FAMILY_RELATIONSHIP_OPTIONS = [...FAMILY_RELATIONSHIP_ORDER, "其它"];
const ADDRESS_CITY_DISTRICTS = {
  台北市: ["中正區", "大同區", "中山區", "松山區", "大安區", "萬華區", "信義區", "士林區", "北投區", "內湖區", "南港區", "文山區"],
  新北市: ["板橋區", "三重區", "中和區", "永和區", "新莊區", "新店區", "土城區", "蘆洲區", "樹林區", "汐止區", "鶯歌區", "三峽區", "淡水區", "瑞芳區", "五股區", "泰山區", "林口區", "深坑區", "石碇區", "坪林區", "三芝區", "石門區", "八里區", "平溪區", "雙溪區", "貢寮區", "金山區", "萬里區", "烏來區"],
  桃園市: ["桃園區", "中壢區", "平鎮區", "八德區", "楊梅區", "蘆竹區", "大溪區", "龍潭區", "龜山區", "大園區", "觀音區", "新屋區", "復興區"],
  台中市: ["中區", "東區", "南區", "西區", "北區", "北屯區", "西屯區", "南屯區", "太平區", "大里區", "霧峰區", "烏日區", "豐原區", "后里區", "石岡區", "東勢區", "和平區", "新社區", "潭子區", "大雅區", "神岡區", "大肚區", "沙鹿區", "龍井區", "梧棲區", "清水區", "大甲區", "外埔區", "大安區"],
  台南市: ["中西區", "東區", "南區", "北區", "安平區", "安南區", "永康區", "歸仁區", "新化區", "左鎮區", "玉井區", "楠西區", "南化區", "仁德區", "關廟區", "龍崎區", "官田區", "麻豆區", "佳里區", "西港區", "七股區", "將軍區", "學甲區", "北門區", "新營區", "後壁區", "白河區", "東山區", "六甲區", "下營區", "柳營區", "鹽水區", "善化區", "大內區", "山上區", "新市區", "安定區"],
  高雄市: ["楠梓區", "左營區", "鼓山區", "三民區", "鹽埕區", "前金區", "新興區", "苓雅區", "前鎮區", "旗津區", "小港區", "鳳山區", "林園區", "大寮區", "大樹區", "大社區", "仁武區", "鳥松區", "岡山區", "橋頭區", "燕巢區", "田寮區", "阿蓮區", "路竹區", "湖內區", "茄萣區", "永安區", "彌陀區", "梓官區", "旗山區", "美濃區", "六龜區", "甲仙區", "杉林區", "內門區", "茂林區", "桃源區", "那瑪夏區"],
  基隆市: ["仁愛區", "信義區", "中正區", "中山區", "安樂區", "暖暖區", "七堵區"],
  新竹市: ["東區", "北區", "香山區"],
  嘉義市: ["東區", "西區"],
  新竹縣: ["竹北市", "竹東鎮", "新埔鎮", "關西鎮", "湖口鄉", "新豐鄉", "芎林鄉", "橫山鄉", "北埔鄉", "寶山鄉", "峨眉鄉", "尖石鄉", "五峰鄉"],
  苗栗縣: ["苗栗市", "頭份市", "竹南鎮", "後龍鎮", "通霄鎮", "苑裡鎮", "卓蘭鎮", "造橋鄉", "西湖鄉", "頭屋鄉", "公館鄉", "銅鑼鄉", "三義鄉", "大湖鄉", "獅潭鄉", "三灣鄉", "南庄鄉", "泰安鄉"],
  彰化縣: ["彰化市", "員林市", "和美鎮", "鹿港鎮", "溪湖鎮", "二林鎮", "田中鎮", "北斗鎮", "花壇鄉", "芬園鄉", "大村鄉", "永靖鄉", "伸港鄉", "線西鄉", "福興鄉", "秀水鄉", "埔心鄉", "埔鹽鄉", "大城鄉", "芳苑鄉", "竹塘鄉", "社頭鄉", "二水鄉", "田尾鄉", "埤頭鄉", "溪州鄉"],
  南投縣: ["南投市", "埔里鎮", "草屯鎮", "竹山鎮", "集集鎮", "名間鄉", "鹿谷鄉", "中寮鄉", "魚池鄉", "國姓鄉", "水里鄉", "信義鄉", "仁愛鄉"],
  雲林縣: ["斗六市", "斗南鎮", "虎尾鎮", "西螺鎮", "土庫鎮", "北港鎮", "古坑鄉", "大埤鄉", "莿桐鄉", "林內鄉", "二崙鄉", "崙背鄉", "麥寮鄉", "東勢鄉", "褒忠鄉", "台西鄉", "元長鄉", "四湖鄉", "口湖鄉", "水林鄉"],
  嘉義縣: ["太保市", "朴子市", "布袋鎮", "大林鎮", "民雄鄉", "溪口鄉", "新港鄉", "六腳鄉", "東石鄉", "義竹鄉", "鹿草鄉", "水上鄉", "中埔鄉", "竹崎鄉", "梅山鄉", "番路鄉", "大埔鄉", "阿里山鄉"],
  屏東縣: ["屏東市", "潮州鎮", "東港鎮", "恆春鎮", "萬丹鄉", "長治鄉", "麟洛鄉", "九如鄉", "里港鄉", "鹽埔鄉", "高樹鄉", "萬巒鄉", "內埔鄉", "竹田鄉", "新埤鄉", "枋寮鄉", "新園鄉", "崁頂鄉", "林邊鄉", "南州鄉", "佳冬鄉", "琉球鄉", "車城鄉", "滿州鄉", "枋山鄉", "三地門鄉", "霧台鄉", "瑪家鄉", "泰武鄉", "來義鄉", "春日鄉", "獅子鄉", "牡丹鄉"],
  宜蘭縣: ["宜蘭市", "羅東鎮", "蘇澳鎮", "頭城鎮", "礁溪鄉", "壯圍鄉", "員山鄉", "冬山鄉", "五結鄉", "三星鄉", "大同鄉", "南澳鄉"],
  花蓮縣: ["花蓮市", "鳳林鎮", "玉里鎮", "新城鄉", "吉安鄉", "壽豐鄉", "光復鄉", "豐濱鄉", "瑞穗鄉", "富里鄉", "秀林鄉", "萬榮鄉", "卓溪鄉"],
  台東縣: ["台東市", "成功鎮", "關山鎮", "卑南鄉", "鹿野鄉", "池上鄉", "東河鄉", "長濱鄉", "太麻里鄉", "大武鄉", "綠島鄉", "海端鄉", "延平鄉", "金峰鄉", "達仁鄉", "蘭嶼鄉"],
  澎湖縣: ["馬公市", "湖西鄉", "白沙鄉", "西嶼鄉", "望安鄉", "七美鄉"],
  金門縣: ["金城鎮", "金湖鎮", "金沙鎮", "金寧鄉", "烈嶼鄉", "烏坵鄉"],
  連江縣: ["南竿鄉", "北竿鄉", "莒光鄉", "東引鄉"]
};
const ADDRESS_CITY_OPTIONS = [...Object.keys(ADDRESS_CITY_DISTRICTS), "其它/海外地址"];
const GENDER_OPTIONS = ["男", "女", "其它"];
const IDLE_LOCK_MS = 3 * 60 * 1000;
const AWAY_LOCK_MS = 2 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;
const DRIVE_SYNC_STALE_MS = 2 * 60 * 1000;
const NO_SLIDE_ROUTE_NAMES = new Set([
  "loading",
  "welcome",
  "unlock",
  "driveIntro",
  "driveCloudChoice",
  "driveMergeUnlock",
  "driveExistingUnlock",
  "driveRecoveryReset",
  "driveRevisionRecovery",
  "setupMasterPassword",
  "showRecoveryCode",
  "changePassword",
  "forgotPassword",
  "regenerateRecovery",
  "logoutAllDevices"
]);
const THEME_OPTIONS = [
  { id: "comfortable-green", name: "舒適綠", colors: ["#24443D", "#5B9EA6", "#F4F6F5"] },
  { id: "business-blue", name: "商務藍", colors: ["#1E293B", "#2563EB", "#F8FAFC"] },
  { id: "gentle-pink", name: "溫柔粉", colors: ["#8B5E83", "#D88FA3", "#FFF7F8"] },
  { id: "warm-amber", name: "暖琥珀", colors: ["#292D32", "#C58B3A", "#FFFFFF"] },
  { id: "memory-paper", name: "回憶灰", colors: ["#667887", "#A77A52", "#F3EEE4"] },
  { id: "midnight-black", name: "深夜黑", colors: ["#E5E7EB", "#60A5FA", "#050505"] }
];
let state = {
  appState: null,
  dekBytes: null,
  vault: null,
  localSnapshots: [],
  route: { name: "loading" },
  updateAvailable: false,
  waitingServiceWorker: null,
  serviceWorkerRegistration: null,
  historyNavigationRegistered: false,
  ignoreNextPopstate: false,
  skipNextPopstateConfirm: false,
  developerAccessGuardRegistered: false,
  autoLockRegistered: false,
  idleLockTimer: null,
  lastSessionTouchAt: 0,
  installPromptEvent: null,
  installDismissed: localStorage.getItem("forget-me-not-install-dismissed") === "true",
  isInstalled: isPwaInstalled()
};

async function boot() {
  registerDeveloperAccessGuard();
  registerAutoLock();
  let oauthHandoffCompleted = false;
  let oauthHandoffError = null;
  try { oauthHandoffCompleted = Boolean(await completeGoogleOAuthHandoff()); } catch (error) { oauthHandoffError = error; }
  const storedAppState = await getItem("appState");
  let appState = normalizeLoadedAppState(storedAppState);
  if (oauthHandoffCompleted && appState?.googleDrive?.syncStatus === "syncing") {
    appState = {
      ...appState,
      googleDrive: {
        ...appState.googleDrive,
        syncStatus: syncStatusAfterLocalChange(appState.googleDrive),
        syncStartedAt: "",
        lastSyncError: ""
      }
    };
  }
  if (oauthHandoffError && appState?.googleDrive) {
    appState = {
      ...appState,
      googleDrive: {
        ...appState.googleDrive,
        syncStatus: "error",
        syncStartedAt: "",
        lastSyncError: driveErrorMessage(oauthHandoffError, "Google Drive OAuth 回跳失敗，請再試一次。")
      }
    };
  }
  if (storedAppState && appState !== storedAppState) await setItem("appState", appState);
  const vault = await loadLocalVault();
  const trustedSession = await getItem("trustedSession");
  const localSnapshots = await loadLocalSnapshots();
  state = { ...state, localSnapshots };
  if (!appState || !vault) {
    state = { ...state, route: { name: "welcome" } };
  } else if (appState.mode === "driveSync" && !trustedSession) {
    state = { ...state, appState, vault: normalizeVault(pruneDeleted(vault)), route: { name: "unlock", allowBiometric: false } };
  } else {
    let dekBytes = null;
    if (appState.mode === "driveSync") {
      const sessionCheck = await checkTrustedSessionStillValid(appState, trustedSession);
      if (!sessionCheck.valid) {
        if (!sessionCheck.keepTrustedSession) await removeItem("trustedSession");
        state = {
          ...state,
          appState,
          vault: normalizeVault(pruneDeleted(vault)),
          route: { name: "unlock", message: sessionCheck.message, showForgotPassword: true, allowBiometric: Boolean(sessionCheck.keepTrustedSession) }
        };
        render();
        registerHistoryNavigation();
        registerServiceWorker();
        registerInstallExperience();
        return;
      }
      try {
        dekBytes = await restoreDekFromTrustedSession(trustedSession);
      } catch {
        await removeItem("trustedSession");
        state = { ...state, appState, vault: normalizeVault(pruneDeleted(vault)), route: { name: "unlock", allowBiometric: false } };
        render();
        registerHistoryNavigation();
        registerServiceWorker();
        registerInstallExperience();
        return;
      }
    }
    state = { ...state, appState, dekBytes, vault: normalizeVault(pruneDeleted(vault)), route: { name: "home" } };
    await save();
    void resumeDriveSyncInBackground();
  }
  render();
  registerHistoryNavigation();
  registerServiceWorker();
  registerInstallExperience();
  if (oauthHandoffError) alert(driveErrorMessage(oauthHandoffError, "Google Drive OAuth 回跳失敗，請再試一次。"));
}

function normalizeLoadedAppState(appState) {
  if (!appState?.googleDrive || appState.googleDrive.syncStatus !== "syncing") return appState;
  return {
    ...appState,
    googleDrive: {
      ...appState.googleDrive,
      syncStatus: syncStatusAfterLocalChange(appState.googleDrive),
      syncStartedAt: "",
      lastSyncError: appState.googleDrive.lastSyncError || "上次同步因頁面重新載入而中斷，請再按「立即同步」。"
    }
  };
}

function registerDeveloperAccessGuard() {
  if (state.developerAccessGuardRegistered) return;
  state.developerAccessGuardRegistered = true;
  window.addEventListener("contextmenu", (event) => {
    if (isTouchContextMenu(event)) return;
    event.preventDefault();
  });
  window.addEventListener(
    "keydown",
    (event) => {
      const key = event.key.toLowerCase();
      const blocked =
        event.key === "F12" ||
        (event.ctrlKey && event.shiftKey && ["i", "j", "c"].includes(key)) ||
        (event.metaKey && event.altKey && ["i", "j", "c"].includes(key)) ||
        (event.ctrlKey && key === "u");
      if (!blocked) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );
}

function isTouchContextMenu(event) {
  return event.pointerType === "touch" || event.pointerType === "pen" || event.sourceCapabilities?.firesTouchEvents;
}

function registerAutoLock() {
  if (state.autoLockRegistered) return;
  state.autoLockRegistered = true;
  ["pointerdown", "keydown", "touchstart", "scroll"].forEach((eventName) => {
    window.addEventListener(eventName, () => recordUserActivity(), { passive: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void touchTrustedSessionNow({ force: true });
    } else {
      recordUserActivity();
    }
  });
  window.addEventListener("pagehide", () => {
    void touchTrustedSessionNow({ force: true });
  });
  resetIdleLockTimer();
}

function recordUserActivity() {
  if (state.route?.name === "unlock") return;
  resetIdleLockTimer();
  void touchTrustedSessionNow();
}

function resetIdleLockTimer() {
  if (state.idleLockTimer) window.clearTimeout(state.idleLockTimer);
  if (!canAutoLock()) return;
  state.idleLockTimer = window.setTimeout(() => {
    void lockApp("已閒置超過 3 分鐘，請重新輸入密碼");
  }, IDLE_LOCK_MS);
}

function canAutoLock() {
  return Boolean(state.appState?.mode === "driveSync" && state.dekBytes && state.route?.name !== "unlock");
}

async function touchTrustedSessionNow(options = {}) {
  if (!state.appState || state.route?.name === "unlock") return;
  const nowMs = Date.now();
  if (!options.force && nowMs - state.lastSessionTouchAt < SESSION_TOUCH_INTERVAL_MS) return;
  const trustedSession = await getItem("trustedSession");
  if (!trustedSession) return;
  state.lastSessionTouchAt = nowMs;
  await setItem("trustedSession", {
    ...trustedSession,
    lastUsedAt: new Date(nowMs).toISOString()
  });
}

async function lockApp(message = "請重新輸入密碼以繼續使用") {
  if (!state.appState || state.route?.name === "unlock") return;
  if (state.idleLockTimer) {
    window.clearTimeout(state.idleLockTimer);
    state.idleLockTimer = null;
  }
  if (state.appState.mode !== "driveSync") return;
  await touchTrustedSessionNow({ force: true });
  state.dekBytes = null;
  state.route = { name: "unlock", message, showForgotPassword: true, allowBiometric: true };
  render();
}

async function checkTrustedSessionStillValid(appState, trustedSession) {
  if (!trustedSession) return { valid: false, message: "請輸入密碼以繼續使用" };
  if (shouldLockForAwayTimeout(trustedSession)) {
    return { valid: false, keepTrustedSession: true, message: "離開 App 時間較久，請重新輸入密碼" };
  }
  const localKeyPackage = await getKeyPackage();
  let remoteKeyPackage = null;
  if (appState.googleDrive?.connected && driveAuthStatus().hasAccessToken) {
    try {
      remoteKeyPackage = await readDriveFile(driveFileName("keyPackage"));
    } catch {}
  }
  const keyPackage = remoteKeyPackage ?? localKeyPackage;
  if (!keyPackage?.securityMeta) return { valid: true };
  if ((keyPackage.securityMeta.sessionEpoch ?? 0) <= (trustedSession.sessionEpoch ?? 0)) return { valid: true };
  await setItem("keyPackage", keyPackage);
  return { valid: false, message: securityEventMessage(keyPackage.securityMeta) };
}

function shouldLockForAwayTimeout(trustedSession) {
  if (!trustedSession?.lastUsedAt) return false;
  return Date.now() - new Date(trustedSession.lastUsedAt).getTime() > AWAY_LOCK_MS;
}

function isBiometricUnlockEnabled() {
  return Boolean(state.appState?.security?.biometricUnlockEnabled);
}

function webAuthnSupported() {
  return Boolean(window.isSecureContext && window.PublicKeyCredential && navigator.credentials?.create && navigator.credentials?.get);
}

async function platformAuthenticatorAvailable() {
  if (!webAuthnSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function randomBuffer(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  const value = btoa(String.fromCharCode(...bytes));
  return value.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBuffer(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function relyingPartyId() {
  return location.hostname || undefined;
}

async function enableBiometricUnlock() {
  const enablingFromUnlock = state.route?.name === "unlock";
  if (state.appState?.mode !== "driveSync") {
    alert("請先啟用 Google Drive 同步並設定密碼後，再啟用生物辨識解鎖。");
    return;
  }
  if (!state.dekBytes) {
    const verified = await verifySensitiveOperation("啟用生物辨識解鎖");
    if (!verified || !state.dekBytes) return;
  }
  if (!(await platformAuthenticatorAvailable())) {
    alert("此瀏覽器或裝置目前不支援可驗證使用者的生物辨識／裝置解鎖。");
    return;
  }
  const confirmed = confirm("啟用後，這台裝置可使用指紋、臉部辨識或螢幕鎖快速解鎖莫忘。\n\n密碼與救援碼仍會保留作為備援。是否啟用？");
  if (!confirmed) return;
  try {
    const userId = randomBuffer(16);
    const rp = { name: "莫忘" };
    const rpId = relyingPartyId();
    if (rpId) rp.id = rpId;
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: randomBuffer(),
        rp,
        user: {
          id: userId,
          name: currentDriveAccountEmail() || "local-user",
          displayName: currentDriveAccountEmail() || "莫忘使用者"
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 }
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required"
        },
        timeout: 60000,
        attestation: "none"
      }
    });
    await setItem("biometricUnlock", {
      schemaVersion: 1,
      credentialId: credential.id,
      rawId: bufferToBase64Url(credential.rawId),
      userId: bufferToBase64Url(userId),
      rpId,
      createdAt: new Date().toISOString()
    });
    state.appState = {
      ...state.appState,
      security: {
        ...(state.appState.security ?? {}),
        biometricUnlockEnabled: true,
        biometricUnlockUpdatedAt: new Date().toISOString()
      }
    };
    await save();
    alert("已啟用生物辨識解鎖");
    if (enablingFromUnlock) {
      navigate({ name: "home" }, { replace: true, force: true });
      void resumeDriveSyncInBackground();
      return;
    }
    render();
  } catch (error) {
    alert(error?.name === "NotAllowedError" ? "未完成生物辨識設定。" : "生物辨識設定失敗，請確認裝置已設定螢幕鎖或生物辨識。");
  }
}

async function disableBiometricUnlock() {
  if (!(await verifySensitiveOperation("停用生物辨識解鎖"))) return;
  await removeItem("biometricUnlock");
  state.appState = {
    ...state.appState,
    security: {
      ...(state.appState.security ?? {}),
      biometricUnlockEnabled: false,
      biometricUnlockUpdatedAt: new Date().toISOString()
    }
  };
  await save();
  alert("已停用生物辨識解鎖");
  render();
}

async function unlockWithBiometric(options = {}) {
  const silent = options.silent === true;
  if (!webAuthnSupported()) {
    if (!silent) alert("此瀏覽器目前不支援生物辨識解鎖。");
    return;
  }
  const credentialRecord = await getItem("biometricUnlock");
  const trustedSession = await getItem("trustedSession");
  if (!isBiometricUnlockEnabled() || !credentialRecord || !trustedSession) {
    if (!silent) alert("這台裝置尚未啟用生物辨識解鎖，請使用密碼登入。");
    return;
  }
  if (credentialRecord.rpId && credentialRecord.rpId !== relyingPartyId()) {
    if (!silent) alert("生物辨識解鎖是依照目前網址保存的。請在原本啟用的網址重新開啟，或使用密碼登入後重新啟用。");
    return;
  }
  try {
    const publicKey = {
      challenge: randomBuffer(),
      allowCredentials: [
        {
          id: base64UrlToBuffer(credentialRecord.rawId),
          type: "public-key"
        }
      ],
      userVerification: "required",
      timeout: 60000
    };
    const rpId = relyingPartyId();
    if (rpId) publicKey.rpId = rpId;
    await navigator.credentials.get({ publicKey });
    state.dekBytes = await restoreDekFromTrustedSession(trustedSession);
    await touchTrustedSessionNow({ force: true });
    navigate({ name: "home" }, { replace: true, force: true });
    void resumeDriveSyncInBackground();
  } catch {
    if (!silent) alert("生物辨識解鎖未完成，請改用密碼登入。");
  }
}

function maybeAutoBiometricUnlock() {
  if (state.route?.name !== "unlock") return;
  if (state.route.allowBiometric === false || state.route.autoBiometricAttempted) return;
  if (!isBiometricUnlockEnabled()) return;
  state.route.autoBiometricAttempted = true;
  window.setTimeout(() => {
    if (state.route?.name !== "unlock") return;
    void unlockWithBiometric({ silent: true });
  }, 250);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" }).then((registration) => {
      state.serviceWorkerRegistration = registration;
      if (registration.waiting && navigator.serviceWorker.controller) {
        state.updateAvailable = true;
        state.waitingServiceWorker = registration.waiting;
        render();
      }
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            state.updateAvailable = true;
            state.waitingServiceWorker = worker;
            render();
          }
        });
      });
      window.setTimeout(() => {
        void registration.update();
      }, 1000);
    }).catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (state.isReloadingForUpdate) return;
      state.isReloadingForUpdate = true;
      window.location.reload();
    });
  }
}

function registerInstallExperience() {
  if (state.installExperienceRegistered) return;
  state.installExperienceRegistered = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPromptEvent = event;
    state.isInstalled = isPwaInstalled();
    render();
  });
  window.addEventListener("appinstalled", () => {
    state.installPromptEvent = null;
    state.isInstalled = true;
    state.installDismissed = true;
    localStorage.setItem("forget-me-not-install-dismissed", "true");
    render();
  });
  window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", () => {
    state.isInstalled = isPwaInstalled();
    render();
  });
}

function registerHistoryNavigation() {
  if (state.historyNavigationRegistered) return;
  state.historyNavigationRegistered = true;
  replaceHistoryRoute(state.route);
  window.addEventListener("popstate", (event) => {
    if (state.ignoreNextPopstate) {
      state.ignoreNextPopstate = false;
      return;
    }
    if (!event.state?.appRoute) return;
    const fromRoute = state.route;
    const nextRoute = restoreHistoryRoute(event.state.route);
    if (state.skipNextPopstateConfirm) {
      state.skipNextPopstateConfirm = false;
    } else if (!confirmBeforeLeavingCurrentRoute(nextRoute, { viaHistory: true })) {
      return;
    }
    state.route = nextRoute;
    render({ restoreScroll: true, transition: "back", fromRoute });
  });
  window.addEventListener("beforeunload", (event) => {
    if (!hasPendingRouteWork()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function isPwaInstalled() {
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone
  );
}

function shouldShowInstallPromptCard() {
  if (isPwaInstalled()) return false;
  if (state.installDismissed) return false;
  return Boolean(state.installPromptEvent || isLikelyIosSafari());
}

function isLikelyIosSafari() {
  const ua = navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /safari/.test(ua) && !/crios|fxios|edgios/.test(ua);
  return isIos && isSafari;
}

async function installApp() {
  if (!state.installPromptEvent) {
    navigate({ name: "installGuide" });
    return;
  }
  const promptEvent = state.installPromptEvent;
  state.installPromptEvent = null;
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === "accepted") {
      state.isInstalled = true;
      state.installDismissed = true;
      localStorage.setItem("forget-me-not-install-dismissed", "true");
    }
  } catch {
    navigate({ name: "installGuide" });
    return;
  }
  render();
}

function dismissInstallTip() {
  state.installDismissed = true;
  localStorage.setItem("forget-me-not-install-dismissed", "true");
  render();
}

async function initializeLocalMode() {
  const deviceId = createDeviceId();
  const vault = createEmptyVault(deviceId);
  state.appState = {
    schemaVersion: 1,
    mode: "localOnly",
    deviceId,
    currentVaultId: vault.vaultId,
    ui: {
      themeId: currentThemeId()
    },
    googleDrive: {
      connected: false,
      syncStatus: "disabled"
    }
  };
  state.vault = vault;
  state.route = { name: "home" };
  await save();
  render();
}

async function beginDriveSetup() {
  const readiness = driveReadiness();
  if (!readiness.ready) {
    alert(readiness.message);
    return;
  }
  try {
    const driveConnection = await connectDrive();
    rememberDriveAccount(driveConnection);
  } catch (error) {
    alert(driveErrorMessage(error, "Google Drive 連線失敗，請稍後再試。"));
    return;
  }
  const cancelTo = state.vault ? "settings" : "welcome";
  state.driveSetupCancelTo = cancelTo;
  const existingKeyPackage = await getKeyPackage();
  if (state.appState?.mode === "driveSync" && existingKeyPackage) {
    const remoteKeyPackage = await readDriveFile(driveFileName("keyPackage"));
    if (remoteKeyPackage?.securityMeta?.sessionEpoch > existingKeyPackage.securityMeta?.sessionEpoch) {
      await setItem("keyPackage", remoteKeyPackage);
      await removeItem("trustedSession");
      state.appState = {
        ...state.appState,
        googleDrive: {
          ...state.appState.googleDrive,
          connected: true,
          syncStatus: "synced",
          lastSyncAt: new Date().toISOString(),
          accountEmail: currentDriveAccountEmail(),
          simulated: isSimulatedDrive()
        }
      };
      await setItem("appState", state.appState);
      state.route = {
        name: "unlock",
        message: securityEventMessage(remoteKeyPackage.securityMeta),
        showForgotPassword: true,
        allowBiometric: false
      };
      render();
      return;
    }
    state.appState = {
      ...state.appState,
      googleDrive: {
        ...state.appState.googleDrive,
        connected: true,
        syncStatus: "synced",
        lastSyncAt: new Date().toISOString(),
        accountEmail: currentDriveAccountEmail(),
        simulated: isSimulatedDrive()
      }
    };
    await setItem("appState", state.appState);
    await syncNow({ silent: true });
    alert(`已重新連結 Google Drive（${driveProviderLabel()}）`);
    render();
    return;
  }
  const driveFiles = await listDriveFiles();
  if (driveFiles.hasKeyPackage && driveFiles.hasVault && state.appState && state.vault && state.appState.mode !== "driveSync") {
    navigate({ name: "driveCloudChoice" });
    return;
  }
  if (!state.appState || !state.vault) {
    if (driveFiles.hasKeyPackage && driveFiles.hasVault) {
      navigate({ name: "driveExistingUnlock" });
      return;
    }
  }
  if (!state.appState || !state.vault) {
    const deviceId = createDeviceId();
    const vault = createEmptyVault(deviceId);
    state.appState = {
      schemaVersion: 1,
      mode: "localOnly",
      deviceId,
      currentVaultId: vault.vaultId,
      ui: {
        themeId: currentThemeId()
      },
      googleDrive: {
        connected: false,
        syncStatus: "disabled"
      }
    };
    state.vault = vault;
  }
  navigate({ name: "driveIntro" });
}

function useLocalDataForDriveSetup() {
  navigate({ name: "driveIntro", mode: "createFromLocal" });
}

function cancelDriveSetup() {
  navigate({ name: state.driveSetupCancelTo ?? "settings" });
}

async function save() {
  await setItem("appState", state.appState);
  await saveLocalVault(state.vault);
  try {
    await saveEncryptedVaultEnvelope();
  } catch (error) {
    markDriveSyncIssue(error);
  }
}

async function ensureLocalVaultStorageKey() {
  let key = await getItem("localVaultStorageKey");
  if (!key) {
    key = await createLocalStorageKey();
    await setItem("localVaultStorageKey", key);
  }
  return key;
}

async function loadLocalVault() {
  const plaintextVault = await getItem("vault");
  if (plaintextVault) {
    await saveLocalVault(plaintextVault);
    return plaintextVault;
  }
  const envelope = await getItem("localVaultEnvelope");
  if (!envelope) return null;
  const key = await getItem("localVaultStorageKey");
  if (!key) throw new Error("local-vault-key-missing");
  return decryptLocalEnvelope(envelope, key);
}

async function saveLocalVault(vault) {
  if (!vault) return;
  const key = await ensureLocalVaultStorageKey();
  const envelope = await encryptLocalEnvelope(vault, key, "local-vault");
  await setItem("localVaultEnvelope", envelope);
  await removeItem("vault");
}

async function loadLocalSnapshots() {
  const plaintextSnapshots = await getItem("localSnapshots");
  if (plaintextSnapshots) {
    await saveLocalSnapshots(plaintextSnapshots);
    return plaintextSnapshots;
  }
  const envelope = await getItem("localSnapshotsEnvelope");
  if (!envelope) return [];
  const key = await getItem("localVaultStorageKey");
  if (!key) return [];
  return decryptLocalEnvelope(envelope, key);
}

async function saveLocalSnapshots(snapshots) {
  const key = await ensureLocalVaultStorageKey();
  const envelope = await encryptLocalEnvelope(snapshots ?? [], key, "local-snapshots");
  await setItem("localSnapshotsEnvelope", envelope);
  await removeItem("localSnapshots");
}

async function commitVault(vault, options = {}) {
  const nextVault = normalizeVault(vault);
  try {
    await createLocalSnapshot("修改前自動快照");
  } catch (error) {
    console.warn("建立本機快照失敗，已略過此次快照。", error);
  }
  state.vault = touchVault(nextVault, state.appState.deviceId);
  markLocalVaultChanged();
  await save();
  if (options.render !== false) render();
}

async function setupMasterPassword(event) {
  event.preventDefault();
  const draft = state.route.passwordDraft ?? { password: "", confirm: "" };
  const isRebuildCloudFromBackup = state.route.mode === "rebuildCloudFromBackup";
  if (draft.password.length < 6) {
    alert("密碼至少需要 6 個字元");
    return;
  }
  if (draft.password !== draft.confirm) {
    alert("兩次輸入的密碼不一致");
    return;
  }
  if (isRebuildCloudFromBackup) {
    const summary = vaultDataSummary();
    const confirmed = confirm(
      `確定要使用本機備份重建雲端資料嗎？\n\n目前本機資料：人物 ${summary.peopleCount} 位\n\n此操作會用目前本機資料覆蓋 Google Drive 中既有的莫忘同步資料，舊密碼與舊救援碼將失效。完成後請務必保存新的救援碼。`
    );
    if (!confirmed) return;
  }

  const result = await createKeyPackage({
    vaultId: state.vault.vaultId,
    deviceId: state.appState.deviceId,
    masterPassword: draft.password
  });
  state.dekBytes = result.dekBytes;
  await setItem("keyPackage", result.keyPackage);
  await setItem("trustedSession", result.trustedSession);

  state.appState = {
    ...state.appState,
    mode: "driveSync",
    googleDrive: {
      connected: true,
      syncStatus: "synced",
      lastSyncAt: new Date().toISOString(),
      accountEmail: currentDriveAccountEmail(),
      simulated: isSimulatedDrive()
    }
  };
  await save();
  try {
    await uploadKeyPackageToDrive();
    await uploadCurrentVaultToDrive();
  } catch (error) {
    markDriveSyncIssue(error);
    alert(driveErrorMessage(error, "密碼與救援碼已在本機建立，但寫入 Google Drive 失敗。請不要刪除本機資料，稍後到設定頁按「立即同步」。"));
  }
  showRecoveryCodeRoute(result.recoveryCode, { returnTo: { name: "home" } });
}

function finishRecoveryCode() {
  navigate(state.route.returnTo ?? { name: "home" }, { replace: true, force: true });
}

function showRecoveryCodeRoute(recoveryCode, options = {}) {
  state.route = {
    name: "showRecoveryCode",
    recoveryCode,
    oldInvalid: Boolean(options.oldInvalid),
    returnTo: options.returnTo ?? { name: "home" }
  };
  render();
}

async function getKeyPackage() {
  return getItem("keyPackage");
}

async function getCurrentKeyPackage() {
  const localKeyPackage = await getKeyPackage();
  if (!state.appState?.googleDrive?.connected) return localKeyPackage;
  if (!driveAuthStatus().hasAccessToken) return localKeyPackage;
  let remoteKeyPackage = null;
  try {
    remoteKeyPackage = await readDriveFile(driveFileName("keyPackage"));
  } catch (error) {
    markDriveSyncIssue(error);
  }
  if (!remoteKeyPackage) return localKeyPackage;
  if ((remoteKeyPackage.securityMeta?.sessionEpoch ?? 0) >= (localKeyPackage?.securityMeta?.sessionEpoch ?? 0)) {
    return remoteKeyPackage;
  }
  return localKeyPackage;
}

async function unwrapCurrentDek(secret, wrapperName = "masterPasswordWrapper") {
  const keyPackage = await getCurrentKeyPackage();
  if (!keyPackage) throw new Error("missing-key-package");
  const wrapper = keyPackage[wrapperName];
  const iterations = keyPackage.crypto.iterations;
  const dekBytes = await unwrapDek(wrapper, secret, iterations);
  state.dekBytes = dekBytes;
  await setItem("keyPackage", keyPackage);
  return { keyPackage, dekBytes };
}

async function saveEncryptedVaultEnvelope() {
  if (state.appState?.mode !== "driveSync" || !state.vault || !state.dekBytes) return;
  const envelope = await encryptVaultEnvelope(state.vault, state.dekBytes);
  await setItem("encryptedVaultEnvelope", envelope);
  return envelope;
}

async function verifySensitiveOperation(actionLabel) {
  let keyPackage = null;
  try {
    keyPackage = await getCurrentKeyPackage();
  } catch {
    keyPackage = await getKeyPackage();
  }
  if (!keyPackage?.masterPasswordWrapper) {
    return confirm(`「${actionLabel}」屬於敏感操作，但此裝置尚未設定密碼，無法進行密碼驗證。\n\n若此裝置只有本機資料，請確認周遭環境安全後再繼續。`);
  }
  const password = await passwordConfirmDialog(actionLabel);
  if (password === null) return false;
  try {
    await unwrapCurrentDek(password);
    return true;
  } catch {
    alert("密碼不正確，已取消操作。");
    return false;
  }
}

function passwordConfirmDialog(actionLabel) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    overlay.innerHTML = `
      <form class="modal-card stack" data-sensitive-password-form>
        <h2 class="section-title">密碼驗證</h2>
        <p class="muted">「${escapeHtml(actionLabel)}」屬於敏感操作，請輸入密碼以繼續。</p>
        <div class="field">
          <label>密碼</label>
          <input type="password" data-sensitive-password autocomplete="current-password" />
        </div>
        <div class="actions modal-actions">
          <button type="submit">確認</button>
          <button type="button" class="secondary" data-sensitive-password-cancel>取消</button>
        </div>
      </form>
    `;
    const cleanup = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cleanup(null);
    });
    overlay.querySelector("[data-sensitive-password-cancel]").addEventListener("click", () => cleanup(null));
    overlay.querySelector("[data-sensitive-password-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      cleanup(overlay.querySelector("[data-sensitive-password]").value);
    });
    document.body.append(overlay);
    overlay.querySelector("[data-sensitive-password]").focus();
  });
}

async function uploadKeyPackageToDrive() {
  if (!state.appState?.googleDrive?.connected) return;
  const keyPackage = await getKeyPackage();
  if (keyPackage) await writeDriveFile(driveFileName("keyPackage"), keyPackage);
}

async function uploadCurrentVaultToDrive() {
  if (!state.dekBytes) return;
  const envelope = await saveEncryptedVaultEnvelope();
  if (state.appState?.googleDrive?.connected && envelope) {
    await writeDriveFile(driveFileName("vault"), envelope);
  }
}

async function unlockExistingDriveVault(event) {
  event.preventDefault();
  const password = state.route.securityDraft?.password ?? "";
  const keyPackage = await readDriveFile(driveFileName("keyPackage"));
  const vaultEnvelope = await readDriveFile(driveFileName("vault"));
  if (!keyPackage || !vaultEnvelope) {
    alert("尚未找到既有同步資料");
    return;
  }
  try {
    const dekBytes = await unwrapDek(keyPackage.masterPasswordWrapper, password, keyPackage.crypto.iterations);
    const vault = await decryptVaultEnvelope(vaultEnvelope, dekBytes);
    const deviceId = createDeviceId();
    state.appState = {
      schemaVersion: 1,
      mode: "driveSync",
      deviceId,
      currentVaultId: vault.vaultId,
      googleDrive: {
        connected: true,
        syncStatus: "synced",
        lastSyncAt: new Date().toISOString(),
        accountEmail: currentDriveAccountEmail(),
        simulated: isSimulatedDrive()
      }
    };
    state.dekBytes = dekBytes;
    state.vault = normalizeVault(pruneDeleted(vault));
    await setItem("keyPackage", keyPackage);
    await setItem(
      "trustedSession",
      await createTrustedSessionWithDek({
        vaultId: keyPackage.vaultId,
        deviceId,
        sessionEpoch: keyPackage.securityMeta.sessionEpoch,
        dekBytes
      })
    );
    await save();
    navigate({ name: "home" }, { replace: true, force: true });
    void resumeDriveSyncInBackground();
  } catch {
    alert("密碼不正確，請再試一次");
  }
}

async function mergeExistingDriveVault(event) {
  event.preventDefault();
  const password = state.route.securityDraft?.password ?? "";
  const keyPackage = await readDriveFile(driveFileName("keyPackage"));
  const vaultEnvelope = await readDriveFile(driveFileName("vault"));
  if (!keyPackage || !vaultEnvelope) {
    alert("尚未找到既有同步資料");
    return;
  }
  let dekBytes;
  let remoteVault;
  try {
    dekBytes = await unwrapDek(keyPackage.masterPasswordWrapper, password, keyPackage.crypto.iterations);
    remoteVault = normalizeVault(pruneDeleted(await decryptVaultEnvelope(vaultEnvelope, dekBytes)));
  } catch {
    alert("密碼不正確，請再試一次");
    return;
  }

  try {
    const localBeforeSync = structuredClone(state.vault);
    const merged = mergeVaults(state.vault, remoteVault, state.appState.deviceId);
    const mergedVault = {
      ...merged.vault,
      vaultId: remoteVault.vaultId
    };
    const syncedAt = new Date().toISOString();

    state.dekBytes = dekBytes;
    state.vault = mergedVault;
    await setItem("keyPackage", keyPackage);
    await setItem(
      "trustedSession",
      await createTrustedSessionWithDek({
        vaultId: keyPackage.vaultId,
        deviceId: state.appState.deviceId,
        sessionEpoch: keyPackage.securityMeta.sessionEpoch,
        dekBytes
      })
    );
    state.appState = {
      ...state.appState,
      mode: "driveSync",
      currentVaultId: remoteVault.vaultId,
      googleDrive: {
        ...state.appState.googleDrive,
        connected: true,
        syncStatus: merged.conflicts.length ? "needsResolution" : "synced",
        lastSyncAt: syncedAt,
        lastLocalChangeAt: "",
        lastSyncError: "",
        accountEmail: currentDriveAccountEmail(),
        lastSyncSummary: buildSyncSummary({ localBeforeSync, remoteVault, mergedVault, conflicts: merged.conflicts, syncedAt }),
        pendingConflicts: merged.conflicts,
        simulated: isSimulatedDrive()
      }
    };
    await save();
    await uploadKeyPackageToDrive();
    await uploadCurrentVaultToDrive();
    alert(syncAlertMessage(state.appState.googleDrive.lastSyncSummary, merged.conflicts.length));
    navigate(merged.conflicts.length ? { name: "syncConflicts" } : { name: "home" }, { replace: true, force: true });
  } catch (error) {
    markDriveSyncIssue(error);
    alert(driveErrorMessage(error, "資料已在本機合併，但 Google Drive 寫回失敗，請稍後再按「立即同步」。"));
    render();
  }
}

async function syncNow(options = {}) {
  if (!state.appState?.googleDrive?.connected) return;
  if (isDriveSyncRecentlyStarted(state.appState.googleDrive)) return;
  if (options.silent && !driveAuthStatus().hasAccessToken) return;
  const previousGoogleDrive = state.appState.googleDrive;
  state.appState = {
    ...state.appState,
    googleDrive: {
      ...state.appState.googleDrive,
      syncStatus: "syncing",
      syncStartedAt: new Date().toISOString(),
      lastSyncError: ""
    }
  };
  await setItem("appState", state.appState);
  render();

  try {
    const driveConnection = await connectDrive({ interactive: !options.silent });
    rememberDriveAccount(driveConnection);
    const remoteEnvelope = await readDriveFile(driveFileName("vault"));
    let conflicts = [];
    const localBeforeSync = structuredClone(state.vault);
    let remoteVault = null;
    if (remoteEnvelope && state.dekBytes) {
      remoteVault = normalizeVault(pruneDeleted(await decryptVaultEnvelope(remoteEnvelope, state.dekBytes)));
      const merged = mergeVaults(state.vault, remoteVault, state.appState.deviceId);
      state.vault = merged.vault;
      conflicts = merged.conflicts;
      await saveLocalVault(state.vault);
    }
    const syncedAt = new Date().toISOString();
    await uploadKeyPackageToDrive();
    await uploadCurrentVaultToDrive();
    state.appState = {
      ...state.appState,
      googleDrive: {
        ...state.appState.googleDrive,
        syncStatus: conflicts.length ? "needsResolution" : "synced",
        lastSyncAt: syncedAt,
        lastLocalChangeAt: "",
        accountEmail: currentDriveAccountEmail(),
        lastSyncSummary: buildSyncSummary({ localBeforeSync, remoteVault, mergedVault: state.vault, conflicts, syncedAt }),
        pendingConflicts: conflicts,
        simulated: isSimulatedDrive(),
        syncStartedAt: "",
        lastSyncError: ""
      }
    };
    await save();
    if (!options.silent) alert(syncAlertMessage(state.appState.googleDrive.lastSyncSummary, conflicts.length));
    if (options.notifyConflicts && conflicts.length) {
      alert("自動同步發現資料衝突，需要處理後才能完成同步。請到設定頁點擊「處理衝突資料」。");
    }
    render();
  } catch (error) {
    const message = driveErrorMessage(error, "同步失敗，請稍後再試");
    if (options.silent && isDriveAuthRequiredError(error)) {
      state.appState = {
        ...state.appState,
        googleDrive: {
          ...previousGoogleDrive,
          syncStatus: previousGoogleDrive.syncStatus === "syncing" ? syncStatusAfterLocalChange(previousGoogleDrive) : previousGoogleDrive.syncStatus,
          syncStartedAt: "",
          lastSyncError: "Google Drive 授權需要重新登入，請按「立即同步」完成授權。"
        }
      };
      await setItem("appState", state.appState);
      render();
      return;
    }
    state.appState = {
      ...state.appState,
      googleDrive: {
        ...state.appState.googleDrive,
        syncStatus: "error",
        syncStartedAt: "",
        lastSyncError: message
      }
    };
    await setItem("appState", state.appState);
    if (!options.silent) alert(message);
    render();
  }
}

async function logoutGoogleDrive() {
  if (!confirm("確定要登出 Google Drive 嗎？\n此裝置將停止與 Google Drive 同步，但不會刪除本機資料或雲端資料。")) return;
  try {
    await disconnectDrive();
  } catch (error) {
    alert(driveErrorMessage(error, "無法撤銷這台裝置的 Google Drive session，請確認網路後再試。"));
    return;
  }
  state.appState = {
    ...state.appState,
    googleDrive: {
      ...state.appState.googleDrive,
      connected: false,
      syncStatus: "disabled",
      accountEmail: ""
    }
  };
  await save();
  render();
}

async function resumeDriveSyncInBackground() {
  if (!state.appState?.googleDrive?.connected || state.route.name !== "home") return;
  if (!driveAuthStatus().hasAccessToken) return;
  try {
    await syncNow({ silent: true, notifyConflicts: true });
  } catch {}
}

async function exportData() {
  if (!state.vault) return;
  if (!(await verifySensitiveOperation("匯出備份檔"))) return;
  const exportedAt = new Date().toISOString();
  const payload = buildExportPayload(exportedAt);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `莫忘-資料備份-${fileDateTime(exportedAt)}.json`);
  await rememberDataManagementEvent("lastJsonExportAt", exportedAt);
}

async function createLocalSnapshot(reason) {
  if (!state.vault) return;
  const vault = normalizeVault(state.vault);
  const createdAt = new Date().toISOString();
  const snapshot = {
    id: `snapshot-${crypto.randomUUID()}`,
    reason,
    createdAt,
    peopleCount: vault.people.length,
    vault: structuredClone(vault)
  };
  state.localSnapshots = [snapshot, ...asArray(state.localSnapshots)].slice(0, 3);
  await saveLocalSnapshots(state.localSnapshots);
}

async function restoreLocalSnapshot(id) {
  const snapshot = state.localSnapshots.find((item) => item.id === id);
  if (!snapshot) return;
  if (!(await verifySensitiveOperation("還原本機資料快照"))) return;
  if (!confirm(`確定要還原 ${formatDateTime(snapshot.createdAt)} 的本機快照嗎？\n目前資料會先自動建立一份快照，再還原到該時間點。`)) return;
  await createLocalSnapshot("還原前自動快照");
  state.vault = normalizeVault(pruneDeleted(snapshot.vault));
  markLocalVaultChanged();
  await save();
  alert("本機快照已還原");
  navigate({ name: "settings" });
}

async function deleteLocalSnapshot(id) {
  const snapshot = state.localSnapshots.find((item) => item.id === id);
  if (!snapshot || !confirm("確定要刪除這份本機快照嗎？")) return;
  if (!(await verifySensitiveOperation("刪除本機資料快照"))) return;
  state.localSnapshots = state.localSnapshots.filter((item) => item.id !== id);
  await saveLocalSnapshots(state.localSnapshots);
  render();
}

async function downloadLocalSnapshot(id) {
  const snapshot = state.localSnapshots.find((item) => item.id === id);
  if (!snapshot) return;
  if (!(await verifySensitiveOperation("下載本機資料快照"))) return;
  const payload = {
    fileType: "forget-me-not-vault-export",
    schemaVersion: 1,
    appName: "莫忘",
    exportedAt: new Date().toISOString(),
    note: "此檔案來自本機快照，只包含人物資料，不包含密碼、資料金鑰或救援碼。",
    vault: snapshot.vault
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `莫忘-本機快照-${fileDateTime(snapshot.createdAt)}.json`);
}

async function exportExcel() {
  if (!state.vault) return;
  if (!(await verifySensitiveOperation("匯出 Excel"))) return;
  const exportedAt = new Date().toISOString();
  const blob = buildVaultXlsx(state.vault, exportedAt);
  downloadBlob(blob, `莫忘-資料匯出-${fileDateTime(exportedAt)}.xlsx`);
  await rememberDataManagementEvent("lastExcelExportAt", exportedAt);
}

function buildExportPayload(exportedAt = new Date().toISOString()) {
  return {
    fileType: "forget-me-not-vault-export",
    schemaVersion: 1,
    appName: "莫忘",
    exportedAt,
    note: "此檔案只包含人物資料，不包含密碼、資料金鑰或救援碼。",
    vault: state.vault
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importDataFile(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!(await verifySensitiveOperation("匯入資料"))) return;
  try {
    const payload = JSON.parse(await file.text());
    const importedVault = readImportVault(payload);
    const importedPeopleCount = importedVault.people.length;
    const importedGroupCount = importedVault.personGroupTags.length;
    const importedTagCount = importedVault.interestTags.length;
    if (
      !confirm(
        `確定要匯入這份資料嗎？\n\n人物：${importedPeopleCount} 位\n人物群組：${importedGroupCount} 個\n興趣喜好：${importedTagCount} 個\n\n匯入會與目前資料合併，不會直接清空現有資料。\n匯入前會先下載一份目前本機資料備份。`
      )
    ) {
      return;
    }
    exportPreImportBackup();
    await createLocalSnapshot("匯入前自動快照");
    const merged = mergeVaults(state.vault, importedVault, state.appState.deviceId);
    state.vault = merged.vault;
    const importedAt = new Date().toISOString();
    const existingConflicts = state.appState.googleDrive.pendingConflicts ?? [];
    state.appState = {
      ...state.appState,
      dataManagement: {
        ...(state.appState.dataManagement ?? {}),
        lastImportAt: importedAt
      },
      googleDrive: {
        ...state.appState.googleDrive,
        syncStatus: merged.conflicts.length || existingConflicts.length ? "needsResolution" : syncStatusAfterLocalChange(state.appState.googleDrive),
        pendingConflicts: [...existingConflicts, ...merged.conflicts],
        lastLocalChangeAt: importedAt,
        lastSyncError: ""
      }
    };
    await save();
    alert(merged.conflicts.length ? "已匯入資料，但有資料衝突需要處理" : "資料匯入完成");
    navigate(merged.conflicts.length ? { name: "syncConflicts" } : { name: "settings" });
  } catch {
    alert("匯入失敗，請確認檔案是否為莫忘的資料備份檔。");
  }
}

function readImportVault(payload) {
  if (payload?.fileType === "forget-me-not-vault-export" && payload.schemaVersion === 1 && payload.vault) {
    return normalizeVault(pruneDeleted(payload.vault));
  }
  if (payload?.schemaVersion === 1 && payload.vaultId && Array.isArray(payload.people)) {
    return normalizeVault(pruneDeleted(payload));
  }
  throw new Error("invalid-import-file");
}

function exportPreImportBackup() {
  const exportedAt = new Date().toISOString();
  const payload = buildExportPayload(exportedAt);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `莫忘-匯入前本機備份-${fileDateTime(exportedAt)}.json`);
}

async function rememberDataManagementEvent(key, value) {
  state.appState = {
    ...state.appState,
    dataManagement: {
      ...(state.appState.dataManagement ?? {}),
      [key]: value
    }
  };
  await setItem("appState", state.appState);
  render();
}

async function unlockWithMasterPassword(event) {
  event.preventDefault();
  const password = state.route.securityDraft?.password ?? "";
  try {
    const { keyPackage, dekBytes } = await unwrapCurrentDek(password);
    await setItem(
      "trustedSession",
      await createTrustedSessionWithDek({
        vaultId: keyPackage.vaultId,
        deviceId: state.appState.deviceId,
        sessionEpoch: keyPackage.securityMeta.sessionEpoch,
        dekBytes
      })
    );
    state.appState = {
      ...state.appState,
      currentVaultId: keyPackage.vaultId
    };
    await save();
    await touchTrustedSessionNow({ force: true });
    navigate({ name: "home" }, { replace: true, force: true });
    void resumeDriveSyncInBackground();
  } catch {
    alert("密碼不正確，請再試一次");
  }
}

async function changeMasterPassword(event) {
  event.preventDefault();
  const draft = state.route.securityDraft ?? {};
  if (!validateNewPassword(draft.newPassword, draft.confirmPassword)) return;
  try {
    const { keyPackage, dekBytes } = await unwrapCurrentDek(draft.currentPassword);
    const now = new Date().toISOString();
    const masterPasswordWrapper = await wrapDekForSecret(dekBytes, draft.newPassword, keyPackage.crypto.iterations);
    const updatedKeyPackage = {
      ...keyPackage,
      masterPasswordWrapper: {
        ...masterPasswordWrapper,
        updatedByDeviceId: state.appState.deviceId
      },
      securityMeta: {
        ...keyPackage.securityMeta,
        passwordChangedAt: now,
        passwordChangedByDeviceId: state.appState.deviceId,
        sessionEpoch: keyPackage.securityMeta.sessionEpoch + 1,
        updatedAt: now
      }
    };
    await setItem("keyPackage", updatedKeyPackage);
    await uploadKeyPackageToDrive();
    await setItem(
      "trustedSession",
      await createTrustedSessionWithDek({
        vaultId: updatedKeyPackage.vaultId,
        deviceId: state.appState.deviceId,
        sessionEpoch: updatedKeyPackage.securityMeta.sessionEpoch,
        dekBytes
      })
    );
    alert("密碼已更新");
    navigate({ name: "settings" }, { replace: true, force: true });
  } catch {
    alert("目前密碼不正確，請再試一次");
  }
}

async function resetForgottenPassword(event) {
  event.preventDefault();
  const draft = state.route.securityDraft ?? {};
  if (!validateNewPassword(draft.newPassword, draft.confirmPassword)) return;
  try {
    const recoveryCode = normalizeRecoveryCode(draft.recoveryCode ?? "");
    const currentKeyPackage = await getCurrentKeyPackage();
    if (isRecoveryV2(currentKeyPackage)) {
      alert("此 vault 已使用 Recovery v2。請在新裝置連結相同的 Google Drive 後，從「忘記密碼」建立舊裝置核准請求。");
      return;
    }
    const { keyPackage, dekBytes } = await unwrapCurrentDek(recoveryCode, "recoveryCodeWrapper");
    const updated = await replaceMasterPasswordAndRecovery(keyPackage, dekBytes, draft.newPassword, true);
    await uploadKeyPackageToDrive();
    showRecoveryCodeRoute(updated.recoveryCode, { oldInvalid: true, returnTo: { name: "settings" } });
  } catch {
    alert("救援碼不正確，請確認後再試一次");
  }
}

async function resetCloudPasswordWithRecovery(event) {
  event.preventDefault();
  const draft = state.route.securityDraft ?? {};
  if (!validateNewPassword(draft.newPassword, draft.confirmPassword)) return;
  const mode = state.route.mode === "merge" ? "merge" : "existing";
  const recoveryCode = normalizeRecoveryCode(draft.recoveryCode ?? "");
  let keyPackage;
  let vaultEnvelope;
  let dekBytes;
  let remoteVault;
  try {
    keyPackage = await readDriveFile(driveFileName("keyPackage"));
    vaultEnvelope = await readDriveFile(driveFileName("vault"));
    if (!keyPackage || !vaultEnvelope) {
      alert("尚未找到既有同步資料");
      return;
    }
    if (isRecoveryV2(keyPackage)) {
      if (!(await verifyRecoveryAuthorizationVerifier(keyPackage.recoveryAuthorizationVerifier, recoveryCode))) {
        alert("救援碼不正確，請確認後再試一次");
        return;
      }
      await beginDeviceApprovalRequest(keyPackage.vaultId, mode);
      return;
    }
    dekBytes = await unwrapDek(keyPackage.recoveryCodeWrapper, recoveryCode, keyPackage.crypto.iterations);
    remoteVault = normalizeVault(pruneDeleted(await decryptVaultEnvelope(vaultEnvelope, dekBytes)));
  } catch {
    alert("救援碼不正確，請確認後再試一次");
    return;
  }

  const deviceId = state.appState?.deviceId ?? createDeviceId();
  const updated = await buildReplacedMasterPasswordAndRecovery({
    keyPackage,
    dekBytes,
    newPassword: draft.newPassword,
    deviceId,
    bumpSession: true
  });
  let finalVault = remoteVault;
  let conflicts = [];
  let localBeforeSync = null;
  if (mode === "merge" && state.appState && state.vault) {
    localBeforeSync = structuredClone(state.vault);
    const merged = mergeVaults(state.vault, remoteVault, deviceId);
    finalVault = {
      ...merged.vault,
      vaultId: remoteVault.vaultId
    };
    conflicts = merged.conflicts;
  }
  const syncedAt = new Date().toISOString();
  state.dekBytes = dekBytes;
  state.vault = normalizeVault(pruneDeleted(finalVault));
  state.appState = {
    schemaVersion: state.appState?.schemaVersion ?? 1,
    mode: "driveSync",
    deviceId,
    currentVaultId: remoteVault.vaultId,
    ui: {
      themeId: currentThemeId()
    },
    ...(state.appState ?? {}),
    mode: "driveSync",
    deviceId,
    currentVaultId: remoteVault.vaultId,
    googleDrive: {
      ...(state.appState?.googleDrive ?? {}),
      connected: true,
      syncStatus: conflicts.length ? "needsResolution" : "synced",
      lastSyncAt: syncedAt,
      lastLocalChangeAt: "",
      lastSyncError: "",
      accountEmail: currentDriveAccountEmail(),
      lastSyncSummary: buildSyncSummary({ localBeforeSync, remoteVault, mergedVault: state.vault, conflicts, syncedAt }),
      pendingConflicts: conflicts,
      simulated: isSimulatedDrive()
    }
  };
  await setItem("keyPackage", updated.keyPackage);
  await setItem(
    "trustedSession",
    await createTrustedSessionWithDek({
      vaultId: updated.keyPackage.vaultId,
      deviceId,
      sessionEpoch: updated.keyPackage.securityMeta.sessionEpoch,
      dekBytes
    })
  );
  await save();
  await uploadKeyPackageToDrive();
  if (mode === "merge") await uploadCurrentVaultToDrive();
  showRecoveryCodeRoute(updated.recoveryCode, {
    oldInvalid: true,
    returnTo: conflicts.length ? { name: "syncConflicts" } : { name: "home" }
  });
}

async function startDeviceApprovalRecovery(event) {
  event.preventDefault();
  const draft = state.route.securityDraft ?? {};
  if (!validateNewPassword(draft.newPassword, draft.confirmPassword)) return;
  try {
    const keyPackage = await readDriveFile(driveFileName("keyPackage"));
    if (!keyPackage?.vaultId) throw new Error("missing-key-package");
    await beginDeviceApprovalRequest(keyPackage.vaultId, state.route.mode === "merge" ? "merge" : "existing");
  } catch (error) { alert(driveErrorMessage(error, "無法建立舊裝置授權請求。請先完成 Google Drive 連結。")); }
}

async function beginDeviceApprovalRequest(vaultId, mode) {
  const pairingCode = recoveryPairingCode();
  const request = await createDriveRecoveryRequest({ vaultId, requesterDeviceId: state.appState?.deviceId ?? createDeviceId(), pairingCode });
  state.route = { name: "recoveryPending", recoveryRequestId: request.requestId, pairingCode, mode };
  render();
}

async function checkRecoveryRequest() {
  try {
    const result = await getDriveRecoveryRequest(state.route.recoveryRequestId);
    if (result.request?.status === "approved") {
      state.route = { name: "recoveryComplete", mode: state.route.mode };
      render();
      return;
    }
    if (result.request?.status === "expired") alert("此救援請求已逾時，請重新開始。");
    else alert("舊裝置尚未核准此請求。");
  } catch (error) { alert(driveErrorMessage(error, "無法讀取救援請求狀態。")); }
}

async function completeRecoveryV2(event) {
  event.preventDefault();
  const draft = state.route.securityDraft ?? {};
  const mode = state.route.mode === "merge" ? "merge" : "existing";
  if (!validateNewPassword(draft.newPassword, draft.confirmPassword)) return;
  try {
    const keyPackage = await readDriveFile(driveFileName("keyPackage"));
    const vaultEnvelope = await readDriveFile(driveFileName("vault"));
    const dekBytes = await unwrapDek(keyPackage.masterPasswordWrapper, draft.newPassword, keyPackage.crypto.iterations);
    const remoteVault = normalizeVault(pruneDeleted(await decryptVaultEnvelope(vaultEnvelope, dekBytes)));
    const deviceId = state.appState?.deviceId ?? createDeviceId();
    const localBeforeSync = mode === "merge" && state.vault ? structuredClone(state.vault) : null;
    const merged = localBeforeSync ? mergeVaults(localBeforeSync, remoteVault, deviceId) : null;
    const finalVault = merged ? { ...merged.vault, vaultId: remoteVault.vaultId } : remoteVault;
    const conflicts = merged?.conflicts ?? [];
    state.dekBytes = dekBytes;
    state.vault = normalizeVault(pruneDeleted(finalVault));
    state.appState = {
      schemaVersion: 1, mode: "driveSync", deviceId, currentVaultId: remoteVault.vaultId,
      ui: { themeId: currentThemeId() }, ...(state.appState ?? {}), mode: "driveSync", deviceId, currentVaultId: remoteVault.vaultId,
      googleDrive: { ...(state.appState?.googleDrive ?? {}), connected: true, syncStatus: conflicts.length ? "needsResolution" : "synced", lastSyncAt: new Date().toISOString(), lastLocalChangeAt: "", lastSyncError: "", accountEmail: currentDriveAccountEmail(), pendingConflicts: conflicts, simulated: isSimulatedDrive() }
    };
    await setItem("keyPackage", keyPackage);
    await setItem("trustedSession", await createTrustedSessionWithDek({ vaultId: keyPackage.vaultId, deviceId, sessionEpoch: keyPackage.securityMeta.sessionEpoch, dekBytes }));
    await save();
    if (merged) await uploadCurrentVaultToDrive();
    navigate(conflicts.length ? { name: "syncConflicts" } : { name: "home" }, { replace: true, force: true });
  } catch { alert("舊裝置尚未用相同的新密碼完成核准，或新密碼不正確。"); }
}

async function refreshRecoveryRequests() {
  try {
    const result = await listDriveRecoveryRequests();
    state.route = { name: "recoveryRequests", requests: result.requests ?? [] };
    render();
  } catch (error) { alert(driveErrorMessage(error, "無法讀取救援請求。")); }
}

async function approveRecoveryRequest(requestId, pairingCode) {
  if (!state.dekBytes) { alert("此裝置必須維持已解鎖狀態才能核准救援。 "); return; }
  if (!confirm(`請確認新裝置顯示的配對碼也是「${pairingCode}」。核准後請在此裝置輸入新裝置設定的相同新密碼。`)) return;
  const newPassword = await recoveryNewPasswordDialog();
  if (newPassword === null) return;
  try {
    const keyPackage = await getCurrentKeyPackage();
    const updated = await buildReplacedMasterPasswordAndRecovery({ keyPackage, dekBytes: state.dekBytes, newPassword, deviceId: state.appState.deviceId, bumpSession: true });
    await setItem("keyPackage", updated.keyPackage);
    await uploadKeyPackageToDrive();
    await approveDriveRecoveryRequest(requestId, { approverDeviceId: state.appState.deviceId, sessionEpoch: updated.keyPackage.securityMeta.sessionEpoch });
    await setItem("trustedSession", await createTrustedSessionWithDek({ vaultId: updated.keyPackage.vaultId, deviceId: state.appState.deviceId, sessionEpoch: updated.keyPackage.securityMeta.sessionEpoch, dekBytes: state.dekBytes }));
    showRecoveryCodeRoute(updated.recoveryCode, { oldInvalid: true, returnTo: { name: "settings" } });
  } catch (error) { alert(driveErrorMessage(error, "無法核准救援請求，請稍後再試。")); }
}

function recoveryNewPasswordDialog() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    overlay.innerHTML = `
      <form class="modal-card stack" data-recovery-new-password-form>
        <h2 class="section-title">設定新密碼</h2>
        <p class="muted">請輸入新裝置已設定的相同新密碼。密碼只在此裝置用來重包資料金鑰，不會傳送到網路。</p>
        <div class="field"><label>新密碼</label><input type="password" data-recovery-new-password autocomplete="new-password" /></div>
        <div class="field"><label>再次輸入新密碼</label><input type="password" data-recovery-new-password-confirm autocomplete="new-password" /></div>
        <p class="danger-text" data-recovery-new-password-error hidden></p>
        <div class="actions modal-actions"><button type="submit">確認核准</button><button type="button" class="secondary" data-recovery-new-password-cancel>取消</button></div>
      </form>
    `;
    const cleanup = (value) => { overlay.remove(); resolve(value); };
    overlay.addEventListener("click", (event) => { if (event.target === overlay) cleanup(null); });
    overlay.querySelector("[data-recovery-new-password-cancel]").addEventListener("click", () => cleanup(null));
    overlay.querySelector("[data-recovery-new-password-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      const password = overlay.querySelector("[data-recovery-new-password]").value;
      const confirmation = overlay.querySelector("[data-recovery-new-password-confirm]").value;
      const error = overlay.querySelector("[data-recovery-new-password-error]");
      const message = password.length < 6 ? "密碼至少需要 6 個字元" : (password !== confirmation ? "兩次輸入的密碼不一致" : "");
      if (message) { error.textContent = message; error.hidden = false; return; }
      cleanup(password);
    });
    document.body.append(overlay);
    overlay.querySelector("[data-recovery-new-password]").focus();
  });
}

function isRecoveryV2(keyPackage) { return keyPackage?.recoveryAuthorizationVerifier?.version === 2; }
function recoveryPairingCode() { return crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase(); }

async function scanDriveRevisionRecovery(event) {
  event.preventDefault();
  const draft = state.route.securityDraft ?? {};
  if (!validateNewPassword(draft.newPassword, draft.confirmPassword)) return;
  const credentialType = draft.credentialType === "recoveryCode" ? "recoveryCode" : "password";
  const secret = credentialType === "recoveryCode" ? normalizeRecoveryCode(draft.secret ?? "") : (draft.secret ?? "");
  if (!secret) {
    alert(credentialType === "recoveryCode" ? "請輸入救援碼" : "請輸入原密碼");
    return;
  }
  state.route.revisionRecoveryReport = {
    status: "running",
    message: "正在掃描 Google Drive 歷史版本…",
    attempts: []
  };
  state.route.revisionRecoveryCandidate = null;
  render();
  try {
    await connectDrive({ interactive: true });
    const keyCandidates = await driveRevisionCandidates("keyPackage");
    const vaultCandidates = await driveRevisionCandidates("vault");
    const attempts = [];
    for (const keyCandidate of keyCandidates) {
      let keyPackage;
      let dekBytes;
      try {
        keyPackage = await keyCandidate.read();
        const wrapper = credentialType === "recoveryCode" ? keyPackage?.recoveryCodeWrapper : keyPackage?.masterPasswordWrapper;
        if (!wrapper || !keyPackage?.crypto?.iterations) throw new Error("invalid-key-package");
        dekBytes = await unwrapDek(wrapper, secret, keyPackage.crypto.iterations);
        attempts.push(`金鑰檔 ${revisionLabel(keyCandidate)}：可解開`);
      } catch {
        attempts.push(`金鑰檔 ${revisionLabel(keyCandidate)}：不可用`);
        continue;
      }
      for (const vaultCandidate of vaultCandidates) {
        try {
          const envelope = await vaultCandidate.read();
          const vault = normalizeVault(pruneDeleted(await decryptVaultEnvelope(envelope, dekBytes)));
          state.route.revisionRecoveryCandidate = {
            keyPackage,
            vault,
            dekBytes,
            keyRevision: revisionSummary(keyCandidate),
            vaultRevision: revisionSummary(vaultCandidate)
          };
          state.route.revisionRecoveryReport = {
            status: "success",
            message: `找到可救援版本：人物 ${vault.people.length} 位。請確認後重建雲端同步資料。`,
            attempts,
            keyRevision: revisionSummary(keyCandidate),
            vaultRevision: revisionSummary(vaultCandidate)
          };
          render();
          return;
        } catch {
          attempts.push(`資料檔 ${revisionLabel(vaultCandidate)}：無法搭配此金鑰解開`);
        }
      }
    }
    state.route.revisionRecoveryReport = {
      status: "error",
      message: "沒有找到可用的歷史版本。可能是 Google Drive 未保留可下載舊版，或輸入的原密碼／救援碼與所有版本都不相符。",
      attempts
    };
    render();
  } catch (error) {
    state.route.revisionRecoveryReport = {
      status: "error",
      message: driveErrorMessage(error, "雲端歷史版本掃描失敗，請稍後再試。"),
      attempts: state.route.revisionRecoveryReport?.attempts ?? []
    };
    render();
  }
}

async function applyDriveRevisionRecovery() {
  const candidate = state.route.revisionRecoveryCandidate;
  const draft = state.route.securityDraft ?? {};
  if (!candidate) {
    alert("尚未找到可用的歷史版本");
    return;
  }
  if (!validateNewPassword(draft.newPassword, draft.confirmPassword)) return;
  const confirmed = confirm(
    `確定要使用找到的歷史版本重建雲端同步資料嗎？\n\n金鑰檔：${candidate.keyRevision.label}\n資料檔：${candidate.vaultRevision.label}\n人物：${candidate.vault.people.length} 位\n\n此操作會覆蓋目前 Google Drive 中的莫忘同步資料，並產生新的密碼與救援碼。`
  );
  if (!confirmed) return;
  const deviceId = state.appState?.deviceId ?? createDeviceId();
  const updated = await buildReplacedMasterPasswordAndRecovery({
    keyPackage: candidate.keyPackage,
    dekBytes: candidate.dekBytes,
    newPassword: draft.newPassword,
    deviceId,
    bumpSession: true
  });
  const syncedAt = new Date().toISOString();
  state.dekBytes = candidate.dekBytes;
  state.vault = normalizeVault(pruneDeleted(candidate.vault));
  state.appState = {
    ...(state.appState ?? {}),
    schemaVersion: state.appState?.schemaVersion ?? 1,
    mode: "driveSync",
    deviceId,
    currentVaultId: state.vault.vaultId,
    ui: {
      themeId: currentThemeId()
    },
    googleDrive: {
      ...(state.appState?.googleDrive ?? {}),
      connected: true,
      syncStatus: "synced",
      lastSyncAt: syncedAt,
      lastLocalChangeAt: "",
      lastSyncError: "",
      accountEmail: currentDriveAccountEmail(),
      lastSyncSummary: buildSyncSummary({ localBeforeSync: null, remoteVault: candidate.vault, mergedVault: state.vault, conflicts: [], syncedAt }),
      pendingConflicts: [],
      simulated: isSimulatedDrive()
    }
  };
  await setItem("keyPackage", updated.keyPackage);
  await setItem(
    "trustedSession",
    await createTrustedSessionWithDek({
      vaultId: updated.keyPackage.vaultId,
      deviceId,
      sessionEpoch: updated.keyPackage.securityMeta.sessionEpoch,
      dekBytes: candidate.dekBytes
    })
  );
  await save();
  await uploadKeyPackageToDrive();
  await uploadCurrentVaultToDrive();
  showRecoveryCodeRoute(updated.recoveryCode, {
    oldInvalid: true,
    returnTo: { name: "home" }
  });
}

async function regenerateRecoveryCode(event) {
  event.preventDefault();
  const draft = state.route.securityDraft ?? {};
  try {
    const { keyPackage, dekBytes } = await unwrapCurrentDek(draft.currentPassword);
    const updated = await replaceRecoveryCode(keyPackage, dekBytes);
    await uploadKeyPackageToDrive();
    showRecoveryCodeRoute(updated.recoveryCode, { oldInvalid: true, returnTo: { name: "settings" } });
  } catch {
    alert("目前密碼不正確，請再試一次");
  }
}

async function logoutAllDevices(event) {
  event.preventDefault();
  const draft = state.route.securityDraft ?? {};
  try {
    const { keyPackage } = await unwrapCurrentDek(draft.currentPassword);
    const now = new Date().toISOString();
    const updatedKeyPackage = {
      ...keyPackage,
      securityMeta: {
        ...keyPackage.securityMeta,
        sessionEpoch: keyPackage.securityMeta.sessionEpoch + 1,
        globalLogoutAt: now,
        updatedAt: now
      }
    };
    await setItem("keyPackage", updatedKeyPackage);
    await uploadKeyPackageToDrive();
    await removeItem("trustedSession");
    navigate({ name: "unlock", message: "已從所有裝置登出，請重新輸入密碼", showForgotPassword: true, allowBiometric: false }, { replace: true, force: true });
  } catch {
    alert("目前密碼不正確，請再試一次");
  }
}

function validateNewPassword(password = "", confirm = "") {
  if (password.length < 6) {
    alert("密碼至少需要 6 個字元");
    return false;
  }
  if (password !== confirm) {
    alert("兩次輸入的密碼不一致");
    return false;
  }
  return true;
}

async function replaceMasterPasswordAndRecovery(keyPackage, dekBytes, newPassword, bumpSession) {
  const updated = await buildReplacedMasterPasswordAndRecovery({
    keyPackage,
    dekBytes,
    newPassword,
    deviceId: state.appState.deviceId,
    bumpSession
  });
  const updatedKeyPackage = updated.keyPackage;
  await setItem("keyPackage", updatedKeyPackage);
  await setItem(
    "trustedSession",
    await createTrustedSessionWithDek({
      vaultId: updatedKeyPackage.vaultId,
      deviceId: state.appState.deviceId,
      sessionEpoch: updatedKeyPackage.securityMeta.sessionEpoch,
      dekBytes
    })
  );
  return updated;
}

async function buildReplacedMasterPasswordAndRecovery({ keyPackage, dekBytes, newPassword, deviceId, bumpSession }) {
  const now = new Date().toISOString();
  const recoveryCode = generateRecoveryCode();
  const masterPasswordWrapper = await wrapDekForSecret(dekBytes, newPassword, keyPackage.crypto.iterations);
  const recoveryAuthorizationVerifier = await createRecoveryAuthorizationVerifier(recoveryCode, keyPackage.crypto.iterations);
  const sessionEpoch = bumpSession ? (keyPackage.securityMeta?.sessionEpoch ?? 1) + 1 : (keyPackage.securityMeta?.sessionEpoch ?? 1);
  const recoveryCodeVersion = keyPackage.recoveryAuthorizationVerifier?.recoveryCodeVersion ?? keyPackage.recoveryCodeWrapper?.recoveryCodeVersion ?? 1;
  const { recoveryCodeWrapper, ...withoutLegacyRecoveryWrapper } = keyPackage;
  return {
    recoveryCode,
    keyPackage: {
      ...withoutLegacyRecoveryWrapper,
      masterPasswordWrapper: {
        ...masterPasswordWrapper,
        updatedByDeviceId: deviceId
      },
      recoveryAuthorizationVerifier: {
        ...recoveryAuthorizationVerifier,
        recoveryCodeVersion: recoveryCodeVersion + 1,
        updatedByDeviceId: deviceId
      },
      securityMeta: {
        ...(keyPackage.securityMeta ?? {}),
        passwordChangedAt: now,
        passwordChangedByDeviceId: deviceId,
        sessionEpoch,
        updatedAt: now
      }
    }
  };
}

async function replaceRecoveryCode(keyPackage, dekBytes) {
  const recoveryCode = generateRecoveryCode();
  const now = new Date().toISOString();
  const recoveryAuthorizationVerifier = await createRecoveryAuthorizationVerifier(recoveryCode, keyPackage.crypto.iterations);
  const { recoveryCodeWrapper, ...withoutLegacyRecoveryWrapper } = keyPackage;
  const updatedKeyPackage = {
    ...withoutLegacyRecoveryWrapper,
    recoveryAuthorizationVerifier: {
      ...recoveryAuthorizationVerifier,
      recoveryCodeVersion: (keyPackage.recoveryAuthorizationVerifier?.recoveryCodeVersion ?? keyPackage.recoveryCodeWrapper?.recoveryCodeVersion ?? 1) + 1,
      updatedByDeviceId: state.appState.deviceId
    },
    securityMeta: {
      ...keyPackage.securityMeta,
      updatedAt: now
    }
  };
  await setItem("keyPackage", updatedKeyPackage);
  return { keyPackage: updatedKeyPackage, recoveryCode };
}

function confirmBeforeLeavingCurrentRoute(targetRoute = {}, options = {}) {
  if (options.force) return true;
  if (isSameRoute(state.route, targetRoute)) return true;
  if (state.route.name === "showRecoveryCode") {
    const leave = confirm("離開此畫面後將不再顯示此救援碼，確定已妥善保存嗎？");
    if (!leave && options.viaHistory) cancelHistoryBack();
    if (leave && options.viaHistory) {
      const fallbackRoute = state.route.returnTo ?? { name: "home" };
      state.route = prepareRouteForNavigation(fallbackRoute);
      render({ restoreScroll: true });
      writeHistoryRoute(state.route, { replace: true, force: true });
      return false;
    }
    return leave;
  }
  if (isPersonFormDirty()) {
    const leave = confirm("尚未儲存變更，確定要離開嗎？");
    if (!leave && options.viaHistory) cancelHistoryBack();
    return leave;
  }
  if (hasPendingSecurityOperation()) {
    const leave = confirm("尚未完成操作，確定要離開嗎？");
    if (!leave && options.viaHistory) cancelHistoryBack();
    return leave;
  }
  return true;
}

function cancelHistoryBack() {
  state.ignoreNextPopstate = true;
  history.forward();
}

function hasPendingRouteWork() {
  return state.route.name === "showRecoveryCode" || isPersonFormDirty() || hasPendingSecurityOperation();
}

function isSameRoute(current = {}, next = {}) {
  return current.name === next.name && current.id === next.id;
}

function isPersonFormDirty() {
  if (!["new", "edit"].includes(state.route.name)) return false;
  if (!state.route.draft || !state.route.draftBaseline) return false;
  return personDraftSignature(state.route.draft) !== state.route.draftBaseline;
}

function personDraftSignature(draft) {
  const normalized = normalizeDraft(structuredClone(draft));
  return JSON.stringify({
    id: normalized.id,
    name: normalized.name ?? "",
    nickname: normalized.nickname ?? "",
    gender: normalized.gender ?? "",
    nationalId: normalized.nationalId ?? "",
    birthDate: normalized.birthDate ?? "",
    workInfo: normalized.workInfo ?? "",
    phones: normalized.phones ?? [],
    addresses: normalized.addresses ?? [],
    personGroupTagIds: normalized.personGroupTagIds ?? [],
    interestTagIds: normalized.interestTagIds ?? [],
    favoriteItems: normalized.favoriteItems ?? [],
    familyMembers: normalized.familyMembers ?? [],
    lifeEvents: normalized.lifeEvents ?? [],
    customValues: normalized.customValues ?? [],
    archivedAt: normalized.archivedAt ?? "",
    note: normalized.note ?? ""
  });
}

function hasPendingSecurityOperation() {
  if (state.route.name === "setupMasterPassword") return hasAnyDraftValue(state.route.passwordDraft);
  const guardedRoutes = new Set([
    "driveMergeUnlock",
    "driveExistingUnlock",
    "driveRecoveryReset",
    "driveRevisionRecovery",
    "changePassword",
    "forgotPassword",
    "regenerateRecovery",
    "logoutAllDevices"
  ]);
  if (!guardedRoutes.has(state.route.name)) return false;
  return hasAnyDraftValue(state.route.securityDraft);
}

function hasAnyDraftValue(draft = {}) {
  return Object.values(draft).some((value) => String(value ?? "").trim());
}

function navigate(route, options = {}) {
  if (!confirmBeforeLeavingCurrentRoute(route, options)) return;
  syncCurrentHistoryScroll();
  const fromRoute = state.route;
  state.route = prepareRouteForNavigation(route);
  render({
    restoreScroll: true,
    transition: options.transition ?? (options.replace ? "replace" : "forward"),
    fromRoute
  });
  writeHistoryRoute(state.route, options);
}

function currentRouteSnapshot() {
  return structuredClone({
    name: state.route.name,
    params: state.route.params,
    id: state.route.id,
    scrollY: window.scrollY
  });
}

function detailRoute(id) {
  const returnableRoutes = new Set(["search", "dataHealth"]);
  return {
    name: "detail",
    id,
    returnTo: state.route.returnTo ?? (returnableRoutes.has(state.route.name) ? currentRouteSnapshot() : undefined)
  };
}

function navigateBackFromDetail() {
  navigateBack(state.route.returnTo ?? { name: "home" });
}

function navigateBack(fallbackRoute, options = {}) {
  if (!confirmBeforeLeavingCurrentRoute(fallbackRoute, { viaBack: true, force: options.force })) return;
  syncCurrentHistoryScroll();
  if (history.state?.appRoute && history.length > 1) {
    if (options.force) state.skipNextPopstateConfirm = true;
    history.back();
    return;
  }
  navigate(fallbackRoute, { replace: true, force: true, transition: "back" });
}

function prepareRouteForNavigation(route) {
  return {
    ...route,
    scrollY: Number.isFinite(route.scrollY) ? route.scrollY : 0
  };
}

function syncCurrentHistoryScroll() {
  if (!state.historyNavigationRegistered || !history.state?.appRoute) return;
  replaceHistoryRoute({ ...state.route, scrollY: window.scrollY });
}

function writeHistoryRoute(route, options = {}) {
  if (!state.historyNavigationRegistered || route.name === "showRecoveryCode") return;
  const payload = { appRoute: true, route: historyRouteSnapshot(route) };
  if (options.replace) history.replaceState(payload, "");
  else history.pushState(payload, "");
}

function replaceHistoryRoute(route) {
  if (route.name === "showRecoveryCode") return;
  history.replaceState({ appRoute: true, route: historyRouteSnapshot(route) }, "");
}

function historyRouteSnapshot(route = {}) {
  return {
    name: route.name,
    id: route.id,
    params: route.params ? structuredClone(route.params) : undefined,
    mode: route.mode,
    prefillName: route.prefillName,
    message: route.message,
    showForgotPassword: route.showForgotPassword,
    allowBiometric: route.allowBiometric,
    scrollY: Number.isFinite(route.scrollY) ? route.scrollY : 0,
    sourcePersonId: route.sourcePersonId,
    familyMemberId: route.familyMemberId,
    memberName: route.memberName,
    returnTo: route.returnTo ? historyRouteSnapshot(route.returnTo) : undefined
  };
}

function restoreHistoryRoute(route = {}) {
  return {
    ...route,
    scrollY: Number.isFinite(route.scrollY) ? route.scrollY : 0
  };
}

function restoreRouteScroll(route) {
  const y = Number.isFinite(route?.scrollY) ? route.scrollY : 0;
  requestAnimationFrame(() => window.scrollTo(0, y));
}

function render(options = {}) {
  applyTheme(currentThemeId());
  const transitionClass = routeTransitionClass(options.transition, options.fromRoute, state.route);
  app.innerHTML = `<main class="app route-${escapeAttr(state.route.name)} ${transitionClass}">${view()}</main>${updatePromptView()}`;
  bind();
  if (options.restoreScroll) restoreRouteScroll(state.route);
  resetIdleLockTimer();
  maybeAutoBiometricUnlock();
}

function routeTransitionClass(direction, fromRoute, toRoute) {
  if (!direction) return "";
  const safeDirection = ["forward", "back", "replace"].includes(direction) ? direction : "replace";
  const mode = shouldUseSlideTransition(fromRoute, toRoute, safeDirection) ? safeDirection : "fade";
  return `page-transition page-transition-${mode}`;
}

function shouldUseSlideTransition(fromRoute, toRoute, direction) {
  if (direction === "replace") return false;
  if (NO_SLIDE_ROUTE_NAMES.has(fromRoute?.name) || NO_SLIDE_ROUTE_NAMES.has(toRoute?.name)) return false;
  return true;
}

function currentThemeId() {
  const themeId = state.appState?.ui?.themeId ?? "comfortable-green";
  return THEME_OPTIONS.some((theme) => theme.id === themeId) ? themeId : "comfortable-green";
}

function applyTheme(themeId) {
  document.body.dataset.theme = themeId;
  const theme = THEME_OPTIONS.find((item) => item.id === themeId) ?? THEME_OPTIONS[0];
  document.querySelector("meta[name='theme-color']")?.setAttribute("content", theme.colors[0]);
}

function updatePromptView() {
  if (!state.updateAvailable) return "";
  return `
    <aside class="update-prompt">
      <span>已有新版可用</span>
      <button type="button" data-action="apply-update">重新載入</button>
    </aside>
  `;
}

function applyUpdate() {
  if (state.waitingServiceWorker) {
    state.waitingServiceWorker.postMessage({ type: "SKIP_WAITING" });
    return;
  }
  window.location.reload();
}

async function checkVersionUpdate() {
  const registration = state.serviceWorkerRegistration ?? await navigator.serviceWorker?.getRegistration?.();
  if (!registration) {
    alert("已是最新版本");
    return;
  }
  try {
    const updatePromise = waitForServiceWorkerUpdate(registration);
    await registration.update();
    await updatePromise;
    const hasUpdate = Boolean(registration.waiting || state.waitingServiceWorker || state.updateAvailable);
    if (!hasUpdate) {
      alert("已是最新版本");
      return;
    }
    if (confirm("發現新版本，是否更新？")) applyUpdate();
  } catch {
    alert("暫時無法檢查更新，請稍後再試");
  }
}

function waitForServiceWorkerUpdate(registration) {
  if (registration.waiting || state.waitingServiceWorker || state.updateAvailable) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, 2500);
    registration.addEventListener(
      "updatefound",
      () => {
        const installing = registration.installing;
        if (!installing) {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        installing.addEventListener("statechange", () => {
          if (["installed", "activated", "redundant"].includes(installing.state)) {
            window.clearTimeout(timeout);
            resolve();
          }
        });
      },
      { once: true }
    );
  });
}

function view() {
  if (state.route.name === "welcome") return welcomeView();
  if (!state.vault) return `<div class="empty">載入中…</div>`;
  if (state.route.name === "search") return searchView();
  if (state.route.name === "new") return personFormView();
  if (state.route.name === "edit") return personFormView(getPerson(state.route.id));
  if (state.route.name === "detail") return detailView(getPerson(state.route.id));
  if (state.route.name === "importantNotes") return importantNotesView(getPerson(state.route.id));
  if (state.route.name === "selectFamilyMember") return selectFamilyMemberView();
  if (state.route.name === "settings") return settingsView();
  if (state.route.name === "syncConflicts") return syncConflictsView();
  if (state.route.name === "dataHealth") return dataHealthView();
  if (state.route.name === "localSnapshots") return localSnapshotsView();
  if (state.route.name === "archived") return archivedPeopleView();
  if (state.route.name === "syncTroubleshooting") return syncTroubleshootingView();
  if (state.route.name === "driveRevisionRecovery") return driveRevisionRecoveryView();
  if (state.route.name === "installGuide") return installGuideView();
  if (state.route.name === "deleted") return deletedView();
  if (state.route.name === "driveIntro") return driveIntroView();
  if (state.route.name === "driveCloudChoice") return driveCloudChoiceView();
  if (state.route.name === "driveMergeUnlock") return driveMergeUnlockView();
  if (state.route.name === "driveExistingUnlock") return driveExistingUnlockView();
  if (state.route.name === "driveRecoveryReset") return driveRecoveryResetView();
  if (state.route.name === "deviceApprovalRecovery") return deviceApprovalRecoveryView();
  if (state.route.name === "recoveryPending") return recoveryPendingView();
  if (state.route.name === "recoveryComplete") return recoveryCompleteView();
  if (state.route.name === "recoveryRequests") return recoveryRequestsView();
  if (state.route.name === "setupMasterPassword") return setupMasterPasswordView();
  if (state.route.name === "showRecoveryCode") return showRecoveryCodeView();
  if (state.route.name === "unlock") return unlockView();
  if (state.route.name === "changePassword") return changePasswordView();
  if (state.route.name === "forgotPassword") return forgotPasswordView();
  if (state.route.name === "regenerateRecovery") return regenerateRecoveryView();
  if (state.route.name === "logoutAllDevices") return logoutAllDevicesView();
  return homeView();
}

function welcomeView() {
  return `
    <section class="welcome">
      <div>
        ${brandLogo("welcome")}
        <p class="subtitle">鎖住時光裡的交集，溫習記憶中的點滴</p>
      </div>
      <div class="panel stack">
        <button data-action="start-local">開始使用</button>
      </div>
      ${installPromptCard("welcome")}
    </section>
  `;
}

function homeView() {
  const people = homePeople(state.vault.people);
  return `
    <header class="home-header app-header">
      ${brandLogo("home")}
      <div class="icon-actions" aria-label="首頁操作">
        <button type="button" class="icon-button" data-nav="search" aria-label="搜尋"><img class="button-icon" src="./pics/magnifier.png" alt="" /></button>
        <button type="button" class="icon-button" data-nav="settings" aria-label="設定"><img class="button-icon" src="./pics/gear.png" alt="" /></button>
      </div>
    </header>
    <div class="home-actions">
      <button data-nav="new">＋ 新增人物</button>
    </div>
    ${installPromptCard("home")}
    ${people.length ? people.map(personCard).join("") : `<div class="empty">還沒有任何人物，先新增一位吧。</div>`}
  `;
}

function searchView() {
  const params = normalizeSearchParams(state.route.params);
  const hasCriteria = hasSearchCriteria(params);
  const results = hasCriteria ? searchPeople(params) : [];
  const birthdayOptions = birthdaySearchOptions();
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-nav="home">返回</button>
      <h1 class="section-title">眾裡尋他</h1>
      <span></span>
    </header>
    <section class="panel search-panel">
      <div class="field">
        <label>依輸入文字搜尋（可使用空格增加搜尋條件）</label>
        <input data-search="text" placeholder="搜尋所有欄位、標籤、重要記事…" value="${escapeAttr(params.text)}" />
      </div>
      <div class="field">
        <label>依地址搜尋</label>
        <input data-search="address" placeholder="地址" value="${escapeAttr(params.address)}" />
      </div>
      <div class="field">
        <label>依生日年、月搜尋</label>
        <div class="row birthday-search-row">
          <select data-search="birthYear">
            <option value="" ${params.birthYear ? "" : "selected"}>年份</option>
            ${birthdayOptions.years.map((year) => `<option value="${year}" ${params.birthYear === String(year) ? "selected" : ""}>${year} 年</option>`).join("")}
          </select>
          <select data-search="birthMonth">
            <option value="" ${params.birthMonth ? "" : "selected"}>月份</option>
            ${birthdayOptions.months.map((month) => `<option value="${month}" ${params.birthMonth === String(month) ? "selected" : ""}>${month} 月</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field">
        <label>生日將至</label>
        <select data-search="birthdayWithinMonths">
          <option value="" ${params.birthdayWithinMonths ? "" : "selected"}>不篩選</option>
          <option value="1" ${params.birthdayWithinMonths === "1" ? "selected" : ""}>一個月內</option>
          <option value="2" ${params.birthdayWithinMonths === "2" ? "selected" : ""}>兩個月內</option>
          <option value="3" ${params.birthdayWithinMonths === "3" ? "selected" : ""}>三個月內</option>
        </select>
      </div>
      <div class="field">
        <label>依性別搜尋</label>
        <div class="chip-list">${GENDER_OPTIONS.map((gender) => interestChip({ id: gender, name: gender }, params.genderValues.includes(gender), "search-gender")).join("")}</div>
      </div>
      <div class="field">
        <label>依人物群組搜尋</label>
        <div class="chip-list">${state.vault.personGroupTags.map((tag) => interestChip(tag, params.groupIds.includes(tag.id), "search-group")).join("")}</div>
      </div>
      <div class="field">
        <label>依興趣喜好搜尋</label>
        <div class="chip-list">${state.vault.interestTags.map((tag) => interestChip(tag, params.tagIds.includes(tag.id), "search-tag")).join("")}</div>
      </div>
      <div class="actions search-actions">
        <button data-action="apply-search">開始找人</button>
        <button data-action="clear-search" class="secondary">清除條件</button>
      </div>
    </section>
    ${
      hasCriteria
        ? `<section class="section"><h2 class="section-title">共 ${results.length} 位人物</h2>${results.length ? results.map(personCard).join("") : `<div class="empty">找不到符合條件的人物。</div>`}</section>`
        : ""
    }
  `;
}

function personFormView(person = null) {
  const draft = person ? structuredClone(person) : createPerson(state.appState.deviceId, { name: state.route.prefillName ?? "" });
  if (!state.route.draft) {
    state.route.draft = normalizeDraft(draft);
    state.route.draftBaseline = personDraftSignature(state.route.draft);
  }
  const d = state.route.draft;
  const title = person ? "編輯人物" : "新增人物";
  return `
    <header class="topbar">
      <span></span>
      <h1 class="section-title">${title}</h1>
      <span></span>
    </header>
    <form class="stack" data-form="person">
      ${nameField(d.name)}
      ${basicFieldsEditor(d)}
      ${personGroupEditor(d.personGroupTagIds)}
      ${interestEditor(d.interestTagIds)}
      ${favoriteItemsEditor(d.favoriteItems)}
      ${familyMembersEditor(d.familyMembers, d.id)}
      ${lifeEventsEditor(d.lifeEvents)}
      ${customFieldEditor(d)}
      <section class="panel">
        <div class="field">
          <label>其它備註</label>
          <textarea data-field="note">${escapeHtml(d.note)}</textarea>
        </div>
      </section>
      <button type="submit">儲存</button>
      <button type="button" class="secondary" data-action="cancel-form">取消</button>
    </form>
  `;
}

function detailView(person) {
  if (!person) return notFoundView();
  person = normalizeDraft(person);
  const groupTags = person.personGroupTagIds.map((id) => state.vault.personGroupTags.find((tag) => tag.id === id)).filter(Boolean);
  const tags = person.interestTagIds.map((id) => state.vault.interestTags.find((tag) => tag.id === id)).filter(Boolean);
  const favoriteItems = person.favoriteItems;
  const familyMembers = sortFamilyMembers(person.familyMembers);
  const lifeEvents = sortLifeEvents(person.lifeEvents);
  const visibleLifeEvents = lifeEvents.slice(0, 3);
  const moreLifeEventsButton = lifeEvents.length > 3
    ? `<button type="button" class="action-quiet section-header-button" data-nav="importantNotes" data-id="${escapeAttr(person.id)}">顯示更多重要記事</button>`
    : "";
  const basicLines = basicDetailLines(person);
  const customSections = customDefsForPerson(person.id)
    .map((field) => {
      const value = person.customValues.find((item) => item.fieldId === field.id)?.value;
      if (isEmptyCustomValue(value)) return "";
      return detailGroup(field.name, customDetailContent(field, value), "custom-detail-section");
    })
    .filter(Boolean)
    .join("");
  const detailSections = [
    basicLines ? detailGroup("基本資料", basicLines) : "",
    groupTags.length ? detailGroup("人物群組", `<div class="chip-list">${groupTags.map((tag) => `<span class="chip selected">${tagLabel(tag)}</span>`).join("")}</div>`) : "",
    tags.length ? detailGroup("興趣喜好", `<div class="chip-list">${tags.map((tag) => `<span class="chip selected">${tagLabel(tag)}</span>`).join("")}</div>`) : "",
    favoriteItems.length ? detailGroup("嗜好品", `<div class="chip-list">${favoriteItems.map((item) => `<span class="chip selected">${escapeHtml(item.value)}</span>`).join("")}</div>`) : "",
    familyMembers.length ? detailGroup("家族成員", familyMembers.map((member) => familyMemberLine(person, member)).join("")) : "",
    lifeEvents.length ? detailGroup("重要記事", visibleLifeEvents.map(lifeEventLine).join(""), "", moreLifeEventsButton) : "",
    customSections,
    person.note ? detailGroup("其它備註", `<p class="detail-value">${escapeHtml(person.note).replaceAll("\n", "<br>")}</p>`) : ""
  ].filter(Boolean).join("");
  const hasDetailContent = Boolean(
    basicLines ||
      groupTags.length ||
      tags.length ||
      favoriteItems.length ||
      familyMembers.length ||
      lifeEvents.length ||
      customSections ||
      person.note
  );
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-action="detail-back">返回</button>
      <div class="detail-title-block">
        <h1 class="section-title detail-page-title">${escapeHtml(person.name)}</h1>
        <p class="detail-date-meta">建立日期：${escapeHtml(formatDateTime(person.createdAt))}</p>
        <p class="detail-date-meta">最近修改：${escapeHtml(formatDateTime(person.updatedAt))}</p>
      </div>
      <button class="detail-edit-button" data-action="edit-person" data-id="${person.id}">編輯人物</button>
    </header>
    ${person.archivedAt ? `<div class="inline-item archived-banner"><strong>已封存</strong><span class="muted">此人物不會顯示於首頁或搜尋結果。</span></div>` : ""}
    ${detailSections ? `<section class="panel section detail-panel">${detailSections}</section>` : ""}
    ${hasDetailContent ? "" : `<section class="panel blank-detail-card"></section>`}
    <div class="actions detail-actions">
      <button class="danger" data-action="delete-person" data-id="${person.id}">刪除人物</button>
      <button class="warning" data-action="archive-person" data-id="${person.id}" ${person.archivedAt ? "disabled" : ""}>封存</button>
    </div>
  `;
}

function importantNotesView(person) {
  if (!person) return notFoundView();
  const lifeEvents = sortLifeEvents(person.lifeEvents ?? []);
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-action="important-notes-back">返回</button>
      <h1 class="section-title">重要記事</h1>
      <span></span>
    </header>
    <section class="panel section detail-panel">
      ${lifeEvents.length ? detailGroup(person.name, lifeEvents.map(lifeEventLine).join("")) : `<p class="muted">尚未新增重要記事。</p>`}
    </section>
  `;
}

function selectFamilyMemberView() {
  const sourcePerson = getPerson(state.route.sourcePersonId);
  const memberName = state.route.memberName ?? "";
  const candidates = familyMemberNameMatches(memberName, state.route.sourcePersonId);
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-nav="detail" data-id="${escapeAttr(state.route.sourcePersonId ?? "")}">返回</button>
      <h1 class="section-title">選擇家族成員</h1>
      <span></span>
    </header>
    <section class="panel stack">
      <h2 class="section-title">發現多位同名人物</h2>
      <p class="muted">請選擇要連結到「${escapeHtml(sourcePerson?.name ?? "這位人物")}」家族成員中的「${escapeHtml(memberName)}」。</p>
      <div class="candidate-list">
        ${
          candidates.length
            ? candidates
                .map(
                  (person) => `
                    <button type="button" class="candidate-card" data-action="select-family-member-link" data-source-id="${escapeAttr(state.route.sourcePersonId)}" data-member-id="${escapeAttr(state.route.familyMemberId)}" data-target-id="${escapeAttr(person.id)}">
                      <span class="candidate-name">${escapeHtml(person.name)}</span>
                      <span class="muted">建立日期：${escapeHtml(formatDateTime(person.createdAt))}</span>
                    </button>
                  `
                )
                .join("")
            : `<div class="empty">目前找不到同名人物。</div>`
        }
      </div>
    </section>
  `;
}

function settingsView() {
  const gd = state.appState.googleDrive;
  const authStatus = driveAuthStatus();
  const pendingConflicts = gd.pendingConflicts ?? [];
  const dataSummary = vaultDataSummary();
  const dataManagement = state.appState.dataManagement ?? {};
  const syncStatusText = gd.connected
    ? syncStatusLabel(gd)
    : "尚未啟用";
  return `
    <header class="topbar">
      <h1 class="title">設定</h1>
    </header>
    <section class="panel stack">
      <h2 class="section-title">Google Drive 同步</h2>
      ${driveSyncOverview(gd, authStatus, syncStatusText)}
      ${gd.lastSyncError ? `<p class="danger-text">${escapeHtml(gd.lastSyncError)}</p>` : ""}
      ${syncSummaryView(gd.lastSyncSummary)}
      ${pendingConflicts.length ? `<button class="action-quiet" data-nav="syncConflicts">處理衝突資料</button>` : ""}
      <button class="action-quiet" data-nav="syncTroubleshooting">同步疑難排解</button>
      ${gd.connected ? `<button class="action-quiet" data-action="sync-now" ${isDriveSyncRecentlyStarted(gd) ? "disabled" : ""}>立即同步</button><button class="action-quiet" data-action="drive-logout">登出 Google Drive</button>` : `<button class="action-quiet" data-action="drive-placeholder">連結 Google Drive</button>`}
    </section>
    ${installSettingsSection()}
    ${themeSettingsSection()}
      ${gd.connected ? securitySettingsSection() : ""}
    <section class="panel stack">
      <h2 class="section-title">資料管理</h2>
      ${storageWarningView()}
      <div class="data-summary">
        <span>人物 ${dataSummary.peopleCount} 位</span>
        <span>人物群組 ${dataSummary.personGroupTagCount} 個</span>
        <span>興趣喜好 ${dataSummary.interestTagCount} 個</span>
        <span>自訂欄位 ${dataSummary.customFieldCount} 個</span>
      </div>
      ${dataManagement.lastJsonExportAt ? `<p class="muted">最近 JSON 備份：${formatDateTime(dataManagement.lastJsonExportAt)}</p>` : ""}
      ${dataManagement.lastExcelExportAt ? `<p class="muted">最近 Excel 匯出：${formatDateTime(dataManagement.lastExcelExportAt)}</p>` : ""}
      ${dataManagement.lastImportAt ? `<p class="muted">最近匯入：${formatDateTime(dataManagement.lastImportAt)}</p>` : ""}
      <button class="action-quiet" data-nav="localSnapshots">本機資料快照</button>
      <button class="action-quiet" data-nav="deleted">最近刪除</button>
      <button class="action-quiet" data-nav="archived">查看封存人物</button>
      <button class="action-quiet" data-action="export-data">匯出備份檔（JSON）</button>
      <button class="action-quiet" data-action="export-excel">匯出 Excel（XLSX）</button>
      <button class="action-quiet" data-action="choose-import-file">匯入資料</button>
      <button class="action-quiet" data-nav="dataHealth">資料完整性檢查</button>
      <input type="file" accept="application/json,.json" data-import-file hidden />
      <p class="muted">JSON 備份檔可用於匯入復原；Excel 檔適合人工檢視。匯出的資料不包含密碼、資料金鑰或救援碼；請自行妥善保存，避免他人取得。</p>
    </section>
    <section class="panel stack">
      <h2 class="section-title">關於</h2>
      <p>版本：${escapeHtml(APP_CONFIG.appVersion)}</p>
      <p class="muted">快取版本：${escapeHtml(APP_CONFIG.cacheName)}</p>
      <button type="button" class="action-quiet" data-action="check-version-update">檢查版本更新</button>
      <div class="legal-links">
        <a href="./privacy.html">隱私權政策</a>
        <a href="./terms.html">服務條款</a>
      </div>
    </section>
    ${bottomNav("settings")}
  `;
}

function securitySettingsSection() {
  const biometricEnabled = isBiometricUnlockEnabled();
  return `
    <section class="panel stack">
      <h2 class="section-title">安全性</h2>
      <button class="action-quiet" data-nav="changePassword">更改密碼</button>
      <button class="action-quiet" data-nav="forgotPassword">忘記密碼</button>
      <button class="action-quiet" data-nav="regenerateRecovery">重新產生救援碼</button>
      <button class="action-quiet" data-action="refresh-recovery-requests">查看舊裝置救援核准請求</button>
      <p class="muted">重新產生救援碼後會升級為 Recovery v2；v2 救援碼只能啟動舊裝置核准，不能解密資料。</p>
      <button class="biometric-button" data-action="${biometricEnabled ? "disable-biometric-unlock" : "enable-biometric-unlock"}">${biometricEnabled ? "停用生物辨識解鎖" : "啟用生物辨識解鎖"}</button>
      <button class="danger" data-nav="logoutAllDevices">登出所有裝置</button>
    </section>
  `;
}

function driveSyncOverview(gd, authStatus, syncStatusText) {
  const rows = [
    ["狀態", syncStatusText],
    ["同步模式", driveProviderLabel()],
    gd.connected ? ["目前同步帳號", driveAccountLabel(gd)] : null,
    authStatus.hasAccessToken ? ["Google 連線狀態", "本次可立即同步"] : null,
    gd.connected && !authStatus.hasAccessToken ? ["Google 連線狀態", "首次同步時可能需要重新確認授權"] : null,
    gd.lastLocalChangeAt ? ["本機最近變更", formatDateTime(gd.lastLocalChangeAt)] : null,
    gd.lastSyncAt ? ["上次同步", formatDateTime(gd.lastSyncAt)] : null
  ].filter(Boolean);
  return `
    <div class="status-summary">
      ${rows.map(([label, value]) => `<div class="status-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
    </div>
  `;
}

function driveAccountLabel(gd) {
  if (gd.accountEmail) return maskEmail(gd.accountEmail);
  return "已連結 Google Drive（未讀取 Email）";
}

function maskEmail(email) {
  const [name, domain] = String(email).split("@");
  if (!name || !domain) return email;
  const visible = name.length <= 2 ? name[0] : name.slice(0, 2);
  return `${visible}*****@${domain}`;
}

function storageWarningView() {
  return `
    <div class="inline-item storage-warning">
      <strong>瀏覽器資料提醒</strong>
      <span class="muted">清除瀏覽器網站資料會移除本機資料；若未啟用 Google Drive 同步，資料可能無法復原。</span>
    </div>
  `;
}

function installPromptCard(location) {
  if (!shouldShowInstallPromptCard()) return "";
  const canPrompt = Boolean(state.installPromptEvent);
  return `
    <section class="install-card panel">
      <div>
        <h2 class="section-title">安裝莫忘</h2>
        <p class="muted">加到手機主畫面後，可以像 App 一樣快速開啟；已快取的畫面也能離線啟動。</p>
      </div>
      <div class="install-actions">
        <button type="button" data-action="${canPrompt ? "install-app" : "open-install-guide"}">${canPrompt ? "安裝到裝置" : "查看安裝方式"}</button>
        <button type="button" class="secondary" data-action="dismiss-install-tip">稍後再說</button>
      </div>
    </section>
  `;
}

function installSettingsSection() {
  const installed = isPwaInstalled();
  if (installed) return "";
  const canPrompt = Boolean(state.installPromptEvent);
  return `
    <section class="panel stack">
      <h2 class="section-title">安裝到裝置</h2>
      <p>狀態：尚未以 App 模式開啟</p>
      <p class="muted">建議安裝到手機主畫面，日後可以直接從主畫面開啟莫忘。</p>
      <button type="button" class="action-quiet" data-action="${canPrompt ? "install-app" : "open-install-guide"}">${canPrompt ? "安裝到裝置" : "查看安裝方式"}</button>
    </section>
  `;
}

function themeSettingsSection() {
  const selected = currentThemeId();
  return `
    <section class="panel stack">
      <h2 class="section-title">主題色系</h2>
      <div class="theme-options">
        ${THEME_OPTIONS.map((theme) => `
          <button type="button" class="theme-option ${theme.id === selected ? "selected" : ""}" data-action="set-theme" data-theme-id="${theme.id}" aria-pressed="${theme.id === selected}">
            <span class="theme-swatches" aria-hidden="true">
              ${theme.colors.map((color) => `<span style="background:${color}"></span>`).join("")}
            </span>
            <span>${theme.name}</span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function installGuideView() {
  const canPrompt = Boolean(state.installPromptEvent);
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-nav="settings">返回</button>
      <h1 class="section-title">安裝到裝置</h1>
      <span></span>
    </header>
    <section class="panel stack">
      <h2 class="section-title">建議安裝原因</h2>
      <p class="muted">安裝後可從手機主畫面或桌面直接開啟，畫面會更像獨立 App；已快取的 App 外殼也能離線啟動。</p>
      ${canPrompt ? `<button type="button" data-action="install-app">安裝到裝置</button>` : ""}
    </section>
    <section class="panel stack">
      <h2 class="section-title">Android Chrome / Edge</h2>
      <ol class="guide-list">
        <li>開啟莫忘網址。</li>
        <li>點右上角「⋮」。</li>
        <li>選擇「安裝應用程式」或「加入主畫面」。</li>
        <li>確認後即可從主畫面開啟。</li>
      </ol>
    </section>
    <section class="panel stack">
      <h2 class="section-title">iPhone / iPad Safari</h2>
      <ol class="guide-list">
        <li>請使用 Safari 開啟莫忘網址。</li>
        <li>點下方或上方的「分享」按鈕。</li>
        <li>選擇「加入主畫面」。</li>
        <li>點「新增」。</li>
      </ol>
    </section>
    <section class="panel stack">
      <h2 class="section-title">電腦版 Chrome / Edge</h2>
      <ol class="guide-list">
        <li>開啟莫忘網址。</li>
        <li>若網址列右側出現安裝圖示，可直接點擊。</li>
        <li>也可從瀏覽器選單選擇「安裝莫忘」。</li>
      </ol>
    </section>
  `;
}

function syncSummaryView(summary) {
  if (!summary) return "";
  return `
    <div class="sync-summary">
      <strong>上次同步摘要</strong>
      <span>${summary.hadCloudData ? "已讀取雲端資料" : "雲端尚無既有資料"}</span>
      <span>合併後人物 ${summary.mergedPeopleCount} 位，衝突 ${summary.conflictCount} 筆</span>
    </div>
  `;
}

function driveRevisionRecoveryView() {
  const draft = state.route.securityDraft ?? { credentialType: "password", secret: "", newPassword: "", confirmPassword: "" };
  const report = state.route.revisionRecoveryReport;
  const candidate = state.route.revisionRecoveryCandidate;
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-nav="syncTroubleshooting">返回</button>
      <h1 class="section-title">雲端歷史版本救援</h1>
      <span></span>
    </header>
    <section class="panel stack">
      <p>此工具會嘗試掃描 Google Drive 中莫忘同步檔的歷史版本，找出可用原密碼或救援碼解開的舊版資料。</p>
      <p class="muted">Google Drive 可能未保留完整舊版，且部分舊版可能無法下載；此工具會盡力嘗試，但不能保證一定能救回。</p>
    </section>
    <form class="panel stack security-form" data-form="drive-revision-recovery">
      <div class="field security-field">
        <label>嘗試方式</label>
        <select data-security-draft="credentialType">
          <option value="password" ${draft.credentialType === "password" ? "selected" : ""}>原密碼</option>
          <option value="recoveryCode" ${draft.credentialType === "recoveryCode" ? "selected" : ""}>救援碼</option>
        </select>
      </div>
      <div class="field security-field">
        <label>原密碼或救援碼</label>
        <input type="password" data-security-draft="secret" value="${escapeAttr(draft.secret ?? "")}" autocomplete="current-password" />
      </div>
      <div class="field security-field">
        <label>新密碼</label>
        <input type="password" data-security-draft="newPassword" value="${escapeAttr(draft.newPassword ?? "")}" autocomplete="new-password" />
      </div>
      <div class="field security-field">
        <label>再次輸入新密碼</label>
        <input type="password" data-security-draft="confirmPassword" value="${escapeAttr(draft.confirmPassword ?? "")}" autocomplete="new-password" />
      </div>
      <button type="submit">掃描歷史版本</button>
    </form>
    ${report ? driveRevisionRecoveryReportView(report, candidate) : ""}
  `;
}

function driveRevisionRecoveryReportView(report, candidate) {
  const className = report.status === "success" ? "success" : report.status === "error" ? "error" : "info";
  return `
    <section class="panel stack">
      <div class="inline-item troubleshoot-item ${className}">
        <strong>${report.status === "success" ? "找到可用版本" : report.status === "error" ? "未找到可用版本" : "掃描中"}</strong>
        <span class="muted">${escapeHtml(report.message)}</span>
      </div>
      ${
        report.keyRevision && report.vaultRevision
          ? `<div class="sync-summary"><strong>找到的版本</strong><span>金鑰檔：${escapeHtml(report.keyRevision.label)}</span><span>資料檔：${escapeHtml(report.vaultRevision.label)}</span></div>`
          : ""
      }
      ${
        candidate
          ? `<button type="button" data-action="apply-drive-revision-recovery">使用找到的版本重建雲端資料</button>`
          : ""
      }
      ${
        report.attempts?.length
          ? `<details><summary>查看掃描紀錄</summary><ul class="guide-list">${report.attempts.slice(-30).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>`
          : ""
      }
    </section>
  `;
}

async function driveRevisionCandidates(fileKey) {
  const name = driveFileName(fileKey);
  const [current, revisionInfo] = await Promise.all([
    readDriveFile(name),
    listDriveFileRevisions(name)
  ]);
  const candidates = [];
  if (current) {
    candidates.push({
      id: "current",
      label: "目前版本",
      modifiedTime: revisionInfo.file?.modifiedTime ?? "",
      keepForever: true,
      read: async () => current
    });
  }
  const sortedRevisions = [...(revisionInfo.revisions ?? [])].sort((a, b) =>
    String(b.modifiedTime ?? "").localeCompare(String(a.modifiedTime ?? ""))
  );
  sortedRevisions.forEach((revision) => {
    candidates.push({
      id: revision.id,
      label: `歷史版本 ${revision.id}`,
      modifiedTime: revision.modifiedTime ?? "",
      keepForever: Boolean(revision.keepForever),
      read: async () => readDriveFileRevision(name, revision.id)
    });
  });
  return candidates;
}

function revisionSummary(candidate) {
  return {
    id: candidate.id,
    label: revisionLabel(candidate),
    modifiedTime: candidate.modifiedTime ?? "",
    keepForever: Boolean(candidate.keepForever)
  };
}

function revisionLabel(candidate) {
  const time = candidate.modifiedTime ? `（${formatDateTime(candidate.modifiedTime)}）` : "";
  const keep = candidate.keepForever || candidate.id === "current" ? "" : "，可能無法下載";
  return `${candidate.label}${time}${keep}`;
}

function localSnapshotsView() {
  const snapshots = state.localSnapshots ?? [];
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-nav="settings">返回</button>
      <h1 class="section-title">本機資料快照</h1>
      <span></span>
    </header>
    <section class="panel stack">
      <p class="muted">系統會保留最近 3 份重要修改前的本機快照，可用於誤刪、匯入錯檔或同步衝突後的復原。</p>
      ${
        snapshots.length
          ? snapshots.map(localSnapshotCard).join("")
          : `<div class="empty">目前尚未建立本機快照。</div>`
      }
    </section>
  `;
}

function archivedPeopleView() {
  const archived = sortPeople((state.vault.people ?? []).filter((person) => person.archivedAt));
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-nav="settings">返回</button>
      <h1 class="section-title">封存人物</h1>
      <span></span>
    </header>
    ${
      archived.length
        ? archived.map(archivedPersonCard).join("")
        : `<div class="empty">目前沒有封存人物。</div>`
    }
  `;
}

function archivedPersonCard(person) {
  return `
    <section class="panel archived-person-card">
      <strong>${escapeHtml(person.name)}</strong>
      <div class="inline-actions">
        <button type="button" class="secondary" data-action="restore-archived-person" data-id="${person.id}">還原</button>
        <button type="button" class="danger" data-action="delete-archived-person" data-id="${person.id}">永久刪除</button>
      </div>
    </section>
  `;
}

function localSnapshotCard(snapshot) {
  return `
    <div class="inline-item snapshot-card">
      <div>
        <strong>${escapeHtml(snapshot.reason)}</strong>
        <p class="muted">${formatDateTime(snapshot.createdAt)}，人物 ${snapshot.peopleCount ?? snapshot.vault?.people?.length ?? 0} 位</p>
      </div>
      <div class="inline-actions">
        <button type="button" class="secondary" data-action="download-local-snapshot" data-id="${escapeAttr(snapshot.id)}">下載</button>
        <button type="button" data-action="restore-local-snapshot" data-id="${escapeAttr(snapshot.id)}">還原</button>
        <button type="button" class="danger" data-action="delete-local-snapshot" data-id="${escapeAttr(snapshot.id)}">刪除</button>
      </div>
    </div>
  `;
}

function syncTroubleshootingView() {
  const gd = state.appState.googleDrive;
  const authStatus = driveAuthStatus();
  const issues = syncTroubleshootingItems(gd, authStatus);
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-nav="settings">返回</button>
      <h1 class="section-title">同步疑難排解</h1>
      <span></span>
    </header>
    <section class="panel stack">
      <p>目前狀態：${syncStatusLabel(gd)}</p>
      ${issues.map(troubleshootingItem).join("")}
      <div class="actions">
        <button type="button" data-action="sync-now">立即同步</button>
        <button type="button" class="action-quiet" data-nav="driveRevisionRecovery">雲端歷史版本救援</button>
      </div>
    </section>
  `;
}

function troubleshootingItem(item) {
  return `
    <div class="inline-item troubleshoot-item ${item.level}">
      <strong>${escapeHtml(item.title)}</strong>
      <span class="muted">${escapeHtml(item.detail)}</span>
    </div>
  `;
}

function syncTroubleshootingItems(gd, authStatus) {
  const items = [];
  if (!gd.connected) {
    items.push({ level: "warn", title: "尚未啟用 Google Drive 同步", detail: "可回到設定頁按「連結 Google Drive」啟用同步。" });
  }
  if (gd.connected && !authStatus.hasAccessToken) {
    items.push({ level: "warn", title: "需要重新確認 Google 授權", detail: "這是正常情況；為避免打擾使用者，App 只會在你按「立即同步」時開啟 Google 授權。" });
  }
  if (gd.syncStatus === "needsSync") {
    items.push({ level: "warn", title: "有本機變更尚未同步", detail: "資料已保存在本機；按「立即同步」後會與 Google Drive 合併並寫回雲端。" });
  }
  if (gd.syncStatus === "needsResolution") {
    items.push({ level: "error", title: "有資料衝突需要處理", detail: "請回設定頁按「處理衝突資料」，逐筆選擇保留本機或雲端內容。" });
  }
  if (gd.lastSyncError) {
    items.push({ level: "error", title: "最近同步失敗", detail: gd.lastSyncError });
  }
  if (!items.length) {
    items.push({ level: "ok", title: "目前沒有明顯同步問題", detail: "若仍覺得資料不一致，可回到設定頁手動執行「立即同步」一次。" });
  }
  return items;
}

function dataHealthView() {
  const report = buildDataHealthReport();
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-nav="settings">返回</button>
      <h1 class="section-title">資料完整性檢查</h1>
      <span></span>
    </header>
    <section class="panel stack">
      <p>檢查結果：${report.issues.length ? `發現 ${report.issues.length} 個提醒` : "目前未發現異常"}</p>
      <p class="muted">這裡只做檢查，不會自動修改資料。</p>
      ${report.issues.length ? report.issues.map(dataHealthIssue).join("") : `<div class="empty">資料看起來很健康。</div>`}
    </section>
  `;
}

function dataHealthIssue(issue) {
  return `
    <div class="inline-item health-issue">
      <strong>${escapeHtml(issue.title)}</strong>
      <span class="muted">${escapeHtml(issue.detail)}</span>
      ${
        issue.personIds?.length
          ? `<div class="inline-actions">${issue.personIds.map((id) => {
              const person = getPerson(id);
              return person ? `<button type="button" class="secondary" data-action="open-detail" data-id="${id}">查看 ${escapeHtml(person.name)}</button>` : "";
            }).join("")}</div>`
          : ""
      }
    </div>
  `;
}

function syncConflictsView() {
  const conflicts = state.appState.googleDrive.pendingConflicts ?? [];
  return `
    <header class="topbar">
      <button class="secondary" data-nav="settings">返回</button>
      <h1 class="section-title">處理衝突資料</h1>
      <span></span>
    </header>
    <section class="panel stack">
      <p class="muted">以下資料在不同裝置上都有修改，請選擇要保留的內容。</p>
      ${conflicts.length ? conflicts.map(conflictCard).join("") : `<div class="empty">目前沒有資料衝突需要處理。</div>`}
    </section>
  `;
}

function conflictCard(conflict, index) {
  const person = getPerson(conflict.personId);
  return `
    <div class="inline-item conflict-card">
      <div>
        <strong>${escapeHtml(person?.name ?? "找不到人物")}</strong>
        <p class="muted">${fieldLabel(conflict.field)}</p>
      </div>
      <div class="conflict-choice">
        <span>本機：${escapeHtml(conflict.localValue || "空白")}</span>
        <button type="button" class="secondary" data-action="resolve-sync-conflict" data-index="${index}" data-source="local">保留本機資料</button>
      </div>
      <div class="conflict-choice">
        <span>雲端：${escapeHtml(conflict.remoteValue || "空白")}</span>
        <button type="button" data-action="resolve-sync-conflict" data-index="${index}" data-source="remote">使用雲端資料</button>
      </div>
    </div>
  `;
}

function driveIntroView() {
  const isCreateFromLocal = state.route.mode === "createFromLocal";
  const isRebuildCloudFromBackup = state.route.mode === "rebuildCloudFromBackup";
  const introText = isRebuildCloudFromBackup
    ? "將使用目前本機資料重建 Google Drive 雲端同步資料。這會覆蓋既有雲端同步資料，並讓舊密碼與舊救援碼失效。"
    : isCreateFromLocal
      ? "將使用目前本機資料建立新的 Google Drive 同步資料。"
      : "連結 Google Drive 後，莫忘會先在本機建立加密用的資料金鑰，並用你的密碼與救援碼分別保護它。";
  return `
    <header class="topbar">
      <button class="secondary" data-action="cancel-drive-setup">返回</button>
      <h1 class="section-title">連結 Google Drive</h1>
      <span></span>
    </header>
    <section class="panel stack">
      <p>${introText}</p>
      <p class="muted">目前同步模式：${driveProviderLabel()}。資料會先加密後再寫入 Google Drive appDataFolder。</p>
      ${isRebuildCloudFromBackup ? `<p class="danger-text">請確認你已匯入正確的 JSON 備份；重建完成並確認同步成功前，不要刪除本機資料。</p>` : ""}
      <button data-nav="setupMasterPassword" ${isRebuildCloudFromBackup ? `data-mode="rebuildCloudFromBackup"` : ""}>${isRebuildCloudFromBackup ? "設定新密碼並重建" : "開始設定密碼"}</button>
    </section>
  `;
}

function driveCloudChoiceView() {
  const dataSummary = vaultDataSummary();
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-action="cancel-drive-setup">返回</button>
      <h1 class="section-title">偵測到雲端資料</h1>
      <span></span>
    </header>
    <section class="panel stack">
      <p>Google Drive 中已有莫忘的同步資料。</p>
      <p class="muted">此裝置目前有本機資料：人物 ${dataSummary.peopleCount} 位。按下資料同步後，系統會先解開雲端資料，再依既有合併規則整合本機與雲端內容。</p>
      <button type="button" data-nav="driveMergeUnlock">資料同步</button>
      <div class="inline-item stack">
        <strong>若舊密碼與救援碼都無法使用</strong>
        <p class="muted">你可以先匯入 JSON 備份，再用本機資料覆蓋並重建 Google Drive 同步資料。</p>
        <button type="button" class="action-quiet" data-nav="driveIntro" data-mode="rebuildCloudFromBackup">使用本機備份重建雲端資料</button>
      </div>
    </section>
  `;
}

function driveMergeUnlockView() {
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-nav="driveCloudChoice">返回</button>
      <h1 class="section-title">資料同步</h1>
      <span></span>
    </header>
    <form class="panel stack" data-form="drive-merge-unlock">
      <p class="muted">請輸入雲端同步資料的密碼。通過後會合併本機與 Google Drive 資料，不會直接用其中一邊覆蓋另一邊。</p>
      <div class="field">
        <label>密碼</label>
        <input type="password" data-security-draft="password" autocomplete="current-password" />
      </div>
      <button type="submit">開始同步</button>
      <button type="button" class="secondary" data-nav="driveRecoveryReset" data-mode="merge">忘記密碼</button>
    </form>
  `;
}

function driveExistingUnlockView() {
  return `
    <header class="topbar">
      <button class="secondary" data-action="cancel-drive-setup">返回</button>
      <h1 class="section-title">輸入密碼</h1>
      <span></span>
    </header>
    <form class="panel stack" data-form="drive-existing-unlock">
      <p class="muted">已找到既有同步資料，請輸入密碼登入。</p>
      <div class="field">
        <label>密碼</label>
        <input type="password" data-security-draft="password" autocomplete="current-password" />
      </div>
      <button type="submit">登入 App</button>
      <button type="button" class="secondary" data-nav="driveRecoveryReset" data-mode="existing">忘記密碼</button>
    </form>
  `;
}

function driveRecoveryResetView() {
  const mode = state.route.mode === "merge" ? "merge" : "existing";
  return securityFormView({
    title: "忘記密碼",
    form: "drive-recovery-reset",
    backRoute: mode === "merge" ? "driveMergeUnlock" : "driveExistingUnlock",
    intro: "請輸入救援碼並設定新密碼。完成後會產生新的救援碼，舊救援碼將失效。",
    fields: [
      ["recoveryCode", "救援碼", "one-time-code"],
      ["newPassword", "新密碼", "new-password"],
      ["confirmPassword", "再次輸入新密碼", "new-password"]
    ],
    submit: "重設密碼",
    extraActions: `<button type="button" class="secondary" data-nav="deviceApprovalRecovery" data-mode="${mode}">從已登入舊裝置授權</button>`
  });
}

function recoveryPendingView() {
  return `
    <header class="topbar topbar-centered"><button class="secondary" data-nav="driveExistingUnlock">返回</button><h1 class="section-title">等待舊裝置核准</h1><span></span></header>
    <section class="panel stack">
      <p>請在已登入的舊裝置開啟「設定 → 查看舊裝置救援核准請求」。</p>
      <p>兩台裝置都必須顯示相同配對碼：</p>
      <p class="recovery-code">${escapeHtml(state.route.pairingCode)}</p>
      <p class="muted">舊裝置核准時會由使用者在該裝置手動輸入相同的新密碼；新密碼、救援碼與資料金鑰不會傳送到 Worker。</p>
      <button data-action="check-recovery-request">我已完成舊裝置核准</button>
    </section>
  `;
}

function recoveryCompleteView() {
  return securityFormView({
    title: "完成密碼重設",
    form: "recovery-v2-complete",
    intro: "舊裝置已核准。請再次輸入剛才設定的新密碼以開啟既有加密資料。",
    fields: [["newPassword", "新密碼", "new-password"], ["confirmPassword", "再次輸入新密碼", "new-password"]],
    submit: "開啟資料",
    backRoute: "driveExistingUnlock"
  });
}

function recoveryRequestsView() {
  const requests = state.route.requests ?? [];
  return `
    <header class="topbar topbar-centered"><button class="secondary" data-nav="settings">返回</button><h1 class="section-title">救援核准請求</h1><span></span></header>
    <section class="panel stack">
      <p class="muted">只核准你親自發起且已核對配對碼的請求。核准會使其他裝置的 trusted session 失效。</p>
      ${requests.length ? requests.map((request) => `<div class="inline-item stack"><strong>新裝置：${escapeHtml(request.requester_device_id)}</strong><span>配對碼：${escapeHtml(request.pairing_code)}</span><span class="muted">到期：${escapeHtml(formatDateTime(request.expires_at))}</span><button data-action="approve-recovery-request" data-request-id="${escapeAttr(request.request_id)}" data-pairing-code="${escapeAttr(request.pairing_code)}">核准並重設密碼</button></div>`).join("") : `<p class="muted">目前沒有等待核准的請求。</p>`}
      <button class="secondary" data-action="refresh-recovery-requests">重新整理</button>
    </section>
  `;
}

function setupMasterPasswordView() {
  const draft = state.route.passwordDraft ?? { password: "", confirm: "" };
  return `
    <header class="topbar">
      <button class="secondary" data-nav="driveIntro">返回</button>
      <h1 class="section-title">設定密碼</h1>
      <span></span>
    </header>
    <form class="panel stack" data-form="master-password">
      <p class="muted">至少 6 個字元。密碼不會被保存，只用來解開資料金鑰。</p>
      <div class="field">
        <label>密碼</label>
        <input type="password" data-password-draft="password" value="${escapeAttr(draft.password)}" autocomplete="new-password" />
      </div>
      <div class="field">
        <label>再次輸入密碼</label>
        <input type="password" data-password-draft="confirm" value="${escapeAttr(draft.confirm)}" autocomplete="new-password" />
      </div>
      <button type="submit">下一步</button>
    </form>
  `;
}

function showRecoveryCodeView() {
  const oldInvalid = state.route.oldInvalid ? `<p class="muted">舊救援碼已失效</p>` : "";
  return `
    <header class="topbar">
      <span></span>
      <h1 class="section-title">救援碼</h1>
      <span></span>
    </header>
    <section class="panel stack">
      <p class="recovery-code">${escapeHtml(state.route.recoveryCode)}</p>
      <p>救援碼是提供重設密碼認證使用，請妥善保管、注意保密。離開此畫面後將不再顯示此救援碼，務必確認保存好後再離開此畫面</p>
      ${oldInvalid}
      <button data-action="confirm-recovery-saved">我已妥善保存救援碼</button>
    </section>
  `;
}

function unlockView() {
  const message = state.route.message ?? "請輸入密碼以繼續使用";
  const forgotPasswordButton = state.route.showForgotPassword ? `<button type="button" class="secondary" data-nav="forgotPassword">忘記密碼</button>` : "";
  const biometricButton = biometricUnlockButtonForUnlockView();
  return `
    <section class="welcome">
      <div>
        ${brandLogo("welcome")}
        <p class="subtitle">${escapeHtml(message)}</p>
      </div>
      <form class="panel stack" data-form="unlock">
        <div class="field">
          <label>密碼</label>
          <input type="password" data-security-draft="password" autocomplete="current-password" />
        </div>
        <button type="submit">登入 App</button>
        ${biometricButton}
        ${forgotPasswordButton}
      </form>
    </section>
  `;
}

function biometricUnlockButtonForUnlockView() {
  if (state.route.allowBiometric === false || !webAuthnSupported()) return "";
  if (isBiometricUnlockEnabled()) {
    return `<button type="button" class="biometric-button" data-action="biometric-unlock">使用生物辨識解鎖</button>`;
  }
  return `<button type="button" class="biometric-button" data-action="enable-biometric-unlock">啟用生物辨識解鎖</button>`;
}

function changePasswordView() {
  return securityFormView({
    title: "更改密碼",
    form: "change-password",
    fields: [
      ["currentPassword", "目前密碼", "current-password"],
      ["newPassword", "新密碼", "new-password"],
      ["confirmPassword", "再次輸入新密碼", "new-password"]
    ],
    submit: "更改密碼"
  });
}

function forgotPasswordView() {
  return securityFormView({
    title: "忘記密碼",
    form: "forgot-password",
    intro: "請輸入救援碼並設定新密碼。完成後會產生新的救援碼，舊救援碼將失效。",
    fields: [
      ["recoveryCode", "救援碼", "one-time-code"],
      ["newPassword", "新密碼", "new-password"],
      ["confirmPassword", "再次輸入新密碼", "new-password"]
    ],
    submit: "重設密碼",
    extraActions: `<button type="button" class="secondary" data-nav="deviceApprovalRecovery" data-mode="settings">從已登入舊裝置授權</button>`
  });
}

function deviceApprovalRecoveryView() {
  const mode = state.route.mode === "merge" ? "merge" : "existing";
  return securityFormView({
    title: "從已登入舊裝置授權",
    form: "device-approval-recovery",
    intro: "救援碼遺失時，可由已登入且已解鎖的舊裝置核准。請先設定新密碼；核准時需在舊裝置手動輸入相同的新密碼。",
    fields: [["newPassword", "新密碼", "new-password"], ["confirmPassword", "再次輸入新密碼", "new-password"]],
    submit: "建立核准請求",
    backRoute: state.route.mode === "settings" ? "settings" : (mode === "merge" ? "driveMergeUnlock" : "driveExistingUnlock")
  });
}

function regenerateRecoveryView() {
  return securityFormView({
    title: "重新產生救援碼",
    form: "regenerate-recovery",
    fields: [["currentPassword", "目前密碼", "current-password"]],
    submit: "產生新的救援碼"
  });
}

function logoutAllDevicesView() {
  return securityFormView({
    title: "登出所有裝置",
    form: "logout-all-devices",
    intro: "所有裝置都需要重新輸入密碼才能繼續使用。",
    fields: [["currentPassword", "目前密碼", "current-password"]],
    submit: "登出所有裝置",
    danger: true
  });
}

function securityFormView({ title, form, fields, submit, intro = "", danger = false, backRoute = "settings", extraActions = "" }) {
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-nav="${backRoute}">返回</button>
      <h1 class="section-title">${title}</h1>
      <span></span>
    </header>
    <form class="panel stack security-form" data-form="${form}">
      ${intro ? `<p class="muted">${intro}</p>` : ""}
      ${fields
        .map(
          ([name, label, autocomplete]) => `
            <div class="field security-field">
              <label>${label}</label>
              <input type="${name === "recoveryCode" ? "text" : "password"}" data-security-draft="${name}" autocomplete="${autocomplete}" />
            </div>
          `
        )
        .join("")}
      <button type="submit" class="${danger ? "danger" : ""}">${submit}</button>
      ${extraActions}
    </form>
  `;
}

function deletedView() {
  const deleted = state.vault.deletedItems.filter((item) => item.type === "person");
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-nav="settings">返回</button>
      <h1 class="section-title">最近刪除</h1>
      <span></span>
    </header>
    ${deleted.length ? deleted.map((item) => `
      <section class="panel inline-item">
        <strong>${escapeHtml(item.snapshot.name)}</strong>
        <span class="muted">將於 ${daysUntil(item.restoreUntil)} 天後永久刪除</span>
        <div class="actions">
          <button data-action="restore-person" data-id="${item.id}">還原</button>
          <button class="danger" data-action="purge-person" data-id="${item.id}">永久刪除</button>
        </div>
      </section>
    `).join("") : `<div class="empty">最近刪除目前是空的。</div>`}
  `;
}

function personCard(person) {
  person = normalizeDraft(person);
  const phone = sortDefaultFirst(person.phones)[0];
  return `
    <button class="person-card" data-detail="${person.id}">
      <span class="name">${escapeHtml(person.name)}</span>
      <span class="phone">${phone ? `${escapeHtml(phone.label)} ${escapeHtml(phone.value)}` : "尚未設定電話"}</span>
      <span class="card-updated">最近修改：${escapeHtml(formatDateOnly(person.updatedAt))}</span>
    </button>
  `;
}

function familyMemberLine(sourcePerson, member) {
  const linked = member.personId ? getPerson(member.personId) : null;
  const canOpen = linked && !linked.archivedAt;
  const name = member.name || linked?.name || "";
  const action = canOpen
    ? `<button type="button" class="ghost link-button" data-action="open-detail" data-id="${escapeAttr(linked.id)}">${escapeHtml(name)}</button>`
    : name
      ? linked?.archivedAt
        ? `<span class="muted">${escapeHtml(name)}</span>`
        : `<button type="button" class="ghost link-button" data-action="open-family-member" data-source-id="${escapeAttr(sourcePerson.id)}" data-member-id="${escapeAttr(member.id)}" data-name="${escapeAttr(name)}">${escapeHtml(name)}</button>`
      : "";
  return `<div class="detail-line"><span>${escapeHtml(member.relationship)}</span><span>${action}</span></div>`;
}

function basicDetailLines(person) {
  return [
    person.nickname ? detailLine("暱稱", person.nickname) : "",
    person.gender ? detailLine("性別", person.gender) : "",
    person.birthDate ? detailLine("生日", person.birthDate) : "",
    person.nationalId ? detailLine("身分證字號", person.nationalId, `<button class="action-quiet" data-copy="${escapeAttr(person.nationalId)}">複製</button>`) : "",
    ...((person.phones ?? []).length
      ? sortDefaultFirst(person.phones).map((phone) =>
          detailLine(
            `電話｜${phone.label}`,
            phone.value,
            `<a class="button-link" href="tel:${escapeAttr(phone.value)}">撥打</a><button class="action-quiet" data-copy="${escapeAttr(phone.value)}">複製</button>`
          )
        )
      : []),
    ...((person.addresses ?? []).length
      ? sortDefaultFirst(person.addresses).map((address) =>
          detailLinkLine(
            `地址｜${address.label}`,
            address.value,
            mapSearchUrl(address.value),
            `<button class="action-quiet" data-copy="${escapeAttr(address.value)}">複製</button>`
          )
        )
      : []),
    person.workInfo ? detailLine("公司/工作內容", person.workInfo) : ""
  ]
    .flat()
    .filter(Boolean)
    .join("");
}

function lifeEventLine(event) {
  const date = event.date ? formatCustomValue({ type: "date" }, event.date) : "未填日期";
  return detailLine(date, event.text);
}

function nameField(value) {
  return `
    <section class="panel">
      <h2 class="section-title">姓名 *</h2>
      <div class="row name-check-row">
        <input type="text" data-field="name" value="${escapeAttr(value)}" />
        <button type="button" class="action-quiet" data-action="check-duplicate-name">檢查重複姓名</button>
      </div>
    </section>
  `;
}

function basicFieldsEditor(d) {
  const expanded = Boolean(state.route.moreBasicFieldsExpanded);
  const fields = [
    { key: "nickname", filled: Boolean(d.nickname), html: inputField("暱稱", "nickname", d.nickname) },
    { key: "gender", filled: Boolean(d.gender), html: genderField(d.gender) },
    { key: "birthDate", filled: Boolean(d.birthDate), html: inputField("生日", "birthDate", d.birthDate, "date") },
    { key: "nationalId", filled: Boolean(d.nationalId), html: inputField("身分證字號", "nationalId", d.nationalId) },
    { key: "phones", filled: hasListValue(d.phones), html: listEditor("電話", "phones", d.phones, ["手機", "家裡", "公司", "其它"], "電話號碼") },
    { key: "addresses", filled: hasListValue(d.addresses), html: listEditor("地址", "addresses", d.addresses, ["住家", "公司", "其它"], "地址") },
    { key: "workInfo", filled: Boolean(d.workInfo), html: inputField("公司/工作內容", "workInfo", d.workInfo) }
  ];
  const visibleFields = expanded ? fields : fields.filter((field) => field.filled);
  return `
    <section class="more-fields-toggle">
      <span>${expanded ? "收起空白欄位" : "顯示更多欄位"}</span>
      <button type="button" class="disclosure-button" data-action="toggle-more-basic-fields" aria-label="${expanded ? "收起空白欄位" : "顯示更多欄位"}">${expanded ? "▲" : "▼"}</button>
    </section>
    ${visibleFields.map((field) => field.html).join("")}
  `;
}

function hasListValue(rows = []) {
  return rows.some((row) => String(row.value ?? "").trim());
}

function inputField(label, field, value, type = "text") {
  if (field === "nationalId") {
    return `
      <section class="panel">
        <h2 class="section-title">${label}</h2>
        <div class="input-status-row">
          <input type="${type}" data-field="${field}" data-validate-national-id="true" value="${escapeAttr(value)}" />
          <span class="field-error" data-national-id-message>${nationalIdErrorText(value)}</span>
        </div>
      </section>
    `;
  }
  return `<section class="panel"><h2 class="section-title">${label}</h2><input type="${type}" data-field="${field}" value="${escapeAttr(value)}" /></section>`;
}

function genderField(value) {
  return `
    <section class="panel">
      <h2 class="section-title">性別</h2>
      <div class="chip-list">
        ${GENDER_OPTIONS.map((option) => `
          <button type="button" class="chip ${value === option ? "selected" : ""}" data-action="set-gender" data-value="${escapeAttr(option)}">${value === option ? "✓ " : ""}${escapeHtml(option)}</button>
        `).join("")}
      </div>
    </section>
  `;
}

function listEditor(title, key, rows, labels, placeholder) {
  const deleting = Boolean(state.route[listDeleteModeKey(key)]);
  const addLabel = `＋ 新增${title}`;
  const deleteLabel = deleting ? "完成編輯" : `刪除${title}`;
  return `
    <section class="panel">
      <h2 class="section-title">${title}</h2>
      <div class="stack">
        ${rows.map((row, index) => `
          <div class="inline-item">
            ${key === "addresses" ? addressListEditorRow(key, row, index, labels, placeholder, deleting) : phoneListEditorRow(key, row, index, labels, placeholder, deleting)}
          </div>
        `).join("")}
      </div>
      <div class="actions">
        <button type="button" class="action-soft" data-action="add-list-item" data-list-key="${key}">${addLabel}</button>
        <button type="button" class="action-quiet" data-action="toggle-list-delete-mode" data-list-key="${key}">${deleteLabel}</button>
      </div>
    </section>
  `;
}

function listDeleteModeKey(key) {
  return key === "phones" ? "phoneDeleteMode" : "addressDeleteMode";
}

function listLabelSelect(key, row, index, labels, className = "list-label-select") {
  return `
    <select class="${className}" data-list="${key}" data-index="${index}" data-prop="label">
      ${labels.map((label) => `<option ${row.label === label ? "selected" : ""}>${label}</option>`).join("")}
    </select>
  `;
}

function listDefaultButton(key, row, index) {
  return `<button type="button" class="secondary default-inline-button" data-action="set-default" data-list-key="${key}" data-index="${index}">${row.isDefault ? "預設" : "設為預設"}</button>`;
}

function listValueInput(key, row, index, placeholder) {
  return `<input data-list="${key}" data-index="${index}" data-prop="value" placeholder="${placeholder}" value="${escapeAttr(row.value)}" />`;
}

function listRemoveButton(key, index, deleting) {
  if (!deleting) return "";
  return `<button type="button" class="danger" data-action="remove-list-item" data-list-key="${key}" data-index="${index}">刪除</button>`;
}

function phoneListEditorRow(key, row, index, labels, placeholder, deleting) {
  return `
    <div class="row list-editor-row phone-list-row ${deleting ? "has-delete" : ""}">
      ${listLabelSelect(key, row, index, labels, "list-label-select phone-label-select")}
      ${listDefaultButton(key, row, index)}
      ${listValueInput(key, row, index, placeholder)}
      ${listRemoveButton(key, index, deleting)}
    </div>
  `;
}

function addressListEditorRow(key, row, index, labels, placeholder, deleting) {
  return `
    <div class="address-list-row ${deleting ? "has-delete" : ""}">
      <div class="row address-list-top-row">
        ${listLabelSelect(key, row, index, labels)}
        ${listDefaultButton(key, row, index)}
      </div>
      <div class="row address-region-row">
        ${addressCitySelect(row, index)}
        ${addressDistrictSelect(row, index)}
      </div>
      <div class="row address-list-bottom-row">
        ${addressDetailInput(row, index, placeholder)}
        ${listRemoveButton(key, index, deleting)}
      </div>
    </div>
  `;
}

function addressCitySelect(row, index) {
  const city = row.city ?? "";
  return `
    <select class="address-city-select" data-address="${index}" data-prop="city">
      <option value="" ${city ? "" : "selected"}>縣市</option>
      ${ADDRESS_CITY_OPTIONS.map((item) => `<option value="${escapeAttr(item)}" ${city === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
    </select>
  `;
}

function addressDistrictSelect(row, index) {
  const city = row.city ?? "";
  const districts = ADDRESS_CITY_DISTRICTS[city] ?? [];
  const district = districts.includes(row.district) ? row.district : "";
  return `
    <select class="address-district-select" data-address="${index}" data-prop="district" ${districts.length ? "" : "disabled"}>
      <option value="" ${district ? "" : "selected"}>行政區</option>
      ${districts.map((item) => `<option value="${escapeAttr(item)}" ${district === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
    </select>
  `;
}

function addressDetailInput(row, index, placeholder) {
  return `<input data-address="${index}" data-prop="detail" placeholder="${placeholder}" value="${escapeAttr(addressDetailValue(row))}" />`;
}

function addressDetailValue(row) {
  if ("detail" in row) return row.detail ?? "";
  if (row.city || row.district) {
    return String(row.value ?? "").replace(`${row.city ?? ""}${row.district ?? ""}`, "");
  }
  return row.value ?? "";
}

function personGroupEditor(selectedIds) {
  const managing = Boolean(state.route.personGroupManage);
  const nameEditing = Boolean(state.route.personGroupNameEditMode);
  return `
    <section class="panel">
      <h2 class="section-title">人物群組</h2>
      <div class="chip-list">${state.vault.personGroupTags.map((tag) => nameEditing ? tagNameEditOption(tag, "personGroup") : tagOption(tag, selectedIds.includes(tag.id), managing, "toggle-person-group", "remove-person-group")).join("")}</div>
      ${managing ? personGroupManageForm() : ""}
      <div class="actions">
        <button type="button" class="action-soft" data-action="toggle-person-group-manage">${managing ? "完成編輯" : "新增/移除人物群組"}</button>
        <button type="button" class="action-quiet" data-action="toggle-person-group-name-edit-mode">${nameEditing ? "完成名稱編輯" : "編輯標籤名稱"}</button>
        <button type="button" class="action-quiet" data-action="restore-default-person-groups">恢復預設人物群組</button>
      </div>
    </section>
  `;
}

function personGroupManageForm() {
  return `
    <div class="inline-item manage-form">
      <div class="field interest-manage-field">
        <label>新增人物群組名稱</label>
        <div class="row interest-manage-row">
          <input data-route-field="newPersonGroupName" placeholder="例如：鄰居" value="${escapeAttr(state.route.newPersonGroupName ?? "")}" />
          <button type="button" class="action-quiet" data-action="confirm-add-person-group">確認</button>
        </div>
      </div>
    </div>
  `;
}

function tagOption(tag, selected, managing, toggleAction, removeAction) {
  return `
    <span class="tag-option">
      ${interestChip(tag, selected, toggleAction)}
      ${managing ? `<button type="button" class="danger mini" data-action="${removeAction}" data-id="${tag.id}">移除</button>` : ""}
    </span>
  `;
}

function tagNameEditOption(tag, kind) {
  const editing = state.route.editingTagName?.kind === kind && state.route.editingTagName.id === tag.id;
  return `
    <span class="tag-option tag-name-edit-option">
      ${
        editing
          ? `<input class="tag-name-input" data-tag-rename="${kind}" data-id="${tag.id}" value="${escapeAttr(state.route.editingTagName.value ?? tag.name)}" />`
          : `<span class="chip inert">${tagLabel(tag)}</span>`
      }
      ${tag.isDefault ? "" : `<button type="button" class="action-quiet mini" data-action="${editing ? `finish-${kind}-tag-rename` : `start-${kind}-tag-rename`}" data-id="${tag.id}">${editing ? "完成" : "編輯"}</button>`}
    </span>
  `;
}

function interestEditor(selectedIds) {
  const managing = Boolean(state.route.interestManage);
  const nameEditing = Boolean(state.route.interestNameEditMode);
  return `
    <section class="panel">
      <h2 class="section-title">興趣喜好</h2>
      <div class="chip-list">${state.vault.interestTags.map((tag) => nameEditing ? tagNameEditOption(tag, "interest") : interestOption(tag, selectedIds.includes(tag.id), managing)).join("")}</div>
      ${managing ? interestManageForm() : ""}
      <div class="actions">
        <button type="button" class="${managing ? "action-soft" : "action-soft"}" data-action="toggle-interest-manage">${managing ? "完成編輯" : "新增/移除興趣喜好"}</button>
        <button type="button" class="action-quiet" data-action="toggle-interest-name-edit-mode">${nameEditing ? "完成名稱編輯" : "編輯標籤名稱"}</button>
        <button type="button" class="action-quiet" data-action="restore-default-interests">恢復預設興趣喜好</button>
      </div>
    </section>
  `;
}

function interestOption(tag, selected, managing) {
  return tagOption(tag, selected, managing, "toggle-interest", "remove-interest");
}

function interestManageForm() {
  return `
    <div class="inline-item manage-form">
      <div class="field interest-manage-field">
        <label>新增興趣喜好名稱</label>
        <div class="row interest-manage-row">
          <input data-route-field="newInterestName" placeholder="例如：🍞 烘焙" value="${escapeAttr(state.route.newInterestName ?? "")}" />
          <button type="button" class="action-quiet" data-action="confirm-add-interest">確認</button>
        </div>
      </div>
    </div>
  `;
}

function favoriteItemsEditor(rows) {
  const deleting = Boolean(state.route.favoriteItemDeleteMode);
  return `
    <section class="panel">
      <h2 class="section-title">嗜好品</h2>
      <div class="stack">
        ${rows.length ? rows.map((row, index) => `
          <div class="inline-item">
            <div class="row compact-editor-row">
              <input data-favorite-item="${index}" placeholder="例如：咖啡、紅酒、雪茄" value="${escapeAttr(row.value)}" />
              ${deleting ? `<button type="button" class="danger compact-row-button" data-action="remove-favorite-item" data-index="${index}">刪除</button>` : ""}
            </div>
          </div>
        `).join("") : `<p class="muted">尚未新增嗜好品</p>`}
      </div>
      <div class="actions">
        <button type="button" class="action-soft" data-action="add-favorite-item">＋ 新增嗜好品</button>
        <button type="button" class="action-quiet" data-action="toggle-favorite-item-delete-mode">${deleting ? "完成編輯" : "刪除欄位"}</button>
      </div>
    </section>
  `;
}

function familyMembersEditor(rows, currentPersonId) {
  const deleting = Boolean(state.route.familyMemberDeleteMode);
  const suggestions = visiblePeople(state.vault.people).filter((person) => person.id !== currentPersonId);
  const listId = `family-name-options-${currentPersonId}`;
  return `
    <section class="panel">
      <h2 class="section-title">家族成員</h2>
      <datalist id="${listId}">
        ${suggestions.map((person) => `<option value="${escapeAttr(person.name)}" data-person-id="${escapeAttr(person.id)}"></option>`).join("")}
      </datalist>
      <div class="stack">
        ${rows.length ? familyMemberEditorEntries(rows).map(({ row, index }) => familyMemberEditorRow(row, index, listId, deleting)).join("") : `<p class="muted">尚未新增家族成員。</p>`}
      </div>
      <div class="actions">
        <button type="button" class="action-soft" data-action="add-family-member">＋ 新增家族成員</button>
        <button type="button" class="action-quiet" data-action="toggle-family-member-delete-mode">${deleting ? "完成編輯" : "刪除成員"}</button>
      </div>
    </section>
  `;
}

function familyMemberEditorRow(row, index, listId, deleting) {
  const preset = FAMILY_RELATIONSHIP_ORDER.includes(row.relationship) ? row.relationship : "其它";
  return `
    <div class="inline-item">
      <div class="row family-member-row ${preset === "其它" ? "has-custom-relationship" : ""} ${deleting ? "has-delete" : ""}">
        <select class="relationship-select" data-family-member="${index}" data-prop="relationshipPreset">
          ${FAMILY_RELATIONSHIP_OPTIONS.map((label) => `<option value="${label}" ${preset === label ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        ${
          preset === "其它"
            ? `<input class="custom-relationship-input" data-family-member="${index}" data-prop="customRelationship" placeholder="自訂稱謂" value="${escapeAttr(customRelationshipValue(row))}" />`
            : ""
        }
        <input data-family-member="${index}" data-prop="name" list="${listId}" placeholder="姓名" value="${escapeAttr(row.name)}" />
        ${deleting ? `<button type="button" class="danger compact-row-button" data-action="remove-family-member" data-index="${index}">刪除</button>` : ""}
      </div>
    </div>
  `;
}

function familyMemberEditorEntries(rows = []) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => compareFamilyMembers(a.row, b.row));
}

function lifeEventsEditor(rows) {
  const deleting = Boolean(state.route.lifeEventDeleteMode);
  return `
    <section class="panel">
      <h2 class="section-title">重要記事</h2>
      <div class="stack">
        ${rows.length ? rows.map((row, index) => `
          <div class="inline-item">
            <div class="row life-event-row ${deleting ? "has-delete" : ""}">
              <input class="date-input" type="date" data-life-event="${index}" data-prop="date" value="${escapeAttr(row.date)}" />
              <textarea class="life-event-textarea" rows="1" data-life-event="${index}" data-prop="text" placeholder="記事內容">${escapeHtml(row.text)}</textarea>
              ${deleting ? `<button type="button" class="danger compact-row-button" data-action="remove-life-event" data-index="${index}">刪除</button>` : ""}
            </div>
          </div>
        `).join("") : `<p class="muted">尚未新增重要記事</p>`}
      </div>
      <div class="actions">
        <button type="button" class="action-soft" data-action="add-life-event">＋ 新增重要記事</button>
        <button type="button" class="action-quiet" data-action="toggle-life-event-delete-mode">${deleting ? "完成編輯" : "刪除欄位"}</button>
      </div>
    </section>
  `;
}

function interestChip(tag, selected, action) {
  return `<button type="button" class="chip ${selected ? "selected" : ""}" data-action="${action}" data-id="${tag.id}">${selected ? "✓ " : ""}${tagLabel(tag)}</button>`;
}

function tagLabel(tag) {
  return escapeHtml(tag.name);
}

function tagLabelPlain(tag) {
  return tag.name;
}

function customFieldEditor(person) {
  const fields = customDefsForPerson(person.id);
  const adding = Boolean(state.route.customFieldAdd);
  return `
    <section class="panel">
      <h2 class="section-title">自訂欄位</h2>
      <div class="stack">
        ${fields.length ? fields.map((field) => customFieldInput(field, person)).join("") : `<p class="muted">尚未建立自訂欄位。</p>`}
      </div>
      ${adding ? customFieldAddForm() : ""}
      <div class="actions">
        <button type="button" class="action-soft" data-action="toggle-custom-field-add">＋ 新增自訂欄位</button>
      </div>
    </section>
  `;
}

function customFieldAddForm() {
  const draft = state.route.customFieldDraft ?? { name: "", type: "text", scope: "person", options: [], newOption: "" };
  const needsOptions = isChoiceField(draft);
  return `
    <div class="inline-item manage-form">
      <div class="field">
        <label>欄位名稱</label>
        <input data-custom-draft="name" placeholder="例如：紀念日" value="${escapeAttr(draft.name)}" />
      </div>
      <div class="field">
        <label>欄位類型</label>
        <select data-custom-draft="type">
          <option value="text" ${draft.type === "text" ? "selected" : ""}>文字</option>
          <option value="number" ${draft.type === "number" ? "selected" : ""}>數字</option>
          <option value="date" ${draft.type === "date" ? "selected" : ""}>日期</option>
          <option value="dateRange" ${draft.type === "dateRange" ? "selected" : ""}>日期區間</option>
          <option value="single" ${draft.type === "single" ? "selected" : ""}>單選</option>
          <option value="multi" ${draft.type === "multi" ? "selected" : ""}>多選</option>
        </select>
      </div>
      <div class="field">
        <label>套用範圍</label>
        <select data-custom-draft="scope">
          <option value="global" ${draft.scope === "global" ? "selected" : ""}>所有人物</option>
          <option value="person" ${draft.scope === "person" ? "selected" : ""}>僅此人物</option>
        </select>
      </div>
      ${
        needsOptions
          ? `<div class="field">
              <label>選項</label>
              <div class="chip-list">${(draft.options ?? []).map((option, index) => `<span class="tag-option"><span class="chip selected">${escapeHtml(option)}</span><button type="button" class="danger mini" data-action="remove-custom-field-draft-option" data-index="${index}">移除</button></span>`).join("")}</div>
              <div class="row manage-form">
                <input data-custom-draft="newOption" placeholder="新增選項" value="${escapeAttr(draft.newOption ?? "")}" />
                <button type="button" class="action-soft" data-action="add-custom-field-draft-option">新增</button>
              </div>
            </div>`
          : ""
      }
      <div class="actions">
        <button type="button" class="action-soft" data-action="confirm-add-custom-field">確認</button>
        <button type="button" class="secondary" data-action="cancel-custom-field-add">取消</button>
      </div>
    </div>
  `;
}

function customFieldInput(field, person) {
  const current = person.customValues.find((item) => item.fieldId === field.id)?.value ?? "";
  const editing = state.route.activeCustomFieldEditId === field.id;
  if (field.type === "dateRange") {
    return `
      <div class="inline-item custom-field-card">
        <div class="field custom-field-main">
          <div class="custom-field-header">
            <label>${escapeHtml(field.name)}</label>
            <button type="button" class="action-quiet" data-action="toggle-custom-field-edit" data-id="${field.id}">${editing ? "完成編輯" : "編輯自訂欄位"}</button>
          </div>
          <div class="stack">
            ${dateRangeRows(current, true).map((row, index) => dateRangeEditorRow(field.id, row, index)).join("")}
          </div>
          <div class="actions compact-actions">
            <button type="button" class="action-soft" data-action="add-custom-date-range-row" data-field-id="${field.id}">＋ 新增一筆</button>
          </div>
        </div>
        ${editing ? customFieldActions(field) : ""}
      </div>
    `;
  }
  if (isChoiceField(field)) {
    return `
      <div class="inline-item custom-field-card">
        <div class="field custom-field-main">
          <div class="custom-field-header">
            <label>${escapeHtml(field.name)}</label>
            <button type="button" class="action-quiet" data-action="toggle-custom-field-edit" data-id="${field.id}">${editing ? "完成編輯" : "編輯自訂欄位"}</button>
          </div>
          <div class="chip-list">${(field.options ?? []).map((option) => choiceChip(field, current, option)).join("")}</div>
        </div>
        ${editing ? customFieldActions(field) : ""}
      </div>
    `;
  }
  const type = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
  return `
    <div class="inline-item custom-field-card">
      <div class="field custom-field-main">
        <div class="custom-field-header">
          <label>${escapeHtml(field.name)}</label>
          <button type="button" class="action-quiet" data-action="toggle-custom-field-edit" data-id="${field.id}">${editing ? "完成編輯" : "編輯自訂欄位"}</button>
        </div>
        <input type="${type}" data-custom-value="${field.id}" value="${escapeAttr(current)}" />
      </div>
      ${editing ? customFieldActions(field) : ""}
    </div>
  `;
}

function dateRangeEditorRow(fieldId, row, index) {
  return `
    <div class="inline-item custom-date-range-row">
      <div class="row date-range-date-row">
        <input type="date" data-custom-date-range="${fieldId}" data-index="${index}" data-prop="startDate" value="${escapeAttr(row.startDate ?? "")}" aria-label="開始日期" />
        <input type="date" data-custom-date-range="${fieldId}" data-index="${index}" data-prop="endDate" value="${escapeAttr(row.endDate ?? "")}" aria-label="結束日期" />
        <button type="button" class="danger compact-row-button" data-action="remove-custom-date-range-row" data-field-id="${fieldId}" data-index="${index}">刪除</button>
      </div>
      <textarea class="life-event-textarea" rows="1" data-custom-date-range="${fieldId}" data-index="${index}" data-prop="text" placeholder="說明文字">${escapeHtml(row.text ?? "")}</textarea>
    </div>
  `;
}

function customFieldActions(field) {
  const canEditInline = state.route.editingCustomFieldId === field.id;
  return `
    <div class="stack">
      <div class="inline-actions">
      ${
        canEditInline
          ? `<input data-route-field="editingCustomFieldName" value="${escapeAttr(state.route.editingCustomFieldName ?? field.name)}" /><button type="button" class="action-soft" data-action="confirm-rename-custom-field" data-id="${field.id}">確認改名</button><button type="button" class="secondary" data-action="cancel-rename-custom-field">取消</button>`
          : `<button type="button" class="action-quiet" data-action="start-rename-custom-field" data-id="${field.id}">變更欄位名稱</button><button type="button" class="danger" data-action="delete-custom-field" data-id="${field.id}">刪除欄位</button>`
      }
      </div>
      ${isChoiceField(field) ? customFieldOptionEditor(field) : ""}
    </div>
  `;
}

function choiceChip(field, current, option) {
  const selected = field.type === "multi" ? (Array.isArray(current) && current.includes(option)) : current === option;
  return `<button type="button" class="chip ${selected ? "selected" : ""}" data-action="toggle-custom-choice" data-field-id="${field.id}" data-option="${escapeAttr(option)}">${selected ? "✓ " : ""}${escapeHtml(option)}</button>`;
}

function customFieldOptionEditor(field) {
  const newValue = state.route.newCustomOptionNames?.[field.id] ?? "";
  return `
    <div class="inline-item">
      <strong>選項設定</strong>
      <div class="stack">
        ${(field.options ?? []).map((option) => {
          const draftName = state.route.editingCustomOptionNames?.[field.id]?.[option] ?? option;
          return `
            <div class="row custom-option-row">
              <input data-custom-option-name="${field.id}" data-option="${escapeAttr(option)}" value="${escapeAttr(draftName)}" />
              <button type="button" class="action-quiet custom-option-action" data-action="rename-custom-option" data-field-id="${field.id}" data-option="${escapeAttr(option)}">變更選項名稱</button>
              <button type="button" class="danger" data-action="delete-custom-option" data-field-id="${field.id}" data-option="${escapeAttr(option)}">刪除選項</button>
            </div>
          `;
        }).join("")}
      </div>
      <div class="row">
        <input data-custom-option-new="${field.id}" placeholder="選項名稱" value="${escapeAttr(newValue)}" />
        <button type="button" class="action-soft" data-action="add-custom-option" data-field-id="${field.id}">新增選項</button>
      </div>
    </div>
  `;
}

function customDetailContent(field, value) {
  if (field.type === "dateRange") {
    const rows = cleanDateRangeValues(value);
    return rows.map((row) => dateRangeDetailLine(row)).join("");
  }
  return `<p class="detail-value">${escapeHtml(formatCustomValue(field, value))}</p>`;
}

function dateRangeDetailLine(row) {
  const period = formatDateRangePeriod(row);
  return detailLine(period || "未填日期", row.text ?? "");
}

function formatDateRangePeriod(row) {
  const start = row.startDate ? formatCustomValue({ type: "date" }, row.startDate) : "";
  const end = row.endDate ? formatCustomValue({ type: "date" }, row.endDate) : "";
  if (start && end) return `${start} ～ ${end}`;
  if (start) return `${start} 起`;
  if (end) return `至 ${end}`;
  return "";
}

function brandLogo(variant) {
  return `
    <div class="brand-logo-wrap ${variant === "home" ? "home-brand" : "welcome-brand"}">
      <img class="brand-logo" src="./pics/brand/banner.png" alt="莫忘" />
      <span class="visually-hidden">莫忘</span>
    </div>
  `;
}

function detailGroup(title, content, className = "", headerAction = "") {
  if (!content) return "";
  return `<section class="detail-section ${className}"><div class="detail-section-header"><h2 class="section-title">${escapeHtml(title)}</h2>${headerAction}</div>${content}</section>`;
}

function detailLine(label, value = "", action = "", className = "") {
  return `<div class="detail-line ${className}"><span>${escapeHtml(label)}${value ? `<br><span class="muted">${escapeHtml(value)}</span>` : ""}</span><span class="detail-actions-row">${action}</span></div>`;
}

function detailLinkLine(label, value = "", href = "", action = "", className = "") {
  const linkedValue = value && href
    ? `<a class="detail-value-link" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`
    : escapeHtml(value);
  return `<div class="detail-line ${className}"><span>${escapeHtml(label)}${value ? `<br><span class="muted">${linkedValue}</span>` : ""}</span><span class="detail-actions-row">${action}</span></div>`;
}

function mapSearchUrl(address) {
  const cleanAddress = String(address ?? "").trim();
  if (!cleanAddress) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleanAddress)}`;
}

function bottomNav(current) {
  const target = current === "home" ? { name: "settings", label: "設定" } : { name: "home", label: "首頁" };
  const backAttribute = current === "settings" ? ` data-back="true"` : "";
  return `
    <nav class="bottom-nav">
      <button data-nav="${target.name}"${backAttribute}>${target.label}</button>
    </nav>
  `;
}

function notFoundView() {
  return `<div class="empty">找不到這筆人物資料。<div class="actions"><button data-nav="home">回首頁</button></div></div>`;
}

function bind() {
  app.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      const fallbackRoute = {
        name: el.dataset.nav,
        id: el.dataset.id,
        ...(el.dataset.mode ? { mode: el.dataset.mode } : {})
      };
      if (shouldUseBackNavigation(el)) navigateBack(fallbackRoute);
      else navigate(fallbackRoute);
    });
  });
  app.querySelectorAll("[data-detail]").forEach((el) => {
    el.addEventListener("click", () => navigate(detailRoute(el.dataset.detail)));
  });
  app.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", (event) => handleAction(event, el));
  });
  app.querySelectorAll("[data-field]").forEach((el) => {
    el.addEventListener("input", () => {
      if (!state.route.draft) return;
      if (el.dataset.field === "nationalId") el.value = el.value.toUpperCase();
      state.route.draft[el.dataset.field] = el.value;
      if (el.dataset.validateNationalId === "true") updateNationalIdFeedback(el);
    });
    if (el.dataset.validateNationalId === "true") {
      el.addEventListener("blur", () => updateNationalIdFeedback(el));
    }
  });
  app.querySelectorAll("[data-route-field]").forEach((el) => {
    el.addEventListener("input", () => {
      state.route[el.dataset.routeField] = el.value;
    });
  });
  app.querySelectorAll("[data-tag-rename]").forEach((el) => {
    el.addEventListener("input", () => {
      state.route.editingTagName = {
        kind: el.dataset.tagRename,
        id: el.dataset.id,
        value: el.value
      };
    });
  });
  app.querySelectorAll("[data-custom-draft]").forEach((el) => {
    el.addEventListener("input", () => {
      state.route.customFieldDraft ??= { name: "", type: "text", scope: "person", options: [], newOption: "" };
      state.route.customFieldDraft[el.dataset.customDraft] = el.value;
    });
    el.addEventListener("change", () => {
      if (["type", "scope"].includes(el.dataset.customDraft)) render();
    });
  });
  app.querySelectorAll("[data-custom-option-name]").forEach((el) => {
    el.addEventListener("input", () => {
      state.route.editingCustomOptionNames ??= {};
      state.route.editingCustomOptionNames[el.dataset.customOptionName] ??= {};
      state.route.editingCustomOptionNames[el.dataset.customOptionName][el.dataset.option] = el.value;
    });
  });
  app.querySelectorAll("[data-custom-option-new]").forEach((el) => {
    el.addEventListener("input", () => {
      state.route.newCustomOptionNames ??= {};
      state.route.newCustomOptionNames[el.dataset.customOptionNew] = el.value;
    });
  });
  app.querySelectorAll("[data-password-draft]").forEach((el) => {
    el.addEventListener("input", () => {
      state.route.passwordDraft ??= { password: "", confirm: "" };
      state.route.passwordDraft[el.dataset.passwordDraft] = el.value;
    });
  });
  app.querySelectorAll("[data-security-draft]").forEach((el) => {
    el.addEventListener("input", () => {
      state.route.securityDraft ??= {};
      state.route.securityDraft[el.dataset.securityDraft] = el.value;
    });
  });
  app.querySelectorAll("[data-list]").forEach((el) => {
    const update = () => {
      const row = state.route.draft[el.dataset.list][Number(el.dataset.index)];
      row[el.dataset.prop] = el.value;
    };
    el.addEventListener("input", update);
    el.addEventListener("change", update);
  });
  app.querySelectorAll("[data-address]").forEach((el) => {
    const update = () => updateAddressDraft(el);
    el.addEventListener("input", update);
    el.addEventListener("change", update);
  });
  app.querySelectorAll("[data-favorite-item]").forEach((el) => {
    el.addEventListener("input", () => {
      state.route.draft.favoriteItems[Number(el.dataset.favoriteItem)].value = el.value;
    });
  });
  app.querySelectorAll("[data-family-member]").forEach((el) => {
    el.addEventListener("input", () => updateFamilyMemberDraft(el));
    el.addEventListener("change", () => updateFamilyMemberDraft(el));
  });
  app.querySelectorAll("[data-life-event]").forEach((el) => {
    if (el.classList.contains("life-event-textarea")) autoResizeTextarea(el);
    el.addEventListener("input", () => {
      const row = state.route.draft.lifeEvents[Number(el.dataset.lifeEvent)];
      row[el.dataset.prop] = el.value;
      if (el.classList.contains("life-event-textarea")) autoResizeTextarea(el);
    });
  });
  app.querySelectorAll("[data-custom-value]").forEach((el) => {
    el.addEventListener("input", () => {
      if (!state.route.draft) return;
      const fieldId = el.dataset.customValue;
      const field = state.vault.customFieldDefs.find((item) => item.id === fieldId);
      const customValues = state.route.draft.customValues.filter((item) => item.fieldId !== fieldId);
      const value = field?.type === "number" && el.value !== "" ? Number(el.value) : el.value;
      state.route.draft.customValues = [
        ...customValues,
        { fieldId, value, updatedAt: new Date().toISOString(), updatedByDeviceId: state.appState.deviceId }
      ];
    });
  });
  app.querySelectorAll("[data-custom-date-range]").forEach((el) => {
    if (el.classList.contains("life-event-textarea")) autoResizeTextarea(el);
    const update = () => {
      if (!state.route.draft) return;
      const fieldId = el.dataset.customDateRange;
      const rows = dateRangeRows(getCustomValue(state.route.draft, fieldId), true);
      const row = rows[Number(el.dataset.index)];
      if (!row) return;
      row[el.dataset.prop] = el.value;
      setCustomValue(state.route.draft, fieldId, cleanDateRangeValues(rows));
      if (el.classList.contains("life-event-textarea")) autoResizeTextarea(el);
    };
    el.addEventListener("input", update);
    el.addEventListener("change", update);
  });
  app.querySelectorAll("[data-search]").forEach((el) => {
    const updateSearch = () => {
      const params = normalizeSearchParams(state.route.params);
      params[el.dataset.search] = el.value;
      state.route.params = params;
    };
    el.addEventListener("input", updateSearch);
    el.addEventListener("change", updateSearch);
  });
  const form = app.querySelector("[data-form='person']");
  if (form) form.addEventListener("submit", savePersonForm);
  const masterPasswordForm = app.querySelector("[data-form='master-password']");
  if (masterPasswordForm) masterPasswordForm.addEventListener("submit", setupMasterPassword);
  bindSecurityForms();
  const importFile = app.querySelector("[data-import-file]");
  if (importFile) importFile.addEventListener("change", importDataFile);
  app.querySelectorAll("[data-copy]").forEach((el) => {
    el.addEventListener("click", () => navigator.clipboard?.writeText(el.dataset.copy));
  });
}

function shouldUseBackNavigation(el) {
  if (el.dataset.back === "true") return true;
  const label = el.textContent.trim();
  if (label === "返回") return true;
  if (state.route.name === "settings" && el.dataset.nav === "home" && label === "首頁") return true;
  return false;
}

function bindSecurityForms() {
  const handlers = {
    unlock: unlockWithMasterPassword,
    "drive-existing-unlock": unlockExistingDriveVault,
    "drive-merge-unlock": mergeExistingDriveVault,
    "drive-recovery-reset": resetCloudPasswordWithRecovery,
    "device-approval-recovery": startDeviceApprovalRecovery,
    "recovery-v2-complete": completeRecoveryV2,
    "drive-revision-recovery": scanDriveRevisionRecovery,
    "change-password": changeMasterPassword,
    "forgot-password": resetForgottenPassword,
    "regenerate-recovery": regenerateRecoveryCode,
    "logout-all-devices": logoutAllDevices
  };
  Object.entries(handlers).forEach(([formName, handler]) => {
    const form = app.querySelector(`[data-form='${formName}']`);
    if (form) form.addEventListener("submit", handler);
  });
}

async function handleAction(event, el) {
  const action = el.dataset.action;
  if (action === "start-local") return initializeLocalMode();
  if (action === "apply-update") return applyUpdate();
  if (action === "check-version-update") return checkVersionUpdate();
  if (action === "set-theme") return setTheme(el.dataset.themeId);
  if (action === "enable-biometric-unlock") return enableBiometricUnlock();
  if (action === "disable-biometric-unlock") return disableBiometricUnlock();
  if (action === "biometric-unlock") return unlockWithBiometric();
  if (action === "install-app") return installApp();
  if (action === "open-install-guide") return navigate({ name: "installGuide" });
  if (action === "dismiss-install-tip") return dismissInstallTip();
  if (action === "drive-placeholder") return beginDriveSetup();
  if (action === "use-local-drive-setup") return useLocalDataForDriveSetup();
  if (action === "cancel-drive-setup") return cancelDriveSetup();
  if (action === "confirm-recovery-saved") return finishRecoveryCode();
  if (action === "sync-now") return syncNow();
  if (action === "resolve-sync-conflict") return resolveSyncConflict(Number(el.dataset.index), el.dataset.source);
  if (action === "drive-logout") return logoutGoogleDrive();
  if (action === "refresh-recovery-requests") return refreshRecoveryRequests();
  if (action === "check-recovery-request") return checkRecoveryRequest();
  if (action === "approve-recovery-request") return approveRecoveryRequest(el.dataset.requestId, el.dataset.pairingCode);
  if (action === "apply-drive-revision-recovery") return applyDriveRevisionRecovery();
  if (action === "export-data") return exportData();
  if (action === "export-excel") return exportExcel();
  if (action === "choose-import-file") return app.querySelector("[data-import-file]")?.click();
  if (action === "restore-local-snapshot") return restoreLocalSnapshot(el.dataset.id);
  if (action === "delete-local-snapshot") return deleteLocalSnapshot(el.dataset.id);
  if (action === "download-local-snapshot") return downloadLocalSnapshot(el.dataset.id);
  if (action === "open-detail") return navigate(detailRoute(el.dataset.id));
  if (action === "detail-back") return navigateBackFromDetail();
  if (action === "important-notes-back") return navigateBack(detailRoute(state.route.id));
  if (action === "cancel-form") return navigateBack(state.route.id ? detailRoute(state.route.id) : { name: "home" });
  if (action === "edit-person") return navigate({ name: "edit", id: el.dataset.id, returnTo: state.route.returnTo });
  if (action === "toggle-more-basic-fields") return toggleMoreBasicFields();
  if (action === "set-gender") return setGender(el.dataset.value);
  if (action === "check-duplicate-name") return checkDuplicateName();
  if (action === "open-family-member") return openFamilyMember(el.dataset.sourceId, el.dataset.memberId, el.dataset.name);
  if (action === "select-family-member-link") return linkFamilyMemberAndOpen(el.dataset.sourceId, el.dataset.memberId, el.dataset.targetId, { replace: true });
  if (action === "delete-person") return deletePerson(el.dataset.id);
  if (action === "archive-person") return archivePerson(el.dataset.id);
  if (action === "restore-archived-person") return restoreArchivedPerson(el.dataset.id);
  if (action === "delete-archived-person") return deleteArchivedPerson(el.dataset.id);
  if (action === "restore-person") return restorePerson(el.dataset.id);
  if (action === "purge-person") return purgePerson(el.dataset.id);
  if (action === "add-list-item") return addListItem(el.dataset.listKey);
  if (action === "remove-list-item") return removeListItem(el.dataset.listKey, Number(el.dataset.index));
  if (action === "toggle-list-delete-mode") return toggleRouteFlag(listDeleteModeKey(el.dataset.listKey));
  if (action === "set-default") return setDefault(el.dataset.listKey, Number(el.dataset.index));
  if (action === "add-favorite-item") return addFavoriteItem();
  if (action === "remove-favorite-item") return removeFavoriteItem(Number(el.dataset.index));
  if (action === "toggle-favorite-item-delete-mode") return toggleRouteFlag("favoriteItemDeleteMode");
  if (action === "add-family-member") return addFamilyMember();
  if (action === "remove-family-member") return removeFamilyMember(Number(el.dataset.index));
  if (action === "toggle-family-member-delete-mode") return toggleRouteFlag("familyMemberDeleteMode");
  if (action === "add-life-event") return addLifeEvent();
  if (action === "remove-life-event") return removeLifeEvent(Number(el.dataset.index));
  if (action === "toggle-life-event-delete-mode") return toggleRouteFlag("lifeEventDeleteMode");
  if (action === "new-person-prefill") return navigate({ name: "new", prefillName: el.dataset.name });
  if (action === "toggle-person-group") return togglePersonGroup(el.dataset.id);
  if (action === "search-group") return toggleSearchGroup(el.dataset.id);
  if (action === "search-gender") return toggleSearchGender(el.dataset.id);
  if (action === "toggle-person-group-manage") return togglePersonGroupManage();
  if (action === "confirm-add-person-group") return addPersonGroup();
  if (action === "remove-person-group") return removePersonGroup(el.dataset.id);
  if (action === "restore-default-person-groups") return restoreDefaultPersonGroups();
  if (action === "toggle-person-group-name-edit-mode") return togglePersonGroupNameEditMode();
  if (action === "start-personGroup-tag-rename") return startTagRename("personGroup", el.dataset.id);
  if (action === "finish-personGroup-tag-rename") return finishTagRename("personGroup", el.dataset.id);
  if (action === "toggle-interest") return toggleInterest(el.dataset.id);
  if (action === "search-tag") return toggleSearchTag(el.dataset.id);
  if (action === "toggle-interest-manage") return toggleInterestManage();
  if (action === "confirm-add-interest") return addInterest();
  if (action === "cancel-interest-manage") return cancelInterestManage();
  if (action === "remove-interest") return removeInterest(el.dataset.id);
  if (action === "restore-default-interests") return restoreDefaultInterests();
  if (action === "toggle-interest-name-edit-mode") return toggleInterestNameEditMode();
  if (action === "start-interest-tag-rename") return startTagRename("interest", el.dataset.id);
  if (action === "finish-interest-tag-rename") return finishTagRename("interest", el.dataset.id);
  if (action === "toggle-custom-field-add") return toggleCustomFieldAdd();
  if (action === "toggle-custom-field-edit") return toggleCustomFieldEdit(el.dataset.id);
  if (action === "add-custom-field-draft-option") return addCustomFieldDraftOption();
  if (action === "remove-custom-field-draft-option") return removeCustomFieldDraftOption(Number(el.dataset.index));
  if (action === "confirm-add-custom-field") return addCustomField();
  if (action === "cancel-custom-field-add") return cancelCustomFieldAdd();
  if (action === "start-rename-custom-field") return startRenameCustomField(el.dataset.id);
  if (action === "confirm-rename-custom-field") return confirmRenameCustomField(el.dataset.id);
  if (action === "cancel-rename-custom-field") return cancelRenameCustomField();
  if (action === "delete-custom-field") return deleteCustomFieldById(el.dataset.id);
  if (action === "toggle-custom-choice") return toggleCustomChoice(el.dataset.fieldId, el.dataset.option);
  if (action === "add-custom-date-range-row") return addCustomDateRangeRow(el.dataset.fieldId);
  if (action === "remove-custom-date-range-row") return removeCustomDateRangeRow(el.dataset.fieldId, Number(el.dataset.index));
  if (action === "add-custom-option") return addCustomOption(el.dataset.fieldId);
  if (action === "rename-custom-option") return renameCustomOption(el.dataset.fieldId, el.dataset.option);
  if (action === "delete-custom-option") return deleteCustomOption(el.dataset.fieldId, el.dataset.option);
  if (action === "apply-search") return render();
  if (action === "clear-search") return clearSearch();
}

function toggleRouteFlag(key) {
  state.route[key] = !state.route[key];
  render();
}

function toggleMoreBasicFields() {
  state.route.moreBasicFieldsExpanded = !state.route.moreBasicFieldsExpanded;
  render();
}

function setGender(value) {
  if (!state.route.draft) return;
  state.route.draft.gender = state.route.draft.gender === value ? "" : value;
  render();
}

function checkDuplicateName() {
  const cleanName = state.route.draft?.name?.trim() ?? "";
  if (!cleanName) {
    alert("請先輸入姓名");
    return;
  }
  const duplicateCount = visiblePeople(state.vault.people).filter((person) => person.id !== state.route.draft.id && person.name.trim() === cleanName).length;
  alert(duplicateCount ? `發現${duplicateCount}位姓名重覆人物` : "未發現");
}

function clearSearch() {
  state.route.params = emptySearchParams();
  render({ transition: "replace" });
  writeHistoryRoute(state.route, { replace: true, force: true });
}

function openFamilyMember(sourcePersonId, familyMemberId, name) {
  const cleanName = String(name ?? "").trim();
  const candidates = familyMemberNameMatches(cleanName, sourcePersonId);
  if (!candidates.length) {
    navigate({ name: "new", prefillName: cleanName, returnTo: { name: "detail", id: sourcePersonId, scrollY: window.scrollY } });
    return;
  }
  if (candidates.length === 1) {
    void linkFamilyMemberAndOpen(sourcePersonId, familyMemberId, candidates[0].id);
    return;
  }
  navigate({
    name: "selectFamilyMember",
    sourcePersonId,
    familyMemberId,
    memberName: cleanName,
    returnTo: { name: "detail", id: sourcePersonId, scrollY: window.scrollY }
  });
}

async function linkFamilyMemberAndOpen(sourcePersonId, familyMemberId, targetPersonId, options = {}) {
  const target = getPerson(targetPersonId);
  if (!target) return;
  const now = new Date().toISOString();
  const vault = {
    ...state.vault,
    people: state.vault.people.map((person) => {
      if (person.id !== sourcePersonId) return person;
      return {
        ...person,
        familyMembers: (person.familyMembers ?? []).map((member) =>
          member.id === familyMemberId
            ? { ...member, name: target.name, personId: target.id, updatedAt: now }
            : member
        ),
        updatedAt: now,
        updatedByDeviceId: state.appState.deviceId
      };
    })
  };
  await commitVault(vault, { render: false });
  navigate({ name: "detail", id: target.id, returnTo: { name: "detail", id: sourcePersonId } }, { replace: Boolean(options.replace), force: true });
}

async function setTheme(themeId) {
  if (!THEME_OPTIONS.some((theme) => theme.id === themeId) || !state.appState) return;
  state.appState = {
    ...state.appState,
    ui: {
      ...(state.appState.ui ?? {}),
      themeId
    }
  };
  await setItem("appState", state.appState);
  render();
}

async function savePersonForm(event) {
  event.preventDefault();
  const draft = normalizeDraft(state.route.draft);
  if (!draft.name.trim()) {
    alert("姓名為必填欄位");
    return;
  }
  let vault = structuredClone(state.vault);
  const now = new Date().toISOString();
  const person = {
    ...draft,
    name: draft.name.trim(),
    nickname: draft.nickname.trim(),
    gender: draft.gender.trim(),
    nationalId: draft.nationalId.trim(),
    workInfo: draft.workInfo.trim(),
    note: draft.note.trim(),
    phones: cleanList(draft.phones),
    addresses: cleanAddressList(draft.addresses),
    personGroupTagIds: draft.personGroupTagIds ?? [],
    interestTagIds: draft.interestTagIds ?? [],
    favoriteItems: cleanFavoriteItems(draft.favoriteItems),
    familyMembers: cleanFamilyMembers(draft.familyMembers, draft.id),
    lifeEvents: cleanLifeEvents(draft.lifeEvents),
    customValues: cleanCustomValues(draft.customValues),
    updatedAt: now,
    updatedByDeviceId: state.appState.deviceId
  };
  const index = vault.people.findIndex((item) => item.id === person.id);
  const isEditing = index >= 0;
  if (isEditing) vault.people[index] = person;
  else vault.people.push(person);
  vault = linkPendingFamilyMembersToUniquePerson(vault, person);
  await commitVault(vault, { render: false });
  if (isEditing) {
    state.route.draftBaseline = personDraftSignature(person);
    navigateBack({ name: "detail", id: person.id, returnTo: state.route.returnTo }, { force: true });
    return;
  }
  state.route = { name: "detail", id: person.id, returnTo: state.route.returnTo };
  render({ transition: "replace" });
  writeHistoryRoute(state.route, { replace: true, force: true });
}

function addListItem(key) {
  const isAddress = key === "addresses";
  state.route.draft[key].push({
    id: `${key}-${crypto.randomUUID()}`,
    label: key === "phones" ? "手機" : "住家",
    ...(isAddress ? { city: "", district: "", detail: "" } : {}),
    value: "",
    isDefault: state.route.draft[key].length === 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  render();
}

function removeListItem(key, index) {
  const label = key === "phones" ? "電話" : "地址";
  if (!confirm(`確定要刪除這筆${label}嗎？`)) return;
  state.route.draft[key].splice(index, 1);
  ensureSingleDefault(state.route.draft[key]);
  render();
}

function setDefault(key, index) {
  state.route.draft[key] = state.route.draft[key].map((item, i) => ({ ...item, isDefault: i === index }));
  render();
}

function addFavoriteItem() {
  state.route.draft.favoriteItems.push(newTimestampedRow("favorite"));
  render();
}

function removeFavoriteItem(index) {
  state.route.draft.favoriteItems.splice(index, 1);
  render();
}

function addFamilyMember() {
  state.route.draft.familyMembers.push({
    ...newTimestampedRow("family"),
    relationship: "父",
    customRelationship: "",
    name: "",
    personId: ""
  });
  render();
}

function removeFamilyMember(index) {
  state.route.draft.familyMembers.splice(index, 1);
  render();
}

function addLifeEvent() {
  state.route.draft.lifeEvents.push({
    ...newTimestampedRow("event"),
    date: "",
    text: ""
  });
  render();
}

function removeLifeEvent(index) {
  state.route.draft.lifeEvents.splice(index, 1);
  render();
}

function newTimestampedRow(prefix) {
  const now = new Date().toISOString();
  return {
    id: `${prefix}-${crypto.randomUUID()}`,
    value: "",
    createdAt: now,
    updatedAt: now
  };
}

function updateFamilyMemberDraft(el) {
  const row = state.route.draft.familyMembers[Number(el.dataset.familyMember)];
  if (!row) return;
  const prop = el.dataset.prop;
  if (prop === "relationshipPreset") {
    row.relationship = el.value === "其它" ? "" : el.value;
    row.customRelationship = "";
    render();
    return;
  }
  row[prop] = el.value;
  if (prop === "customRelationship") row.relationship = el.value;
  if (prop === "name") {
    const matched = findUniqueVisiblePersonByName(el.value, state.route.draft.id);
    row.personId = matched?.id ?? "";
  }
}

function updateAddressDraft(el) {
  const row = state.route.draft.addresses[Number(el.dataset.address)];
  if (!row) return;
  const prop = el.dataset.prop;
  row[prop] = el.value;
  if (prop === "city") {
    const districts = ADDRESS_CITY_DISTRICTS[row.city] ?? [];
    if (!districts.includes(row.district)) row.district = "";
    render();
    return;
  }
  row.value = buildAddressValue(row);
}

function autoResizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function toggleInterest(id) {
  const selected = state.route.draft.interestTagIds;
  state.route.draft.interestTagIds = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
  render();
}

function togglePersonGroup(id) {
  const selected = state.route.draft.personGroupTagIds;
  state.route.draft.personGroupTagIds = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
  render();
}

function toggleSearchGroup(id) {
  const params = normalizeSearchParams(state.route.params);
  params.groupIds = params.groupIds.includes(id) ? params.groupIds.filter((item) => item !== id) : [...params.groupIds, id];
  state.route.params = params;
  render();
}

function toggleSearchGender(gender) {
  const params = normalizeSearchParams(state.route.params);
  params.genderValues = params.genderValues.includes(gender) ? [] : [gender];
  state.route.params = params;
  render();
}

function toggleSearchTag(id) {
  const params = normalizeSearchParams(state.route.params);
  params.tagIds = params.tagIds.includes(id) ? params.tagIds.filter((item) => item !== id) : [...params.tagIds, id];
  state.route.params = params;
  render();
}

function togglePersonGroupManage() {
  const next = !state.route.personGroupManage;
  state.route.personGroupManage = next;
  if (next) {
    state.route.personGroupNameEditMode = false;
    state.route.editingTagName = null;
  }
  state.route.newPersonGroupName ??= "";
  render();
}

function togglePersonGroupNameEditMode() {
  const next = !state.route.personGroupNameEditMode;
  state.route.personGroupNameEditMode = next;
  if (next) {
    state.route.personGroupManage = false;
    state.route.newPersonGroupName = "";
  }
  state.route.editingTagName = null;
  render();
}

function toggleInterestManage() {
  const next = !state.route.interestManage;
  state.route.interestManage = next;
  if (next) {
    state.route.interestNameEditMode = false;
    state.route.editingTagName = null;
  }
  state.route.newInterestName ??= "";
  render();
}

function toggleInterestNameEditMode() {
  const next = !state.route.interestNameEditMode;
  state.route.interestNameEditMode = next;
  if (next) {
    state.route.interestManage = false;
    state.route.newInterestName = "";
  }
  state.route.editingTagName = null;
  render();
}

function cancelInterestManage() {
  state.route.interestManage = false;
  state.route.newInterestName = "";
  render();
}

function startTagRename(kind, id) {
  const tag = findEditableTag(kind, id);
  if (!tag) return;
  state.route.editingTagName = { kind, id, value: tag.name };
  render();
}

async function finishTagRename(kind, id) {
  const tag = findEditableTag(kind, id);
  if (!tag) return;
  const cleanName = (state.route.editingTagName?.kind === kind && state.route.editingTagName?.id === id ? state.route.editingTagName.value : tag.name)?.trim() ?? "";
  const label = kind === "personGroup" ? "人物群組" : "興趣喜好";
  if (!cleanName) {
    alert(`${label}名稱不可空白`);
    return;
  }
  const tags = tagCollection(kind);
  if (tags.some((item) => item.id !== id && item.name === cleanName)) {
    alert(`同名${label}已存在`);
    return;
  }
  const now = new Date().toISOString();
  const key = kind === "personGroup" ? "personGroupTags" : "interestTags";
  state.route.editingTagName = null;
  await commitVault({
    ...state.vault,
    [key]: state.vault[key].map((item) =>
      item.id === id ? { ...item, name: cleanName, updatedAt: now, updatedByDeviceId: state.appState.deviceId } : item
    )
  });
}

function findEditableTag(kind, id) {
  const tag = tagCollection(kind).find((item) => item.id === id);
  if (!tag || tag.isDefault) return null;
  return tag;
}

function tagCollection(kind) {
  return kind === "personGroup" ? state.vault.personGroupTags : state.vault.interestTags;
}

async function addPersonGroup() {
  const cleanName = state.route.newPersonGroupName?.trim() ?? "";
  if (!cleanName) {
    alert("人物群組名稱不可空白");
    return;
  }
  if (state.vault.personGroupTags.some((tag) => tag.name === cleanName)) {
    alert("同名人物群組已存在");
    return;
  }
  const now = new Date().toISOString();
  const tag = {
    id: `person-group-${crypto.randomUUID()}`,
    name: cleanName,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    updatedByDeviceId: state.appState.deviceId
  };
  const vault = { ...state.vault, personGroupTags: [...state.vault.personGroupTags, tag] };
  state.route.draft.personGroupTagIds.push(tag.id);
  state.route.newPersonGroupName = "";
  await commitVault(vault);
}

async function removePersonGroup(id) {
  const tag = state.vault.personGroupTags.find((item) => item.id === id);
  if (tag) await deletePersonGroup(tag);
}

async function deletePersonGroup(tag) {
  const usedCount = state.vault.people.filter((person) => (person.personGroupTagIds ?? []).includes(tag.id)).length;
  const usageWarning = usedCount ? `\n此人物群組目前有 ${usedCount} 位人物使用\n移除後會從這些人物身上移除此人物群組。` : "";
  const defaultHint = tag.isDefault ? "\n之後可使用「恢復預設人物群組」重新加入。" : "";
  const verb = tag.isDefault ? "移除" : "刪除";
  if (!confirm(`確定要${verb}「${tagLabelPlain(tag)}」嗎？${usageWarning}${defaultHint}`)) return;
  const now = new Date().toISOString();
  const vault = {
    ...state.vault,
    personGroupTags: state.vault.personGroupTags.filter((item) => item.id !== tag.id),
    people: state.vault.people.map((person) => {
      const selected = person.personGroupTagIds ?? [];
      return {
        ...person,
        personGroupTagIds: selected.filter((item) => item !== tag.id),
        updatedAt: selected.includes(tag.id) ? now : person.updatedAt
      };
    }),
    tombstones: [
      ...state.vault.tombstones,
      {
        id: tag.id,
        type: "personGroupTag",
        deletedAt: now,
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        updatedAt: now,
        updatedByDeviceId: state.appState.deviceId
      }
    ]
  };
  if (state.route.draft) state.route.draft.personGroupTagIds = state.route.draft.personGroupTagIds.filter((item) => item !== tag.id);
  await commitVault(vault);
}

async function restoreDefaultPersonGroups() {
  const now = new Date().toISOString();
  const normalized = normalizeTagCollection(state.vault.personGroupTags, DEFAULT_PERSON_GROUP_TAGS, [], "personGroupTag", now);
  const changed = JSON.stringify(state.vault.personGroupTags) !== JSON.stringify(normalized.tags);
  if (!changed) {
    alert("預設人物群組都已存在");
    return;
  }
  const people = state.vault.people.map((person) => rewritePersonTagIds(person, normalized.redirects, new Map()));
  if (state.route.draft) state.route.draft = rewritePersonTagIds(state.route.draft, normalized.redirects, new Map());
  await commitVault({ ...state.vault, people, personGroupTags: normalized.tags });
}

async function addInterest() {
  const cleanName = state.route.newInterestName?.trim() ?? "";
  if (!cleanName) {
    alert("興趣喜好名稱不可空白");
    return;
  }
  if (state.vault.interestTags.some((tag) => tag.name === cleanName)) {
    alert("同名興趣喜好已存在");
    return;
  }
  const now = new Date().toISOString();
  const tag = {
    id: `interest-${crypto.randomUUID()}`,
    name: cleanName,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    updatedByDeviceId: state.appState.deviceId
  };
  const vault = { ...state.vault, interestTags: [...state.vault.interestTags, tag] };
  state.route.draft.interestTagIds.push(tag.id);
  state.route.newInterestName = "";
  await commitVault(vault);
}

async function removeInterest(id) {
  const tag = state.vault.interestTags.find((item) => item.id === id);
  if (tag) await deleteInterest(tag);
}

async function deleteInterest(tag) {
  const usedCount = state.vault.people.filter((person) => person.interestTagIds.includes(tag.id)).length;
  const usageWarning = usedCount ? `\n此興趣喜好目前有 ${usedCount} 位人物使用\n移除後會從這些人物身上移除此興趣喜好。` : "";
  const defaultHint = tag.isDefault ? "\n之後可使用「恢復預設興趣喜好」重新加入。" : "";
  const verb = tag.isDefault ? "移除" : "刪除";
  if (!confirm(`確定要${verb}「${tagLabelPlain(tag)}」嗎？${usageWarning}${defaultHint}`)) return;
  const now = new Date().toISOString();
  const vault = {
    ...state.vault,
    interestTags: state.vault.interestTags.filter((item) => item.id !== tag.id),
    people: state.vault.people.map((person) => ({
      ...person,
      interestTagIds: person.interestTagIds.filter((item) => item !== tag.id),
      updatedAt: person.interestTagIds.includes(tag.id) ? now : person.updatedAt
    })),
    tombstones: [
      ...state.vault.tombstones,
      {
        id: tag.id,
        type: "interestTag",
        deletedAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString()
      }
    ]
  };
  if (state.route.draft) state.route.draft.interestTagIds = state.route.draft.interestTagIds.filter((item) => item !== tag.id);
  await commitVault(vault);
}

async function restoreDefaultInterests() {
  if (!confirm("確定要恢復預設興趣喜好嗎？\n這會重新加入缺少的預設項目，不會刪除你的自訂項目。")) return;
  const now = new Date().toISOString();
  const normalized = normalizeTagCollection(state.vault.interestTags, DEFAULT_INTEREST_TAGS, [], "interestTag", now);
  const people = state.vault.people.map((person) => rewritePersonTagIds(person, new Map(), normalized.redirects));
  if (state.route.draft) state.route.draft = rewritePersonTagIds(state.route.draft, new Map(), normalized.redirects);
  await commitVault({ ...state.vault, people, interestTags: normalized.tags });
}

function toggleCustomFieldAdd() {
  state.route.customFieldAdd = !state.route.customFieldAdd;
  state.route.customFieldDraft ??= { name: "", type: "text", scope: "person", options: [], newOption: "" };
  render();
}

function toggleCustomFieldEdit(id) {
  const isEditing = state.route.activeCustomFieldEditId === id;
  state.route.activeCustomFieldEditId = isEditing ? "" : id;
  state.route.editingCustomFieldName = "";
  state.route.editingCustomFieldId = "";
  if (isEditing) state.route.editingCustomOptionNames = { ...(state.route.editingCustomOptionNames ?? {}), [id]: {} };
  render();
}

function cancelCustomFieldAdd() {
  state.route.customFieldAdd = false;
  state.route.customFieldDraft = { name: "", type: "text", scope: "person", options: [], newOption: "" };
  render();
}

async function addCustomField() {
  const draft = state.route.customFieldDraft ?? { name: "", type: "text", scope: "person", options: [], newOption: "" };
  const cleanName = draft.name.trim();
  if (!cleanName) {
    alert("欄位名稱不可空白");
    return;
  }
  const type = draft.type;
  const options = cleanCustomOptions(draft.options ?? []);
  if (type === "single" && options.length < 2) {
    alert("單選欄位至少需要 2 個選項");
    return;
  }
  if (type === "multi" && options.length < 1) {
    alert("多選欄位至少需要 1 個選項");
    return;
  }
  const scope = draft.scope;
  const personId = scope === "person" ? state.route.draft.id : undefined;
  if (state.vault.customFieldDefs.some((field) => field.name === cleanName && field.scope === scope && field.personId === personId)) {
    alert("同名自訂欄位已存在");
    return;
  }
  const now = new Date().toISOString();
  const field = {
    id: `custom-${crypto.randomUUID()}`,
    name: cleanName,
    type,
    options: isChoiceField({ type }) ? options : [],
    scope,
    personId,
    createdAt: now,
    updatedAt: now,
    updatedByDeviceId: state.appState.deviceId
  };
  state.route.customFieldDraft = { name: "", type: "text", scope: "person", options: [], newOption: "" };
  state.route.customFieldAdd = false;
  await commitVault({ ...state.vault, customFieldDefs: [...state.vault.customFieldDefs, field] });
}

function addCustomFieldDraftOption() {
  state.route.customFieldDraft ??= { name: "", type: "text", scope: "person", options: [], newOption: "" };
  const cleanName = state.route.customFieldDraft.newOption?.trim() ?? "";
  if (!cleanName) {
    alert("選項名稱不可空白");
    return;
  }
  const options = cleanCustomOptions([...(state.route.customFieldDraft.options ?? []), cleanName]);
  state.route.customFieldDraft = { ...state.route.customFieldDraft, options, newOption: "" };
  render();
}

function removeCustomFieldDraftOption(index) {
  state.route.customFieldDraft ??= { name: "", type: "text", scope: "person", options: [], newOption: "" };
  state.route.customFieldDraft.options = (state.route.customFieldDraft.options ?? []).filter((_, i) => i !== index);
  render();
}

function startRenameCustomField(id) {
  const field = state.vault.customFieldDefs.find((item) => item.id === id);
  if (!field) return;
  state.route.editingCustomFieldId = id;
  state.route.editingCustomFieldName = field.name;
  render();
}

async function confirmRenameCustomField(id) {
  const field = state.vault.customFieldDefs.find((item) => item.id === id);
  if (!field) return;
  const cleanName = state.route.editingCustomFieldName?.trim() ?? "";
  if (!cleanName) {
    alert("欄位名稱不可空白");
    return;
  }
  const vault = {
    ...state.vault,
    customFieldDefs: state.vault.customFieldDefs.map((item) =>
      item.id === id
        ? { ...item, name: cleanName, updatedAt: new Date().toISOString(), updatedByDeviceId: state.appState.deviceId }
        : item
    )
  };
  state.route.editingCustomFieldId = "";
  state.route.editingCustomFieldName = "";
  await commitVault(vault);
}

function cancelRenameCustomField() {
  state.route.editingCustomFieldId = "";
  state.route.editingCustomFieldName = "";
  render();
}

async function deleteCustomFieldById(id) {
  const field = state.vault.customFieldDefs.find((item) => item.id === id);
  if (field) await deleteCustomField(field);
}

async function deleteCustomField(field) {
  const usedCount = state.vault.people.filter((person) => person.customValues.some((value) => value.fieldId === field.id)).length;
  const globalWarning = field.scope === "global" ? `\n此欄位目前有 ${usedCount} 位人物填寫\n刪除後會移除所有人物此欄位資料。` : "";
  if (!confirm(`確定要刪除「${field.name}」嗎？${globalWarning}`)) return;
  const now = new Date().toISOString();
  const vault = {
    ...state.vault,
    customFieldDefs: state.vault.customFieldDefs.filter((item) => item.id !== field.id),
    people: state.vault.people.map((person) => ({
      ...person,
      customValues: person.customValues.filter((value) => value.fieldId !== field.id),
      updatedAt: person.customValues.some((value) => value.fieldId === field.id) ? now : person.updatedAt
    })),
    tombstones: [
      ...state.vault.tombstones,
      {
        id: field.id,
        type: "customField",
        deletedAt: now,
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString()
      }
    ]
  };
  if (state.route.draft) state.route.draft.customValues = state.route.draft.customValues.filter((value) => value.fieldId !== field.id);
  await commitVault(vault);
}

function toggleCustomChoice(fieldId, option) {
  const field = state.vault.customFieldDefs.find((item) => item.id === fieldId);
  if (!field || !state.route.draft) return;
  const current = getCustomValue(state.route.draft, fieldId);
  if (field.type === "single") {
    const next = current === option ? "" : option;
    setCustomValue(state.route.draft, fieldId, next);
  } else if (field.type === "multi") {
    const values = Array.isArray(current) ? current : [];
    const next = values.includes(option) ? values.filter((item) => item !== option) : [...values, option];
    setCustomValue(state.route.draft, fieldId, next);
  }
  render();
}

function addCustomDateRangeRow(fieldId) {
  if (!state.route.draft) return;
  const rows = dateRangeRows(getCustomValue(state.route.draft, fieldId), false);
  setCustomValue(state.route.draft, fieldId, [
    ...rows,
    {
      id: `date-range-${crypto.randomUUID()}`,
      startDate: "",
      endDate: "",
      text: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]);
  render();
}

function removeCustomDateRangeRow(fieldId, index) {
  if (!state.route.draft) return;
  const rows = dateRangeRows(getCustomValue(state.route.draft, fieldId), true);
  const next = rows.filter((_, i) => i !== index);
  setCustomValue(state.route.draft, fieldId, cleanDateRangeValues(next));
  render();
}

async function addCustomOption(fieldId) {
  const cleanName = state.route.newCustomOptionNames?.[fieldId]?.trim() ?? "";
  const field = state.vault.customFieldDefs.find((item) => item.id === fieldId);
  if (!field || !isChoiceField(field)) return;
  if (!cleanName) {
    alert("選項名稱不可空白");
    return;
  }
  const options = cleanCustomOptions([...(field.options ?? []), cleanName]);
  if (options.length === (field.options ?? []).length) {
    alert("同名選項已存在");
    return;
  }
  state.route.newCustomOptionNames = { ...(state.route.newCustomOptionNames ?? {}), [fieldId]: "" };
  await updateCustomFieldOptions(fieldId, options);
}

async function renameCustomOption(fieldId, oldName) {
  const field = state.vault.customFieldDefs.find((item) => item.id === fieldId);
  if (!field || !isChoiceField(field)) return;
  const cleanName = state.route.editingCustomOptionNames?.[fieldId]?.[oldName]?.trim() ?? oldName;
  if (!cleanName) {
    alert("選項名稱不可空白");
    return;
  }
  if (cleanName !== oldName && (field.options ?? []).includes(cleanName)) {
    alert("同名選項已存在");
    return;
  }
  const options = (field.options ?? []).map((option) => (option === oldName ? cleanName : option));
  const people = state.vault.people.map((person) => ({
    ...person,
    customValues: renameCustomOptionInValues(person.customValues, fieldId, oldName, cleanName)
  }));
  state.route.editingCustomOptionNames = { ...(state.route.editingCustomOptionNames ?? {}), [fieldId]: {} };
  await commitVault({
    ...state.vault,
    customFieldDefs: state.vault.customFieldDefs.map((item) => (item.id === fieldId ? { ...item, options, updatedAt: new Date().toISOString(), updatedByDeviceId: state.appState.deviceId } : item)),
    people
  });
}

async function deleteCustomOption(fieldId, optionName) {
  const field = state.vault.customFieldDefs.find((item) => item.id === fieldId);
  if (!field || !isChoiceField(field)) return;
  if (!confirm(`確定要刪除選項「${optionName}」嗎？\n已使用此選項的人物資料會同步移除此值。`)) return;
  const options = (field.options ?? []).filter((option) => option !== optionName);
  if (field.type === "single" && options.length < 2) {
    alert("單選欄位至少需要保留 2 個選項");
    return;
  }
  if (field.type === "multi" && options.length < 1) {
    alert("多選欄位至少需要保留 1 個選項");
    return;
  }
  const people = state.vault.people.map((person) => ({
    ...person,
    customValues: removeCustomOptionFromValues(person.customValues, fieldId, optionName)
  }));
  if (state.route.draft) state.route.draft.customValues = removeCustomOptionFromValues(state.route.draft.customValues, fieldId, optionName);
  await commitVault({
    ...state.vault,
    customFieldDefs: state.vault.customFieldDefs.map((item) => (item.id === fieldId ? { ...item, options, updatedAt: new Date().toISOString(), updatedByDeviceId: state.appState.deviceId } : item)),
    people
  });
}

async function updateCustomFieldOptions(fieldId, options) {
  await commitVault({
    ...state.vault,
    customFieldDefs: state.vault.customFieldDefs.map((item) => (item.id === fieldId ? { ...item, options, updatedAt: new Date().toISOString(), updatedByDeviceId: state.appState.deviceId } : item))
  });
}

async function deletePerson(id) {
  const person = getPerson(id);
  if (!person) return;
  if (!confirm(`確定要刪除「${person.name}」嗎？\n刪除後 5 天內可從最近刪除還原。`)) return;
  const now = new Date();
  const restoreUntil = new Date(now.getTime() + 5 * 86400000).toISOString();
  const expiresAt = new Date(now.getTime() + 30 * 86400000).toISOString();
  const vault = {
    ...state.vault,
    people: state.vault.people.filter((item) => item.id !== id),
    deletedItems: [
      ...state.vault.deletedItems,
      { id, type: "person", deletedAt: now.toISOString(), deletedByDeviceId: state.appState.deviceId, restoreUntil, snapshot: person }
    ],
    tombstones: [...state.vault.tombstones, { id, type: "person", deletedAt: now.toISOString(), expiresAt }]
  };
  state.route = { name: "home" };
  await commitVault(vault);
}

async function archivePerson(id) {
  const person = getPerson(id);
  if (!person || person.archivedAt) return;
  if (!confirm(`確定要封存「${person.name}」嗎？\n封存後不會顯示於首頁與搜尋結果。`)) return;
  const now = new Date().toISOString();
  const vault = {
    ...state.vault,
    people: state.vault.people.map((item) =>
      item.id === id
        ? { ...item, archivedAt: now, updatedAt: now, updatedByDeviceId: state.appState.deviceId }
        : item
    )
  };
  state.route = { name: "home" };
  await commitVault(vault);
}

async function restoreArchivedPerson(id) {
  const person = getPerson(id);
  if (!person || !person.archivedAt) return;
  if (!confirm(`確定要還原「${person.name}」嗎？`)) return;
  const now = new Date().toISOString();
  const vault = {
    ...state.vault,
    people: state.vault.people.map((item) =>
      item.id === id
        ? { ...item, archivedAt: "", updatedAt: now, updatedByDeviceId: state.appState.deviceId }
        : item
    )
  };
  await commitVault(vault);
}

async function deleteArchivedPerson(id) {
  const person = getPerson(id);
  if (!person || !person.archivedAt) return;
  if (!confirm("確定要永久刪除這位封存人物嗎？刪除後會移到最近刪除，可在保留期限內恢復。")) return;
  await deletePersonToRecentlyDeleted(person, { returnRoute: { name: "archived" }, confirmFirst: false });
}

async function deletePersonToRecentlyDeleted(person, { returnRoute = { name: "home" }, confirmFirst = true } = {}) {
  if (confirmFirst && !confirm(`確定要刪除「${person.name}」嗎？\n刪除後 5 天內可從最近刪除還原。`)) return;
  const now = new Date();
  const restoreUntil = new Date(now.getTime() + 5 * 86400000).toISOString();
  const expiresAt = new Date(now.getTime() + 30 * 86400000).toISOString();
  const vault = {
    ...state.vault,
    people: state.vault.people.filter((item) => item.id !== person.id),
    deletedItems: [
      ...state.vault.deletedItems,
      { id: person.id, type: "person", deletedAt: now.toISOString(), deletedByDeviceId: state.appState.deviceId, restoreUntil, snapshot: person }
    ],
    tombstones: [...state.vault.tombstones, { id: person.id, type: "person", deletedAt: now.toISOString(), expiresAt }]
  };
  state.route = returnRoute;
  await commitVault(vault);
}

async function restorePerson(id) {
  const item = state.vault.deletedItems.find((entry) => entry.id === id);
  if (!item || !confirm(`確定要還原「${item.snapshot.name}」嗎？`)) return;
  const vault = {
    ...state.vault,
    people: [...state.vault.people, { ...item.snapshot, updatedAt: new Date().toISOString(), updatedByDeviceId: state.appState.deviceId }],
    deletedItems: state.vault.deletedItems.filter((entry) => entry.id !== id),
    tombstones: state.vault.tombstones.filter((entry) => entry.id !== id)
  };
  await commitVault(vault);
}

async function purgePerson(id) {
  const item = state.vault.deletedItems.find((entry) => entry.id === id);
  if (!item || !confirm(`確定要永久刪除「${item.snapshot.name}」嗎？\n此操作無法復原。`)) return;
  const vault = { ...state.vault, deletedItems: state.vault.deletedItems.filter((entry) => entry.id !== id) };
  await commitVault(vault);
}

async function resolveSyncConflict(index, source) {
  const conflicts = [...(state.appState.googleDrive.pendingConflicts ?? [])];
  const conflict = conflicts[index];
  if (!conflict) return;

  await createLocalSnapshot("處理衝突前自動快照");
  const value = source === "remote" ? conflict.remoteValue : conflict.localValue;
  const vault = {
    ...state.vault,
    people: state.vault.people.map((person) =>
      person.id === conflict.personId
        ? {
            ...person,
            [conflict.field]: value,
            updatedAt: new Date().toISOString(),
            updatedByDeviceId: state.appState.deviceId
          }
        : person
    )
  };
  conflicts.splice(index, 1);
  state.vault = touchVault(vault, state.appState.deviceId);
  state.appState = {
    ...state.appState,
    googleDrive: {
      ...state.appState.googleDrive,
      syncStatus: conflicts.length ? "needsResolution" : syncStatusAfterLocalChange(state.appState.googleDrive),
      pendingConflicts: conflicts,
      lastLocalChangeAt: new Date().toISOString()
    }
  };
  await save();
  render();
}

function buildDataHealthReport() {
  const issues = [];
  const groupIds = new Set((state.vault.personGroupTags ?? []).map((tag) => tag.id));
  const tagIds = new Set(state.vault.interestTags.map((tag) => tag.id));
  const fieldIds = new Set(state.vault.customFieldDefs.map((field) => field.id));
  const people = visiblePeople(state.vault.people);
  const personNames = countBy(people, (person) => person.name.trim());
  const groupNames = countBy(state.vault.personGroupTags ?? [], (tag) => tag.name.trim());
  const tagNames = countBy(state.vault.interestTags, (tag) => tag.name.trim());
  const globalFieldNames = countBy(
    state.vault.customFieldDefs.filter((field) => field.scope === "global"),
    (field) => field.name.trim()
  );

  Object.entries(personNames)
    .filter(([, count]) => count > 1)
    .forEach(([name, count]) => {
      issues.push({
        title: "姓名重複",
        detail: `「${name}」出現 ${count} 次，請確認是否為不同人物或重複建立。`,
        personIds: people.filter((person) => person.name.trim() === name).map((person) => person.id)
      });
    });

  Object.entries(groupNames)
    .filter(([, count]) => count > 1)
    .forEach(([name, count]) => {
      issues.push({ title: "人物群組名稱重複", detail: `「${name}」出現 ${count} 次，可能需要合併。` });
    });

  Object.entries(tagNames)
    .filter(([, count]) => count > 1)
    .forEach(([name, count]) => {
      issues.push({ title: "興趣喜好名稱重複", detail: `「${name}」出現 ${count} 次，可能需要合併。` });
    });

  Object.entries(globalFieldNames)
    .filter(([, count]) => count > 1)
    .forEach(([name, count]) => {
      issues.push({ title: "全域自訂欄位名稱重複", detail: `「${name}」出現 ${count} 次，可能會讓使用者混淆。` });
    });

  people.forEach((person) => {
    (person.personGroupTagIds ?? [])
      .filter((id) => !groupIds.has(id))
      .forEach((id) => {
        issues.push({ title: "人物使用不存在的人物群組", detail: `${person.name} 指向不存在的人物群組 ID：${id}`, personIds: [person.id] });
      });

    (person.interestTagIds ?? [])
      .filter((id) => !tagIds.has(id))
      .forEach((id) => {
        issues.push({ title: "人物使用不存在的興趣喜好", detail: `${person.name} 指向不存在的興趣喜好 ID：${id}`, personIds: [person.id] });
      });

    (person.customValues ?? [])
      .filter((value) => !fieldIds.has(value.fieldId))
      .forEach((value) => {
        issues.push({ title: "人物使用不存在的自訂欄位", detail: `${person.name} 有不存在的自訂欄位 ID：${value.fieldId}`, personIds: [person.id] });
      });
  });

  return { issues };
}

function countBy(items, keyFn) {
  return items.reduce((result, item) => {
    const key = keyFn(item);
    if (!key) return result;
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
}

function searchPeople(params) {
  const normalizedParams = normalizeSearchParams(params);
  const text = normalizedParams.text.trim().toLowerCase();
  const textTokens = text.split(/\s+/).filter(Boolean);
  const address = normalizedParams.address.trim().toLowerCase();
  const groupIds = normalizedParams.groupIds;
  const tagIds = normalizedParams.tagIds;
  const genderValues = normalizedParams.genderValues;
  const birthdayMonths = Number(normalizedParams.birthdayWithinMonths || 0);
  const birthYear = normalizedParams.birthYear;
  const birthMonth = normalizedParams.birthMonth;
  const matched = visiblePeople(state.vault.people).filter((person) => {
    const searchableText = searchablePersonText(person);
    const textMatch =
      !textTokens.length ||
      textTokens.every((token) => searchableText.includes(token));
    const addressMatch = !address || person.addresses.some((item) => item.value.toLowerCase().includes(address));
    const groupMatch = groupIds.every((id) => (person.personGroupTagIds ?? []).includes(id));
    const tagMatch = tagIds.every((id) => (person.interestTagIds ?? []).includes(id));
    const genderMatch = genderValues.every((gender) => person.gender === gender);
    const birthdayMatch = !birthdayMonths || isBirthdayWithinMonths(person.birthDate, birthdayMonths);
    const birthYearMatch = !birthYear || birthDatePart(person.birthDate, "year") === birthYear;
    const birthMonthMatch = !birthMonth || birthDatePart(person.birthDate, "month") === birthMonth;
    return textMatch && addressMatch && groupMatch && tagMatch && genderMatch && birthdayMatch && birthYearMatch && birthMonthMatch;
  });
  return matched.sort((a, b) => {
    const aName = textTokens.some((token) => a.name.toLowerCase().includes(token));
    const bName = textTokens.some((token) => b.name.toLowerCase().includes(token));
    if (aName !== bName) return aName ? -1 : 1;
    return sortPeople([a, b])[0].id === a.id ? -1 : 1;
  });
}

function searchablePersonText(person) {
  const groupNames = (person.personGroupTagIds ?? []).map((id) => state.vault.personGroupTags.find((tag) => tag.id === id)?.name ?? "");
  const interestNames = (person.interestTagIds ?? []).map((id) => state.vault.interestTags.find((tag) => tag.id === id)?.name ?? "");
  const customFields = customDefsForPerson(person.id);
  const customFieldText = (person.customValues ?? []).flatMap((value) => {
    const field = customFields.find((item) => item.id === value.fieldId);
    return [field?.name ?? "", formatSearchValue(value.value)];
  });
  return [
    person.name,
    person.nickname,
    person.gender,
    person.birthDate,
    person.nationalId,
    person.workInfo,
    person.note,
    ...(person.phones ?? []).flatMap((phone) => [phone.label, phone.value]),
    ...(person.addresses ?? []).flatMap((address) => [address.label, address.city, address.district, address.detail, address.value]),
    ...groupNames,
    ...interestNames,
    ...(person.favoriteItems ?? []).map((item) => item.value),
    ...(person.familyMembers ?? []).flatMap((member) => [member.relationship, member.name]),
    ...(person.lifeEvents ?? []).flatMap((event) => [event.date, event.text]),
    ...customFieldText
  ]
    .join(" ")
    .toLowerCase();
}

function hasSearchCriteria(params) {
  const normalizedParams = normalizeSearchParams(params);
  return Boolean(
      normalizedParams.text.trim() ||
      normalizedParams.address.trim() ||
      normalizedParams.groupIds.length ||
      normalizedParams.tagIds.length ||
      normalizedParams.genderValues.length ||
      normalizedParams.birthdayWithinMonths ||
      normalizedParams.birthYear ||
      normalizedParams.birthMonth
  );
}

function emptySearchParams() {
  return { text: "", address: "", groupIds: [], tagIds: [], genderValues: [], birthdayWithinMonths: "", birthYear: "", birthMonth: "" };
}

function normalizeSearchParams(params = {}) {
  return {
    text: params.text ?? "",
    address: params.address ?? "",
    groupIds: params.groupIds ?? [],
    tagIds: params.tagIds ?? [],
    genderValues: params.genderValues ?? [],
    birthdayWithinMonths: params.birthdayWithinMonths ?? "",
    birthYear: params.birthYear ?? "",
    birthMonth: params.birthMonth ?? ""
  };
}

function birthdaySearchOptions() {
  const years = new Set();
  const months = new Set();
  visiblePeople(state.vault.people).forEach((person) => {
    const year = birthDatePart(person.birthDate, "year");
    const month = birthDatePart(person.birthDate, "month");
    if (year) years.add(year);
    if (month) months.add(month);
  });
  return {
    years: [...years].sort((a, b) => Number(b) - Number(a)),
    months: [...months].sort((a, b) => Number(a) - Number(b))
  };
}

function birthDatePart(birthDate, part) {
  const [year, month] = String(birthDate ?? "").split("-");
  if (part === "year") return year || "";
  if (part === "month") return month ? String(Number(month)) : "";
  return "";
}

function formatSearchValue(value) {
  if (Array.isArray(value)) return value.map(formatSearchValue).join(" ");
  if (value && typeof value === "object") return [value.startDate, value.endDate, value.text].map(formatSearchValue).join(" ");
  return String(value ?? "");
}

function updateNationalIdFeedback(input) {
  const message = input.closest(".input-status-row")?.querySelector("[data-national-id-message]");
  if (!message) return;
  message.textContent = nationalIdErrorText(input.value);
}

function nationalIdErrorText(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return "";
  return isValidTaiwanNationalId(normalized) ? "" : "身分證字號有誤";
}

function isValidTaiwanNationalId(value) {
  const id = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z][12]\d{8}$/.test(id)) return false;
  const letterCodes = {
    A: 10,
    B: 11,
    C: 12,
    D: 13,
    E: 14,
    F: 15,
    G: 16,
    H: 17,
    I: 34,
    J: 18,
    K: 19,
    L: 20,
    M: 21,
    N: 22,
    O: 35,
    P: 23,
    Q: 24,
    R: 25,
    S: 26,
    T: 27,
    U: 28,
    V: 29,
    W: 32,
    X: 30,
    Y: 31,
    Z: 33
  };
  const code = letterCodes[id[0]];
  const digits = id.slice(1).split("").map(Number);
  const sum =
    Math.floor(code / 10) +
    (code % 10) * 9 +
    digits[0] * 8 +
    digits[1] * 7 +
    digits[2] * 6 +
    digits[3] * 5 +
    digits[4] * 4 +
    digits[5] * 3 +
    digits[6] * 2 +
    digits[7] +
    digits[8];
  return sum % 10 === 0;
}

function isBirthdayWithinMonths(birthDate, months) {
  if (!birthDate) return false;
  const [, month, day] = birthDate.split("-").map(Number);
  if (!month || !day) return false;
  const today = startOfDay(new Date());
  const endDate = addCalendarMonths(today, months);
  let nextBirthday = new Date(today.getFullYear(), month - 1, day);
  if (nextBirthday < today) nextBirthday = new Date(today.getFullYear() + 1, month - 1, day);
  return nextBirthday >= today && nextBirthday <= endDate;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addCalendarMonths(date, months) {
  const result = new Date(date);
  const targetMonth = result.getMonth() + months;
  result.setMonth(targetMonth);
  if (result.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    result.setDate(0);
  }
  return startOfDay(result);
}

function customDefsForPerson(personId) {
  return state.vault.customFieldDefs.filter((field) => field.scope === "global" || field.personId === personId);
}

function formatCustomValue(field, value) {
  if (field.type === "dateRange") return cleanDateRangeValues(value).map((row) => [formatDateRangePeriod(row), row.text].filter(Boolean).join(" ")).join("、");
  if (Array.isArray(value)) return value.join("、");
  if (field.type === "date" && value) return String(value).replaceAll("-", "/");
  return String(value);
}

function syncStatusLabel(gd) {
  if (gd.syncStatus === "needsResolution") return "資料衝突需要處理";
  if (gd.syncStatus === "needsSync") return "有本機變更尚未同步";
  if (gd.syncStatus === "syncing") return "同步中…";
  if (gd.syncStatus === "error") return "同步失敗";
  return gd.simulated ? `已同步（${driveProviderLabel()}）` : "已同步";
}

function isDriveSyncRecentlyStarted(gd) {
  if (gd?.syncStatus !== "syncing") return false;
  const startedAt = Date.parse(gd.syncStartedAt || "");
  return Boolean(startedAt && Date.now() - startedAt < DRIVE_SYNC_STALE_MS);
}

function markLocalVaultChanged() {
  if (!state.appState?.googleDrive?.connected) return;
  const gd = state.appState.googleDrive;
  state.appState = {
    ...state.appState,
    googleDrive: {
      ...gd,
      syncStatus: syncStatusAfterLocalChange(gd),
      lastLocalChangeAt: new Date().toISOString()
    }
  };
}

function syncStatusAfterLocalChange(gd) {
  if (gd.syncStatus === "needsResolution") return "needsResolution";
  return "needsSync";
}

function buildSyncSummary({ localBeforeSync, remoteVault, mergedVault, conflicts, syncedAt }) {
  return {
    syncedAt,
    hadCloudData: Boolean(remoteVault),
    localRevision: localBeforeSync?.syncMeta?.revision ?? 0,
    cloudRevision: remoteVault?.syncMeta?.revision ?? 0,
    mergedRevision: mergedVault?.syncMeta?.revision ?? 0,
    localPeopleCount: localBeforeSync?.people?.length ?? 0,
    cloudPeopleCount: remoteVault?.people?.length ?? 0,
    mergedPeopleCount: mergedVault?.people?.length ?? 0,
    conflictCount: conflicts.length
  };
}

function syncAlertMessage(summary, conflictCount) {
  if (conflictCount) return `已同步，但有 ${conflictCount} 筆資料衝突需要處理`;
  return `已同步（${driveProviderLabel()}）\n目前共 ${summary.mergedPeopleCount} 位人物`;
}

function vaultDataSummary() {
  return {
    peopleCount: state.vault?.people?.length ?? 0,
    personGroupTagCount: state.vault?.personGroupTags?.length ?? 0,
    interestTagCount: state.vault?.interestTags?.length ?? 0,
    customFieldCount: state.vault?.customFieldDefs?.length ?? 0
  };
}

function driveErrorMessage(error, fallback) {
  const message = error?.message ?? "";
  if (message.includes("google-identity-services-load-failed")) return "無法載入 Google 登入服務，請確認網路連線後再試。";
  if (message.includes("google-identity-services-load-timeout")) return "Google 登入服務載入逾時，請確認網路連線後再試。";
  if (message.includes("google-drive-auth-timeout")) return "Google Drive 授權等待逾時，請再按一次「立即同步」。";
  if (message.includes("google-drive-request-timeout")) return "Google Drive 連線逾時，請確認網路後再按「立即同步」。";
  if (message.includes("google-drive-handoff-failed:origin-not-allowed")) return "OAuth Worker 拒絕目前網站來源，請檢查 Cloudflare 的 APP_ORIGINS 設定。";
  if (message.includes("google-drive-handoff-failed:handoff-invalid-or-expired")) return "Google OAuth 回跳已逾時，請重新按「立即同步」。";
  if (message.includes("google-drive-handoff-failed:handoff-exchange-failed")) return "OAuth Worker 無法建立同步 session，請查看 Cloudflare Worker Logs。";
  if (message.includes("google-drive-handoff-failed:drive-request-failed")) return "OAuth Worker 無法讀取 Google 帳號資料，請查看 Cloudflare Worker Logs。";
  if (message.includes("access_denied")) return "Google Drive 授權已取消，尚未完成連結。";
  if (message.includes("popup")) return "Google 授權視窗被阻擋，請允許彈出視窗後再試。";
  if (message.includes("google-drive-auth-required") || message.includes("interaction_required") || message.includes("login_required") || message.includes("consent_required")) {
    return "Google Drive 需要重新授權，請在設定頁重新同步或重新連結 Google Drive。";
  }
  if (message.includes("google-drive-request-failed:401")) return "Google Drive 授權已失效，請重新連結 Google Drive。";
  if (message.includes("google-drive-request-failed:403")) return "Google Drive 權限不足，請確認授權範圍後再試。";
  if (message.includes("google-drive-request-failed")) return "Google Drive 連線失敗，請稍後再試。";
  return fallback;
}

function isDriveAuthRequiredError(error) {
  const message = error?.message ?? "";
  return (
    message.includes("google-drive-auth-required") ||
    message.includes("interaction_required") ||
    message.includes("login_required") ||
    message.includes("consent_required") ||
    message.includes("google-drive-request-failed:401")
  );
}

function markDriveSyncIssue(error) {
  if (!state.appState?.googleDrive?.connected) return;
  state.appState = {
    ...state.appState,
    googleDrive: {
      ...state.appState.googleDrive,
      syncStatus: "error",
      lastSyncError: driveErrorMessage(error, "Google Drive 尚未完成同步，資料仍已保存在本機。")
    }
  };
  void setItem("appState", state.appState);
}

function rememberDriveAccount(connection = {}) {
  const accountEmail = connection.accountEmail || driveAuthStatus().accountEmail || "";
  if (!accountEmail || !state.appState?.googleDrive) return;
  state.appState = {
    ...state.appState,
    googleDrive: {
      ...state.appState.googleDrive,
      accountEmail
    }
  };
}

function currentDriveAccountEmail() {
  return state.appState?.googleDrive?.accountEmail || driveAuthStatus().accountEmail || "";
}

function isSimulatedDrive() {
  return driveProviderLabel() === "本機模擬";
}

function securityEventMessage(securityMeta = {}) {
  const passwordChangedAt = securityMeta.passwordChangedAt ?? "";
  const globalLogoutAt = securityMeta.globalLogoutAt ?? "";
  if (passwordChangedAt && new Date(passwordChangedAt).getTime() >= new Date(globalLogoutAt || 0).getTime()) {
    return `密碼已於${formatPlainDateTime(passwordChangedAt)}更改，請輸入變更後的新密碼`;
  }
  return "已從所有裝置登出，請重新輸入密碼";
}

function formatPlainDateTime(value) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })
    .formatToParts(date)
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatDateOnly(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "numeric",
    day: "numeric"
  })
    .formatToParts(date)
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}/${parts.month}/${parts.day}`;
}

function fileDateTime(value) {
  return formatPlainDateTime(value).replaceAll("-", "").replace(" ", "-").replace(":", "");
}

function fieldLabel(field) {
  const labels = {
    birthDate: "生日"
  };
  return labels[field] ?? field;
}

function pruneDeleted(vault) {
  const now = Date.now();
  return {
    ...vault,
    deletedItems: (vault.deletedItems ?? []).filter((item) => new Date(item.restoreUntil).getTime() > now),
    tombstones: (vault.tombstones ?? []).filter((item) => {
      if (!item?.expiresAt) return true;
      return new Date(item.expiresAt).getTime() > now;
    })
  };
}

function normalizeVault(vault = {}) {
  const now = new Date().toISOString();
  const tombstones = asArray(vault.tombstones);
  const normalizedInterestTags = asArray(vault.interestTags).map((tag) => {
    if (!tag.emoji) return tag;
    const name = tag.name.startsWith(tag.emoji) ? tag.name : `${tag.emoji} ${tag.name}`;
    const { emoji, ...rest } = tag;
    return { ...rest, name };
  });
  const normalizedPersonGroups = normalizeTagCollection(vault.personGroupTags, DEFAULT_PERSON_GROUP_TAGS, tombstones, "personGroupTag", now);
  const normalizedInterests = normalizeTagCollection(normalizedInterestTags, DEFAULT_INTEREST_TAGS, tombstones, "interestTag", now);
  const validPersonGroupIds = new Set(normalizedPersonGroups.tags.map((tag) => tag.id));
  const validInterestIds = new Set(normalizedInterests.tags.map((tag) => tag.id));
  return {
    ...vault,
    schemaVersion: vault.schemaVersion ?? 1,
    vaultId: vault.vaultId ?? `vault-import-${crypto.randomUUID()}`,
    people: asArray(vault.people).map((person) =>
      rewritePersonTagIds(normalizeDraft(person), normalizedPersonGroups.redirects, normalizedInterests.redirects, validPersonGroupIds, validInterestIds)
    ),
    personGroupTags: normalizedPersonGroups.tags,
    interestTags: normalizedInterests.tags,
    customFieldDefs: asArray(vault.customFieldDefs),
    deletedItems: asArray(vault.deletedItems),
    tombstones,
    syncMeta: {
      updatedAt: vault.syncMeta?.updatedAt ?? now,
      updatedByDeviceId: vault.syncMeta?.updatedByDeviceId ?? "imported",
      revision: vault.syncMeta?.revision ?? 1
    }
  };
}

function getPerson(id) {
  return state.vault.people.find((person) => person.id === id);
}

function normalizeTagCollection(tags, defaultTags, tombstones, tombstoneType, updatedAt) {
  if (!tags) return { tags: defaultTags.map((tag) => ({ ...tag })), redirects: new Map() };
  const retiredIds = tombstoneType === "personGroupTag" ? new Set(RETIRED_PERSON_GROUP_TAG_IDS) : new Set();
  tags = asArray(tags)
    .map((tag) => normalizeTag(tag, tombstoneType, updatedAt))
    .filter((tag) => tag.id && tag.name && !retiredIds.has(tag.id));
  const redirects = new Map();
  const defaultIds = new Set(defaultTags.map((tag) => tag.id));
  const output = [];
  const usedInputIds = new Set();

  defaultTags.forEach((defaultTag) => {
    if (isTagTombstoned(tombstones, tombstoneType, defaultTag.id)) return;
    const sameId = tags.find((tag) => tag.id === defaultTag.id);
    const sameName = tags.find((tag) => tag.id !== defaultTag.id && tag.name === defaultTag.name);
    const source = sameId ?? sameName;

    if (!source) {
      output.push({ ...defaultTag });
      return;
    }

    usedInputIds.add(source.id);
    if (source.id !== defaultTag.id) redirects.set(source.id, defaultTag.id);
    output.push({
      ...source,
      id: defaultTag.id,
      name: defaultTag.name,
      isDefault: true,
      updatedAt: source.id === defaultTag.id && source.name === defaultTag.name ? source.updatedAt : updatedAt,
      updatedByDeviceId: source.updatedByDeviceId ?? "system"
    });
  });

  const activeDefaultNames = new Set(output.map((tag) => tag.name));
  tags.forEach((tag) => {
    if (usedInputIds.has(tag.id)) return;
    if (defaultIds.has(tag.id)) return;
    if (activeDefaultNames.has(tag.name)) return;
    output.push({ ...tag, isDefault: false });
  });

  return { tags: output, redirects };
}

function normalizeTag(tag, tombstoneType, fallbackTime) {
  const source = tag && typeof tag === "object" ? tag : { name: tag };
  const prefix = tombstoneType === "personGroupTag" ? "person-group" : "interest";
  return {
    ...source,
    id: asString(source.id) || `${prefix}-${crypto.randomUUID()}`,
    name: asString(source.name),
    isDefault: Boolean(source.isDefault),
    createdAt: normalizeTimestamp(source.createdAt, fallbackTime),
    updatedAt: normalizeTimestamp(source.updatedAt, fallbackTime),
    updatedByDeviceId: asString(source.updatedByDeviceId || "imported")
  };
}

function isTagTombstoned(tombstones, type, id) {
  return tombstones.some((item) => item.type === type && item.id === id);
}

function rewritePersonTagIds(person, groupRedirects, interestRedirects, validGroupIds = null, validInterestIds = null) {
  const groupIds = uniqueIds(person.personGroupTagIds.map((id) => groupRedirects.get(id) ?? id));
  const interestIds = uniqueIds(person.interestTagIds.map((id) => interestRedirects.get(id) ?? id));
  return {
    ...person,
    personGroupTagIds: validGroupIds ? groupIds.filter((id) => validGroupIds.has(id)) : groupIds,
    interestTagIds: validInterestIds ? interestIds.filter((id) => validInterestIds.has(id)) : interestIds
  };
}

function uniqueIds(ids) {
  return [...new Set(ids)];
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return value === undefined || value === null ? "" : String(value);
}

function asStringArray(value) {
  return asArray(value).map(asString).filter(Boolean);
}

function normalizeTimestamp(value, fallback = new Date().toISOString()) {
  const text = asString(value);
  return Number.isNaN(new Date(text).getTime()) ? fallback : text;
}

function normalizeListRows(rows, defaultLabel = "") {
  return asArray(rows).map((row, index) => {
    const source = row && typeof row === "object" ? row : { value: row };
    const now = new Date().toISOString();
    return {
      ...source,
      id: asString(source.id) || `list-${crypto.randomUUID()}`,
      label: asString(source.label) || defaultLabel,
      value: asString(source.value),
      isDefault: Boolean(source.isDefault),
      createdAt: normalizeTimestamp(source.createdAt, now),
      updatedAt: normalizeTimestamp(source.updatedAt, now)
    };
  });
}

function normalizeAddressRows(rows) {
  return normalizeListRows(rows, "住家").map((row) => ({
    ...row,
    city: asString(row.city),
    district: asString(row.district),
    detail: asString(row.detail) || legacyAddressDetail(row)
  }));
}

function legacyAddressDetail(row) {
  const value = asString(row.value);
  if (!value) return "";
  const prefix = `${asString(row.city)}${asString(row.district)}`;
  return prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function normalizeTextRows(rows, prefix) {
  return asArray(rows).map((row) => {
    const source = row && typeof row === "object" ? row : { value: row };
    const now = new Date().toISOString();
    return {
      ...source,
      id: asString(source.id) || `${prefix}-${crypto.randomUUID()}`,
      value: asString(source.value),
      createdAt: normalizeTimestamp(source.createdAt, now),
      updatedAt: normalizeTimestamp(source.updatedAt, now)
    };
  });
}

function normalizeFamilyRows(rows) {
  return asArray(rows).map((row) => {
    const source = row && typeof row === "object" ? row : { name: row };
    const now = new Date().toISOString();
    return {
      ...source,
      id: asString(source.id) || `family-${crypto.randomUUID()}`,
      relationship: asString(source.relationship || source.customRelationship),
      customRelationship: asString(source.customRelationship),
      name: asString(source.name),
      personId: asString(source.personId),
      createdAt: normalizeTimestamp(source.createdAt, now),
      updatedAt: normalizeTimestamp(source.updatedAt, now)
    };
  });
}

function normalizeLifeEventRows(rows) {
  return asArray(rows).map((row) => {
    const source = row && typeof row === "object" ? row : { text: row };
    const now = new Date().toISOString();
    return {
      ...source,
      id: asString(source.id) || `event-${crypto.randomUUID()}`,
      date: asString(source.date),
      text: asString(source.text ?? source.value),
      createdAt: normalizeTimestamp(source.createdAt, now),
      updatedAt: normalizeTimestamp(source.updatedAt, now)
    };
  });
}

function normalizeCustomValueRows(values) {
  if (Array.isArray(values)) {
    return values
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        return {
          ...item,
          fieldId: asString(item.fieldId),
          value: normalizeCustomStoredValue(item.value),
          updatedAt: normalizeTimestamp(item.updatedAt),
          updatedByDeviceId: asString(item.updatedByDeviceId)
        };
      })
      .filter((item) => item?.fieldId);
  }
  if (values && typeof values === "object") {
    return Object.entries(values).map(([fieldId, value]) => ({
      fieldId,
      value: normalizeCustomStoredValue(value),
      updatedAt: new Date().toISOString(),
      updatedByDeviceId: state.appState?.deviceId ?? "imported"
    }));
  }
  return [];
}

function normalizeCustomStoredValue(value) {
  if (Array.isArray(value)) return value.map((item) => (item && typeof item === "object" ? normalizeDateRangeRow(item) : asString(item)));
  if (value && typeof value === "object") return normalizeDateRangeRow(value);
  return asString(value);
}

function normalizeDateRangeRow(row) {
  const now = new Date().toISOString();
  return {
    ...row,
    id: asString(row.id) || `date-range-${crypto.randomUUID()}`,
    startDate: asString(row.startDate),
    endDate: asString(row.endDate),
    text: asString(row.text ?? row.value),
    createdAt: normalizeTimestamp(row.createdAt, now),
    updatedAt: normalizeTimestamp(row.updatedAt, now)
  };
}

function normalizeDraft(draft = {}) {
  return {
    ...draft,
    id: asString(draft.id) || `person-${crypto.randomUUID()}`,
    name: asString(draft.name),
    nationalId: asString(draft.nationalId),
    nickname: asString(draft.nickname),
    gender: asString(draft.gender),
    birthDate: asString(draft.birthDate),
    workInfo: asString(draft.workInfo),
    phones: normalizeListRows(draft.phones, "手機"),
    addresses: normalizeAddressRows(draft.addresses),
    personGroupTagIds: asStringArray(draft.personGroupTagIds),
    interestTagIds: asStringArray(draft.interestTagIds),
    favoriteItems: normalizeTextRows(draft.favoriteItems, "favorite"),
    familyMembers: normalizeFamilyRows(draft.familyMembers),
    lifeEvents: normalizeLifeEventRows(draft.lifeEvents),
    customValues: normalizeCustomValueRows(draft.customValues),
    archivedAt: asString(draft.archivedAt),
    note: asString(draft.note),
    createdAt: normalizeTimestamp(draft.createdAt),
    updatedAt: normalizeTimestamp(draft.updatedAt),
    updatedByDeviceId: asString(draft.updatedByDeviceId)
  };
}

function cleanList(rows) {
  const cleaned = rows.filter((row) => row.value.trim()).map((row) => ({ ...row, value: row.value.trim(), updatedAt: new Date().toISOString() }));
  ensureSingleDefault(cleaned);
  return cleaned;
}

function cleanAddressList(rows = []) {
  const now = new Date().toISOString();
  const cleaned = rows
    .map((row) => {
      const city = row.city ?? "";
      const district = row.district ?? "";
      const detail = addressDetailValue(row).trim();
      return {
        ...row,
        city,
        district,
        detail,
        value: buildAddressValue({ city, district, detail }),
        updatedAt: now
      };
    })
    .filter((row) => row.value.trim());
  ensureSingleDefault(cleaned);
  return cleaned;
}

function buildAddressValue(row) {
  return [row.city, row.district, row.detail ?? row.value].map((part) => String(part ?? "").trim()).filter(Boolean).join("");
}

function ensureSingleDefault(rows) {
  if (!rows.length) return;
  if (!rows.some((row) => row.isDefault)) rows[0].isDefault = true;
  let found = false;
  rows.forEach((row) => {
    if (row.isDefault && !found) found = true;
    else row.isDefault = false;
  });
}

function sortDefaultFirst(rows) {
  return [...rows].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function cleanFavoriteItems(rows = []) {
  const now = new Date().toISOString();
  return rows
    .map((row) => ({ ...row, value: row.value?.trim() ?? "" }))
    .filter((row) => row.value)
    .map((row) => ({ ...row, updatedAt: now }));
}

function cleanFamilyMembers(rows = [], currentPersonId = "") {
  const now = new Date().toISOString();
  return rows
    .map((row) => {
      const relationship = (row.relationship || row.customRelationship || "").trim();
      const name = (row.name ?? "").trim();
      const linked = row.personId ? visiblePeople(state.vault.people).find((person) => person.id === row.personId && person.id !== currentPersonId) : null;
      const autoLinked = linked ? linked : findUniqueVisiblePersonByName(name, currentPersonId);
      return {
        ...row,
        relationship,
        customRelationship: row.customRelationship?.trim() ?? "",
        name,
        personId: autoLinked?.id ?? "",
        updatedAt: now
      };
    })
    .filter((row) => row.relationship && row.name)
    .sort(compareFamilyMembers);
}

function cleanLifeEvents(rows = []) {
  const now = new Date().toISOString();
  return sortLifeEvents(
    rows
      .map((row) => ({ ...row, date: row.date ?? "", text: row.text?.trim() ?? "", updatedAt: now }))
      .filter((row) => row.text)
  );
}

function cleanCustomValues(values = []) {
  return values
    .map((item) => {
      const field = state.vault.customFieldDefs.find((field) => field.id === item.fieldId);
      if (field?.type === "dateRange") return { ...item, value: cleanDateRangeValues(item.value) };
      return { ...item, value: Array.isArray(item.value) ? item.value.filter(Boolean) : item.value };
    })
    .filter((item) => !isEmptyCustomValue(item.value));
}

function isEmptyCustomValue(value) {
  return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

function getCustomValue(person, fieldId) {
  return person.customValues.find((item) => item.fieldId === fieldId)?.value ?? "";
}

function setCustomValue(person, fieldId, value) {
  const customValues = person.customValues.filter((item) => item.fieldId !== fieldId);
  if (isEmptyCustomValue(value)) {
    person.customValues = customValues;
    return;
  }
  person.customValues = [
    ...customValues,
    { fieldId, value, updatedAt: new Date().toISOString(), updatedByDeviceId: state.appState.deviceId }
  ];
}

function dateRangeRows(value, includeBlank = false) {
  const rows = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  const normalized = rows.map((row) => ({
    id: asString(row.id) || `date-range-${crypto.randomUUID()}`,
    startDate: asString(row.startDate),
    endDate: asString(row.endDate),
    text: asString(row.text ?? row.value),
    createdAt: normalizeTimestamp(row.createdAt),
    updatedAt: normalizeTimestamp(row.updatedAt)
  }));
  return normalized.length || !includeBlank
    ? normalized
    : [
        {
          id: `date-range-${crypto.randomUUID()}`,
          startDate: "",
          endDate: "",
          text: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];
}

function cleanDateRangeValues(value = []) {
  const now = new Date().toISOString();
  return dateRangeRows(value, false)
    .map((row) => ({
      ...row,
      startDate: row.startDate ?? "",
      endDate: row.endDate ?? "",
      text: row.text?.trim() ?? "",
      updatedAt: now
    }))
    .filter((row) => row.startDate || row.endDate || row.text)
    .sort(compareDateRangeRows);
}

function compareDateRangeRows(a, b) {
  const aDate = a.startDate || a.endDate || "";
  const bDate = b.startDate || b.endDate || "";
  if (aDate && bDate && aDate !== bDate) return bDate.localeCompare(aDate);
  if (aDate && !bDate) return -1;
  if (!aDate && bDate) return 1;
  return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
}

function cleanCustomOptions(options = []) {
  const seen = new Set();
  return options
    .map((option) => String(option ?? "").trim())
    .filter((option) => {
      if (!option || seen.has(option)) return false;
      seen.add(option);
      return true;
    });
}

function isChoiceField(field) {
  return field?.type === "single" || field?.type === "multi";
}

function renameCustomOptionInValues(values = [], fieldId, oldName, newName) {
  return values.map((item) => {
    if (item.fieldId !== fieldId) return item;
    if (Array.isArray(item.value)) {
      return { ...item, value: item.value.map((value) => (value === oldName ? newName : value)) };
    }
    return item.value === oldName ? { ...item, value: newName } : item;
  });
}

function removeCustomOptionFromValues(values = [], fieldId, optionName) {
  return values
    .map((item) => {
      if (item.fieldId !== fieldId) return item;
      if (Array.isArray(item.value)) return { ...item, value: item.value.filter((value) => value !== optionName) };
      return item.value === optionName ? { ...item, value: "" } : item;
    })
    .filter((item) => !isEmptyCustomValue(item.value));
}

function sortFamilyMembers(rows = []) {
  return [...rows].sort(compareFamilyMembers);
}

function compareFamilyMembers(a, b) {
  const aBirthDate = familyMemberBirthDate(a);
  const bBirthDate = familyMemberBirthDate(b);
  if (aBirthDate && bBirthDate && aBirthDate !== bBirthDate) return aBirthDate.localeCompare(bBirthDate);
  if (aBirthDate && !bBirthDate) return -1;
  if (!aBirthDate && bBirthDate) return 1;
  return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
}

function familyMemberBirthDate(member) {
  const linked = member.personId ? getPerson(member.personId) : findUniqueVisiblePersonByName(member.name ?? "");
  return linked?.birthDate ?? "";
}

function linkPendingFamilyMembersToUniquePerson(vault, targetPerson) {
  if (!targetPerson?.name?.trim() || targetPerson.archivedAt) return vault;
  const matches = visiblePeopleInVault(vault.people).filter((person) => person.name.trim() === targetPerson.name.trim());
  if (matches.length !== 1) return vault;
  const now = new Date().toISOString();
  return {
    ...vault,
    people: vault.people.map((person) => {
      if (person.id === targetPerson.id) return person;
      let changed = false;
      const familyMembers = (person.familyMembers ?? []).map((member) => {
        if (member.personId || (member.name ?? "").trim() !== targetPerson.name.trim()) return member;
        changed = true;
        return { ...member, personId: targetPerson.id, name: targetPerson.name, updatedAt: now };
      });
      return changed
        ? { ...person, familyMembers, updatedAt: now, updatedByDeviceId: state.appState.deviceId }
        : person;
    })
  };
}

function familyMemberNameMatches(name, sourcePersonId = "") {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) return [];
  return visiblePeople(state.vault.people).filter((person) => person.id !== sourcePersonId && person.name.trim() === cleanName);
}

function visiblePeopleInVault(people = []) {
  return sortPeople(people.filter((person) => !person.archivedAt));
}

function sortLifeEvents(rows = []) {
  return [...rows].sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
  });
}

function visiblePeople(people = []) {
  return sortPeople(people.filter((person) => !person.archivedAt));
}

function homePeople(people = []) {
  return people
    .filter((person) => !person.archivedAt)
    .sort((a, b) => {
      const byUpdated = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() - new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
      if (byUpdated !== 0) return byUpdated;
      return sortPeople([a, b])[0].id === a.id ? -1 : 1;
    });
}

function findUniqueVisiblePersonByName(name, excludeId = "") {
  const cleanName = name.trim();
  if (!cleanName) return null;
  const matches = visiblePeople(state.vault.people).filter((person) => person.id !== excludeId && person.name.trim() === cleanName);
  return matches.length === 1 ? matches[0] : null;
}

function customRelationshipValue(row) {
  if (row.customRelationship) return row.customRelationship;
  if (row.relationship && !FAMILY_RELATIONSHIP_ORDER.includes(row.relationship)) return row.relationship;
  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

boot();
