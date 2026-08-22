import { getItem, removeItem, setItem } from "./db.js";
import { connectDrive, disconnectDrive, driveAuthStatus, driveReadiness, listDriveFiles, readDriveFile, writeDriveFile } from "./drive.js";
import { APP_CONFIG, driveFileName, driveProviderLabel } from "./config.js";
import { mergeVaults } from "./sync.js";
import { buildVaultXlsx } from "./xlsx.js";
import {
  createKeyPackage,
  createTrustedSessionWithDek,
  decryptVaultEnvelope,
  encryptVaultEnvelope,
  generateRecoveryCode,
  normalizeRecoveryCode,
  restoreDekFromTrustedSession,
  unwrapDek,
  wrapDekForSecret
} from "./crypto.js";
import {
  DEFAULT_INTEREST_TAGS,
  createDeviceId,
  createEmptyVault,
  createPerson,
  daysUntil,
  formatDateTime,
  sortPeople,
  touchVault
} from "./model.js";

const app = document.querySelector("#app");
const FAMILY_RELATIONSHIP_ORDER = ["父", "母", "配偶", "子", "女", "兄", "姐", "弟", "妹"];
const FAMILY_RELATIONSHIP_OPTIONS = [...FAMILY_RELATIONSHIP_ORDER, "其它"];
const THEME_OPTIONS = [
  { id: "comfortable-green", name: "舒適綠", colors: ["#24443D", "#5B9EA6", "#F4F6F5"] },
  { id: "business-blue", name: "商務藍", colors: ["#1E293B", "#2563EB", "#F8FAFC"] },
  { id: "gentle-pink", name: "溫柔粉", colors: ["#8B5E83", "#D88FA3", "#FFF7F8"] },
  { id: "warm-amber", name: "暖琥珀", colors: ["#292D32", "#C58B3A", "#FFFFFF"] },
  { id: "memory-paper", name: "回憶灰", colors: ["#667887", "#A77A52", "#F3EEE4"] }
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
  installPromptEvent: null,
  installDismissed: localStorage.getItem("forget-me-not-install-dismissed") === "true",
  isInstalled: isPwaInstalled()
};

async function boot() {
  const appState = await getItem("appState");
  const vault = await getItem("vault");
  const trustedSession = await getItem("trustedSession");
  const localSnapshots = await getItem("localSnapshots") ?? [];
  state = { ...state, localSnapshots };
  if (!appState || !vault) {
    state = { ...state, route: { name: "welcome" } };
  } else if (appState.mode === "driveSync" && !trustedSession) {
    state = { ...state, appState, vault: normalizeVault(pruneDeleted(vault)), route: { name: "unlock" } };
  } else {
    let dekBytes = null;
    if (appState.mode === "driveSync") {
      const sessionCheck = await checkTrustedSessionStillValid(appState, trustedSession);
      if (!sessionCheck.valid) {
        await removeItem("trustedSession");
        state = {
          ...state,
          appState,
          vault: normalizeVault(pruneDeleted(vault)),
          route: { name: "unlock", message: sessionCheck.message, showForgotPassword: true }
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
        state = { ...state, appState, vault: normalizeVault(pruneDeleted(vault)), route: { name: "unlock" } };
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
}

async function checkTrustedSessionStillValid(appState, trustedSession) {
  if (!trustedSession) return { valid: false, message: "請輸入密碼以繼續使用" };
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

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").then((registration) => {
      state.serviceWorkerRegistration = registration;
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
    if (!event.state?.appRoute) return;
    state.route = restoreHistoryRoute(event.state.route);
    render({ restoreScroll: true });
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
        showForgotPassword: true
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
  await setItem("vault", state.vault);
  try {
    await saveEncryptedVaultEnvelope();
  } catch (error) {
    markDriveSyncIssue(error);
  }
}

async function commitVault(vault) {
  await createLocalSnapshot("修改前自動快照");
  state.vault = touchVault(vault, state.appState.deviceId);
  markLocalVaultChanged();
  await save();
  render();
}

async function setupMasterPassword(event) {
  event.preventDefault();
  const draft = state.route.passwordDraft ?? { password: "", confirm: "" };
  if (draft.password.length < 6) {
    alert("密碼至少需要 6 個字元");
    return;
  }
  if (draft.password !== draft.confirm) {
    alert("兩次輸入的密碼不一致");
    return;
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
  await uploadKeyPackageToDrive();
  await uploadCurrentVaultToDrive();
  state.route = { name: "showRecoveryCode", recoveryCode: result.recoveryCode };
  render();
}

function finishRecoveryCode() {
  navigate({ name: "home" }, { replace: true });
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
    await setItem("vault", state.vault);
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
    state.route = { name: "home" };
    void resumeDriveSyncInBackground();
    render();
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
    state.route = merged.conflicts.length ? { name: "syncConflicts" } : { name: "home" };
    alert(syncAlertMessage(state.appState.googleDrive.lastSyncSummary, merged.conflicts.length));
    render();
  } catch (error) {
    markDriveSyncIssue(error);
    alert(driveErrorMessage(error, "資料已在本機合併，但 Google Drive 寫回失敗，請稍後再按「立即同步」。"));
    render();
  }
}

async function syncNow(options = {}) {
  if (!state.appState?.googleDrive?.connected) return;
  if (state.appState.googleDrive.syncStatus === "syncing") return;
  if (options.silent && !driveAuthStatus().hasAccessToken) return;
  state.appState = {
    ...state.appState,
    googleDrive: {
      ...state.appState.googleDrive,
      syncStatus: "syncing",
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
      await setItem("vault", state.vault);
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
        lastSyncError: ""
      }
    };
    await save();
    if (!options.silent) alert(syncAlertMessage(state.appState.googleDrive.lastSyncSummary, conflicts.length));
    render();
  } catch (error) {
    const message = driveErrorMessage(error, "同步失敗，請稍後再試");
    state.appState = {
      ...state.appState,
      googleDrive: {
        ...state.appState.googleDrive,
        syncStatus: "error",
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
  disconnectDrive();
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
    await syncNow({ silent: true });
  } catch {}
}

async function exportData() {
  if (!state.vault) return;
  const exportedAt = new Date().toISOString();
  const payload = buildExportPayload(exportedAt);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `勿忘我-資料備份-${fileDateTime(exportedAt)}.json`);
  await rememberDataManagementEvent("lastJsonExportAt", exportedAt);
}

async function createLocalSnapshot(reason) {
  if (!state.vault) return;
  const createdAt = new Date().toISOString();
  const snapshot = {
    id: `snapshot-${crypto.randomUUID()}`,
    reason,
    createdAt,
    peopleCount: state.vault.people.length,
    vault: structuredClone(state.vault)
  };
  state.localSnapshots = [snapshot, ...(state.localSnapshots ?? [])].slice(0, 3);
  await setItem("localSnapshots", state.localSnapshots);
}

async function restoreLocalSnapshot(id) {
  const snapshot = state.localSnapshots.find((item) => item.id === id);
  if (!snapshot) return;
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
  state.localSnapshots = state.localSnapshots.filter((item) => item.id !== id);
  await setItem("localSnapshots", state.localSnapshots);
  render();
}

function downloadLocalSnapshot(id) {
  const snapshot = state.localSnapshots.find((item) => item.id === id);
  if (!snapshot) return;
  const payload = {
    fileType: "forget-me-not-vault-export",
    schemaVersion: 1,
    appName: "勿忘我",
    exportedAt: new Date().toISOString(),
    note: "此檔案來自本機快照，只包含人物資料，不包含密碼、資料金鑰或救援碼。",
    vault: snapshot.vault
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `勿忘我-本機快照-${fileDateTime(snapshot.createdAt)}.json`);
}

async function exportExcel() {
  if (!state.vault) return;
  const exportedAt = new Date().toISOString();
  const blob = buildVaultXlsx(state.vault, exportedAt);
  downloadBlob(blob, `勿忘我-資料匯出-${fileDateTime(exportedAt)}.xlsx`);
  await rememberDataManagementEvent("lastExcelExportAt", exportedAt);
}

function buildExportPayload(exportedAt = new Date().toISOString()) {
  return {
    fileType: "forget-me-not-vault-export",
    schemaVersion: 1,
    appName: "勿忘我",
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
  try {
    const payload = JSON.parse(await file.text());
    const importedVault = readImportVault(payload);
    const importedPeopleCount = importedVault.people.length;
    const importedTagCount = importedVault.interestTags.length;
    if (
      !confirm(
        `確定要匯入這份資料嗎？\n\n人物：${importedPeopleCount} 位\n興趣喜好：${importedTagCount} 個\n\n匯入會與目前資料合併，不會直接清空現有資料。\n匯入前會先下載一份目前本機資料備份。`
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
    alert("匯入失敗，請確認檔案是否為勿忘我的資料備份檔。");
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
  downloadBlob(blob, `勿忘我-匯入前本機備份-${fileDateTime(exportedAt)}.json`);
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
    state.route = { name: "home" };
    void resumeDriveSyncInBackground();
    render();
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
    navigate({ name: "settings" });
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
    const { keyPackage, dekBytes } = await unwrapCurrentDek(recoveryCode, "recoveryCodeWrapper");
    const updated = await replaceMasterPasswordAndRecovery(keyPackage, dekBytes, draft.newPassword, true);
    await uploadKeyPackageToDrive();
    state.route = { name: "showRecoveryCode", recoveryCode: updated.recoveryCode, oldInvalid: true };
    render();
  } catch {
    alert("救援碼不正確，請確認後再試一次");
  }
}

async function regenerateRecoveryCode(event) {
  event.preventDefault();
  const draft = state.route.securityDraft ?? {};
  try {
    const { keyPackage, dekBytes } = await unwrapCurrentDek(draft.currentPassword);
    const updated = await replaceRecoveryCode(keyPackage, dekBytes);
    await uploadKeyPackageToDrive();
    state.route = { name: "showRecoveryCode", recoveryCode: updated.recoveryCode, oldInvalid: true };
    render();
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
    state.route = { name: "unlock", message: "已從所有裝置登出，請重新輸入密碼", showForgotPassword: true };
    render();
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
  const now = new Date().toISOString();
  const recoveryCode = generateRecoveryCode();
  const masterPasswordWrapper = await wrapDekForSecret(dekBytes, newPassword, keyPackage.crypto.iterations);
  const recoveryCodeWrapper = await wrapDekForSecret(dekBytes, recoveryCode, keyPackage.crypto.iterations);
  const sessionEpoch = bumpSession ? keyPackage.securityMeta.sessionEpoch + 1 : keyPackage.securityMeta.sessionEpoch;
  const updatedKeyPackage = {
    ...keyPackage,
    masterPasswordWrapper: {
      ...masterPasswordWrapper,
      updatedByDeviceId: state.appState.deviceId
    },
    recoveryCodeWrapper: {
      ...recoveryCodeWrapper,
      recoveryCodeVersion: keyPackage.recoveryCodeWrapper.recoveryCodeVersion + 1,
      updatedByDeviceId: state.appState.deviceId
    },
    securityMeta: {
      ...keyPackage.securityMeta,
      passwordChangedAt: now,
      passwordChangedByDeviceId: state.appState.deviceId,
      sessionEpoch,
      updatedAt: now
    }
  };
  await setItem("keyPackage", updatedKeyPackage);
  await setItem(
    "trustedSession",
    await createTrustedSessionWithDek({
      vaultId: updatedKeyPackage.vaultId,
      deviceId: state.appState.deviceId,
      sessionEpoch,
      dekBytes
    })
  );
  return { keyPackage: updatedKeyPackage, recoveryCode };
}

async function replaceRecoveryCode(keyPackage, dekBytes) {
  const recoveryCode = generateRecoveryCode();
  const now = new Date().toISOString();
  const recoveryCodeWrapper = await wrapDekForSecret(dekBytes, recoveryCode, keyPackage.crypto.iterations);
  const updatedKeyPackage = {
    ...keyPackage,
    recoveryCodeWrapper: {
      ...recoveryCodeWrapper,
      recoveryCodeVersion: keyPackage.recoveryCodeWrapper.recoveryCodeVersion + 1,
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

function navigate(route, options = {}) {
  syncCurrentHistoryScroll();
  state.route = prepareRouteForNavigation(route);
  render({ restoreScroll: true });
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

function navigateBack(fallbackRoute) {
  syncCurrentHistoryScroll();
  if (history.state?.appRoute && history.length > 1) {
    history.back();
    return;
  }
  navigate(fallbackRoute, { replace: true });
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
    scrollY: Number.isFinite(route.scrollY) ? route.scrollY : 0,
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
  app.innerHTML = `<main class="app route-${escapeAttr(state.route.name)}">${view()}</main>${updatePromptView()}`;
  bind();
  if (options.restoreScroll) restoreRouteScroll(state.route);
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
  if (state.route.name === "settings") return settingsView();
  if (state.route.name === "syncConflicts") return syncConflictsView();
  if (state.route.name === "dataHealth") return dataHealthView();
  if (state.route.name === "localSnapshots") return localSnapshotsView();
  if (state.route.name === "archived") return archivedPeopleView();
  if (state.route.name === "syncTroubleshooting") return syncTroubleshootingView();
  if (state.route.name === "installGuide") return installGuideView();
  if (state.route.name === "deleted") return deletedView();
  if (state.route.name === "driveIntro") return driveIntroView();
  if (state.route.name === "driveCloudChoice") return driveCloudChoiceView();
  if (state.route.name === "driveMergeUnlock") return driveMergeUnlockView();
  if (state.route.name === "driveExistingUnlock") return driveExistingUnlockView();
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
        <h1 class="title">勿忘我</h1>
        <p class="subtitle">把重要的人與細節先安心記下來。</p>
      </div>
      <div class="panel stack">
        <button data-action="start-local">開始使用</button>
      </div>
      ${installPromptCard("welcome")}
    </section>
  `;
}

function homeView() {
  const people = visiblePeople(state.vault.people);
  return `
    <header class="home-header app-header">
      <div></div>
      <h1 class="title">勿忘我</h1>
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
  return `
    <header class="topbar">
      <button class="secondary" data-nav="home">返回</button>
      <h1 class="section-title">搜尋</h1>
      <span></span>
    </header>
    <section class="panel search-panel">
      <div class="field">
        <label>依輸入文字搜尋</label>
        <input data-search="text" placeholder="姓名、其它、嗜好品、重大事件、自訂欄位…" value="${escapeAttr(params.text)}" />
      </div>
      <div class="field">
        <label>依地址搜尋</label>
        <input data-search="address" placeholder="地址" value="${escapeAttr(params.address)}" />
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
        <label>依興趣喜好搜尋</label>
        <div class="chip-list">${state.vault.interestTags.map((tag) => interestChip(tag, params.tagIds.includes(tag.id), "search-tag")).join("")}</div>
      </div>
      <div class="actions search-actions">
        <button data-action="apply-search">套用搜尋</button>
        <button data-action="clear-search" class="secondary">清除搜尋</button>
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
  state.route.draft ??= normalizeDraft(draft);
  const d = state.route.draft;
  const title = person ? "編輯人物" : "新增人物";
  return `
    <header class="topbar">
      <span></span>
      <h1 class="section-title">${title}</h1>
      <span></span>
    </header>
    <form class="stack" data-form="person">
      ${inputField("姓名 *", "name", d.name)}
      ${inputField("生日", "birthDate", d.birthDate, "date")}
      ${listEditor("電話", "phones", d.phones, ["手機", "家裡", "公司", "其它"], "電話號碼")}
      ${listEditor("地址", "addresses", d.addresses, ["住家", "公司", "其它"], "地址")}
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
  const tags = person.interestTagIds.map((id) => state.vault.interestTags.find((tag) => tag.id === id)).filter(Boolean);
  const favoriteItems = person.favoriteItems ?? [];
  const familyMembers = sortFamilyMembers(person.familyMembers ?? []);
  const lifeEvents = sortLifeEvents(person.lifeEvents ?? []);
  const identityLines = [
    person.birthDate ? detailLine("生日", person.birthDate) : ""
  ]
    .filter(Boolean)
    .join("");
  const customSections = customDefsForPerson(person.id)
    .map((field) => {
      const value = person.customValues.find((item) => item.fieldId === field.id)?.value;
      if (isEmptyCustomValue(value)) return "";
      return detailGroup(field.name, `<p class="detail-value">${escapeHtml(formatCustomValue(field, value))}</p>`, "custom-detail-section");
    })
    .filter(Boolean)
    .join("");
  const detailSections = [
    identityLines ? detailGroup("基本資料", identityLines) : "",
    person.phones.length ? detailGroup("電話", sortDefaultFirst(person.phones).map((phone) => detailLine(`${phone.label} ${phone.value}`, "", `<a class="button-link" href="tel:${escapeAttr(phone.value)}">撥打</a><button class="secondary" data-copy="${escapeAttr(phone.value)}">複製</button>`)).join("")) : "",
    person.addresses.length ? detailGroup("地址", sortDefaultFirst(person.addresses).map((address) => detailLine(`${address.label} ${address.value}`, "", `<button class="secondary" data-copy="${escapeAttr(address.value)}">複製</button>`)).join("")) : "",
    tags.length ? detailGroup("興趣喜好", `<div class="chip-list">${tags.map((tag) => `<span class="chip selected">${tagLabel(tag)}</span>`).join("")}</div>`) : "",
    favoriteItems.length ? detailGroup("嗜好品", `<div class="chip-list">${favoriteItems.map((item) => `<span class="chip selected">${escapeHtml(item.value)}</span>`).join("")}</div>`) : "",
    familyMembers.length ? detailGroup("家族成員", familyMembers.map(familyMemberLine).join("")) : "",
    lifeEvents.length ? detailGroup("重大事件", lifeEvents.map(lifeEventLine).join("")) : "",
    customSections,
    person.note ? detailGroup("其它備註", `<p class="detail-value">${escapeHtml(person.note).replaceAll("\n", "<br>")}</p>`) : ""
  ].filter(Boolean).join("");
  const hasDetailContent = Boolean(
    identityLines ||
      person.phones.length ||
      person.addresses.length ||
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
      <h1 class="section-title detail-page-title">${escapeHtml(person.name)}</h1>
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
      ${pendingConflicts.length ? `<button data-nav="syncConflicts">處理衝突資料</button>` : ""}
      <button class="secondary" data-nav="syncTroubleshooting">同步疑難排解</button>
      ${gd.connected ? `<button class="secondary" data-action="sync-now" ${gd.syncStatus === "syncing" ? "disabled" : ""}>立即同步</button><button class="secondary" data-action="drive-logout">登出 Google Drive</button>` : `<button data-action="drive-placeholder">連結 Google Drive</button>`}
    </section>
    ${installSettingsSection()}
    ${themeSettingsSection()}
    ${gd.connected ? `<section class="panel stack"><h2 class="section-title">安全性</h2><button class="secondary" data-nav="changePassword">更改密碼</button><button class="secondary" data-nav="forgotPassword">忘記密碼</button><button class="secondary" data-nav="regenerateRecovery">重新產生救援碼</button><button class="danger" data-nav="logoutAllDevices">登出所有裝置</button></section>` : ""}
    <section class="panel stack">
      <h2 class="section-title">資料管理</h2>
      ${storageWarningView()}
      <div class="data-summary">
        <span>人物 ${dataSummary.peopleCount} 位</span>
        <span>興趣喜好 ${dataSummary.interestTagCount} 個</span>
        <span>自訂欄位 ${dataSummary.customFieldCount} 個</span>
      </div>
      ${dataManagement.lastJsonExportAt ? `<p class="muted">最近 JSON 備份：${formatDateTime(dataManagement.lastJsonExportAt)}</p>` : ""}
      ${dataManagement.lastExcelExportAt ? `<p class="muted">最近 Excel 匯出：${formatDateTime(dataManagement.lastExcelExportAt)}</p>` : ""}
      ${dataManagement.lastImportAt ? `<p class="muted">最近匯入：${formatDateTime(dataManagement.lastImportAt)}</p>` : ""}
      <button class="secondary" data-nav="localSnapshots">本機資料快照</button>
      <button class="secondary" data-nav="deleted">最近刪除</button>
      <button class="secondary" data-nav="archived">查看封存人物</button>
      <button class="secondary" data-action="export-data">匯出備份檔（JSON）</button>
      <button class="secondary" data-action="export-excel">匯出 Excel（XLSX）</button>
      <button class="secondary" data-action="choose-import-file">匯入資料</button>
      <button class="secondary" data-nav="dataHealth">資料完整性檢查</button>
      <input type="file" accept="application/json,.json" data-import-file hidden />
      <p class="muted">JSON 備份檔可用於匯入復原；Excel 檔適合人工檢視。匯出的資料不包含密碼、資料金鑰或救援碼；請自行妥善保存，避免他人取得。</p>
    </section>
    <section class="panel stack">
      <h2 class="section-title">關於</h2>
      <p>版本：${escapeHtml(APP_CONFIG.appVersion)}</p>
      <p class="muted">快取版本：${escapeHtml(APP_CONFIG.cacheName)}</p>
      <button type="button" class="secondary" data-action="check-version-update">檢查版本更新</button>
      <div class="legal-links">
        <a href="./privacy.html">隱私權政策</a>
        <a href="./terms.html">服務條款</a>
      </div>
    </section>
    ${bottomNav("settings")}
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
        <h2 class="section-title">安裝勿忘我</h2>
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
  const canPrompt = Boolean(state.installPromptEvent);
  return `
    <section class="panel stack">
      <h2 class="section-title">安裝到裝置</h2>
      <p>狀態：${installed ? "已使用 App 模式開啟" : "尚未以 App 模式開啟"}</p>
      <p class="muted">${installed ? "目前已像 App 一樣獨立開啟，不需要重複安裝。" : "建議安裝到手機主畫面，日後可以直接從主畫面開啟勿忘我。"}</p>
      ${installed ? "" : `<button type="button" data-action="${canPrompt ? "install-app" : "open-install-guide"}">${canPrompt ? "安裝到裝置" : "查看安裝方式"}</button>`}
    </section>
  `;
}

function themeSettingsSection() {
  const selected = currentThemeId();
  return `
    <section class="panel stack">
      <h2 class="section-title">主題色系</h2>
      <p class="muted">此設定只保存在本機裝置，不會同步到 Google Drive。</p>
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
        <li>開啟勿忘我網址。</li>
        <li>點右上角「⋮」。</li>
        <li>選擇「安裝應用程式」或「加入主畫面」。</li>
        <li>確認後即可從主畫面開啟。</li>
      </ol>
    </section>
    <section class="panel stack">
      <h2 class="section-title">iPhone / iPad Safari</h2>
      <ol class="guide-list">
        <li>請使用 Safari 開啟勿忘我網址。</li>
        <li>點下方或上方的「分享」按鈕。</li>
        <li>選擇「加入主畫面」。</li>
        <li>點「新增」。</li>
      </ol>
    </section>
    <section class="panel stack">
      <h2 class="section-title">電腦版 Chrome / Edge</h2>
      <ol class="guide-list">
        <li>開啟勿忘我網址。</li>
        <li>若網址列右側出現安裝圖示，可直接點擊。</li>
        <li>也可從瀏覽器選單選擇「安裝勿忘我」。</li>
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
  return `
    <header class="topbar">
      <button class="secondary" data-action="cancel-drive-setup">返回</button>
      <h1 class="section-title">連結 Google Drive</h1>
      <span></span>
    </header>
    <section class="panel stack">
      <p>${isCreateFromLocal ? "將使用目前本機資料建立新的 Google Drive 同步資料。" : "連結 Google Drive 後，勿忘我會先在本機建立加密用的資料金鑰，並用你的密碼與救援碼分別保護它。"}</p>
      <p class="muted">目前同步模式：${driveProviderLabel()}。資料會先加密後再寫入 Google Drive appDataFolder。</p>
      <button data-nav="setupMasterPassword">開始設定密碼</button>
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
      <p>Google Drive 中已有勿忘我的同步資料。</p>
      <p class="muted">此裝置目前有本機資料：人物 ${dataSummary.peopleCount} 位。按下資料同步後，系統會先解開雲端資料，再依既有合併規則整合本機與雲端內容。</p>
      <button type="button" data-nav="driveMergeUnlock">資料同步</button>
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
    </form>
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
  return `
    <section class="welcome">
      <div>
        <h1 class="title">勿忘我</h1>
        <p class="subtitle">${escapeHtml(message)}</p>
      </div>
      <form class="panel stack" data-form="unlock">
        <div class="field">
          <label>密碼</label>
          <input type="password" data-security-draft="password" autocomplete="current-password" />
        </div>
        <button type="submit">登入 App</button>
        ${forgotPasswordButton}
      </form>
    </section>
  `;
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
    fields: [
      ["recoveryCode", "救援碼", "one-time-code"],
      ["newPassword", "新密碼", "new-password"],
      ["confirmPassword", "再次輸入新密碼", "new-password"]
    ],
    submit: "重設密碼"
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

function securityFormView({ title, form, fields, submit, intro = "", danger = false }) {
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-nav="settings">返回</button>
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
  const phone = sortDefaultFirst(person.phones)[0];
  return `
    <button class="person-card" data-detail="${person.id}">
      <span class="name">${escapeHtml(person.name)}</span>
      <span aria-hidden="true">›</span>
      <span class="phone">${phone ? `${escapeHtml(phone.label)} ${escapeHtml(phone.value)}` : "尚未設定電話"}</span>
    </button>
  `;
}

function familyMemberLine(member) {
  const linked = member.personId ? getPerson(member.personId) : null;
  const canOpen = linked && !linked.archivedAt;
  const name = member.name || linked?.name || "";
  const action = canOpen
    ? `<button type="button" class="ghost link-button" data-action="open-detail" data-id="${escapeAttr(linked.id)}">${escapeHtml(name)}</button>`
    : name
      ? linked?.archivedAt
        ? `<span class="muted">${escapeHtml(name)}</span>`
        : `<button type="button" class="ghost link-button" data-action="new-person-prefill" data-name="${escapeAttr(name)}">${escapeHtml(name)}</button>`
      : "";
  return `<div class="detail-line"><span>${escapeHtml(member.relationship)}</span><span>${action}</span></div>`;
}

function lifeEventLine(event) {
  const date = event.date ? formatCustomValue({ type: "date" }, event.date) : "未填日期";
  return detailLine(date, event.text);
}

function inputField(label, field, value, type = "text") {
  return `<section class="panel"><h2 class="section-title">${label}</h2><input type="${type}" data-field="${field}" value="${escapeAttr(value)}" /></section>`;
}

function listEditor(title, key, rows, labels, placeholder) {
  return `
    <section class="panel">
      <h2 class="section-title">${title}</h2>
      <div class="stack">
        ${rows.map((row, index) => `
          <div class="inline-item">
            <div class="row">
              <select data-list="${key}" data-index="${index}" data-prop="label">
                ${labels.map((label) => `<option ${row.label === label ? "selected" : ""}>${label}</option>`).join("")}
              </select>
              <input data-list="${key}" data-index="${index}" data-prop="value" placeholder="${placeholder}" value="${escapeAttr(row.value)}" />
            </div>
            <div class="actions">
              <button type="button" class="secondary" data-action="set-default" data-list-key="${key}" data-index="${index}">${row.isDefault ? "預設" : "設為預設"}</button>
              <button type="button" class="danger" data-action="remove-list-item" data-list-key="${key}" data-index="${index}">刪除</button>
            </div>
          </div>
        `).join("")}
      </div>
      <div class="actions">
        <button type="button" class="secondary" data-action="add-list-item" data-list-key="${key}">＋ 新增${title}</button>
      </div>
    </section>
  `;
}

function interestEditor(selectedIds) {
  const managing = Boolean(state.route.interestManage);
  return `
    <section class="panel">
      <h2 class="section-title">興趣喜好</h2>
      <div class="chip-list">${state.vault.interestTags.map((tag) => interestOption(tag, selectedIds.includes(tag.id), managing)).join("")}</div>
      ${managing ? interestManageForm() : ""}
      <div class="actions">
        <button type="button" class="secondary" data-action="toggle-interest-manage">${managing ? "完成編輯" : "新增/移除興趣喜好"}</button>
        <button type="button" class="secondary" data-action="restore-default-interests">恢復預設興趣喜好</button>
      </div>
    </section>
  `;
}

function interestOption(tag, selected, managing) {
  return `
    <span class="tag-option">
      ${interestChip(tag, selected, "toggle-interest")}
      ${managing ? `<button type="button" class="danger mini" data-action="remove-interest" data-id="${tag.id}">移除</button>` : ""}
    </span>
  `;
}

function interestManageForm() {
  return `
    <div class="inline-item manage-form">
      <div class="field">
        <label>新增興趣喜好名稱</label>
        <input data-route-field="newInterestName" placeholder="例如：🍞 烘焙" value="${escapeAttr(state.route.newInterestName ?? "")}" />
      </div>
      <div class="actions">
        <button type="button" data-action="confirm-add-interest">確認</button>
        <button type="button" class="secondary" data-action="cancel-interest-manage">取消</button>
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
            <input data-favorite-item="${index}" placeholder="例如：咖啡、紅酒、雪茄" value="${escapeAttr(row.value)}" />
            ${deleting ? `<div class="actions"><button type="button" class="danger" data-action="remove-favorite-item" data-index="${index}">刪除</button></div>` : ""}
          </div>
        `).join("") : `<p class="muted">尚未新增嗜好品。</p>`}
      </div>
      <div class="actions">
        <button type="button" class="secondary" data-action="add-favorite-item">＋ 新增嗜好品</button>
        <button type="button" class="secondary" data-action="toggle-favorite-item-delete-mode">${deleting ? "完成編輯" : "刪除欄位"}</button>
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
        ${rows.length ? rows.map((row, index) => familyMemberEditorRow(row, index, listId, deleting)).join("") : `<p class="muted">尚未新增家族成員。</p>`}
      </div>
      <div class="actions">
        <button type="button" class="secondary" data-action="add-family-member">＋ 新增家族成員</button>
        <button type="button" class="secondary" data-action="toggle-family-member-delete-mode">${deleting ? "完成編輯" : "刪除欄位"}</button>
      </div>
    </section>
  `;
}

function familyMemberEditorRow(row, index, listId, deleting) {
  const preset = FAMILY_RELATIONSHIP_ORDER.includes(row.relationship) ? row.relationship : "其它";
  return `
    <div class="inline-item">
      <div class="row">
        <select data-family-member="${index}" data-prop="relationshipPreset">
          ${FAMILY_RELATIONSHIP_OPTIONS.map((label) => `<option value="${label}" ${preset === label ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        <input data-family-member="${index}" data-prop="name" list="${listId}" placeholder="姓名" value="${escapeAttr(row.name)}" />
      </div>
      ${
        preset === "其它"
          ? `<div class="field"><label>自訂稱謂</label><input data-family-member="${index}" data-prop="customRelationship" placeholder="例如：表哥" value="${escapeAttr(customRelationshipValue(row))}" /></div>`
          : ""
      }
      ${deleting ? `<div class="actions"><button type="button" class="danger" data-action="remove-family-member" data-index="${index}">刪除</button></div>` : ""}
    </div>
  `;
}

function lifeEventsEditor(rows) {
  const deleting = Boolean(state.route.lifeEventDeleteMode);
  return `
    <section class="panel">
      <h2 class="section-title">重大事件</h2>
      <div class="stack">
        ${rows.length ? rows.map((row, index) => `
          <div class="inline-item">
            <div class="row">
              <input type="date" data-life-event="${index}" data-prop="date" value="${escapeAttr(row.date)}" />
              <input data-life-event="${index}" data-prop="text" placeholder="事件內容" value="${escapeAttr(row.text)}" />
            </div>
            ${deleting ? `<div class="actions"><button type="button" class="danger" data-action="remove-life-event" data-index="${index}">刪除</button></div>` : ""}
          </div>
        `).join("") : `<p class="muted">尚未新增重大事件。</p>`}
      </div>
      <div class="actions">
        <button type="button" class="secondary" data-action="add-life-event">＋ 新增重大事件</button>
        <button type="button" class="secondary" data-action="toggle-life-event-delete-mode">${deleting ? "完成編輯" : "刪除欄位"}</button>
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
  const editing = Boolean(state.route.customFieldEdit);
  return `
    <section class="panel">
      <h2 class="section-title">自訂欄位</h2>
      <div class="stack">
        ${fields.length ? fields.map((field) => customFieldInput(field, person, editing)).join("") : `<p class="muted">尚未建立自訂欄位。</p>`}
      </div>
      ${adding ? customFieldAddForm() : ""}
      <div class="actions">
        <button type="button" class="secondary" data-action="toggle-custom-field-add">＋ 新增自訂欄位</button>
        <button type="button" class="secondary" data-action="toggle-custom-field-edit">${editing ? "完成編輯" : "編輯自訂欄位"}</button>
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
                <button type="button" class="secondary" data-action="add-custom-field-draft-option">新增</button>
              </div>
            </div>`
          : ""
      }
      <div class="actions">
        <button type="button" data-action="confirm-add-custom-field">確認</button>
        <button type="button" class="secondary" data-action="cancel-custom-field-add">取消</button>
      </div>
    </div>
  `;
}

function customFieldInput(field, person, editing) {
  const current = person.customValues.find((item) => item.fieldId === field.id)?.value ?? "";
  if (isChoiceField(field)) {
    return `
      <div class="inline-item custom-field-card">
        <div class="field">
          <label>${escapeHtml(field.name)}</label>
          <div class="chip-list">${(field.options ?? []).map((option) => choiceChip(field, current, option)).join("")}</div>
        </div>
        ${editing ? customFieldActions(field) : ""}
      </div>
    `;
  }
  const type = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
  return `
    <div class="inline-item custom-field-card">
      <div class="field">
        <label>${escapeHtml(field.name)}</label>
        <input type="${type}" data-custom-value="${field.id}" value="${escapeAttr(current)}" />
      </div>
      ${editing ? customFieldActions(field) : ""}
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
          ? `<input data-route-field="editingCustomFieldName" value="${escapeAttr(state.route.editingCustomFieldName ?? field.name)}" /><button type="button" data-action="confirm-rename-custom-field" data-id="${field.id}">確認改名</button><button type="button" class="secondary" data-action="cancel-rename-custom-field">取消</button>`
          : `<button type="button" class="secondary" data-action="start-rename-custom-field" data-id="${field.id}">變更欄位名稱</button><button type="button" class="danger" data-action="delete-custom-field" data-id="${field.id}">刪除</button>`
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
            <div class="row">
              <input data-custom-option-name="${field.id}" data-option="${escapeAttr(option)}" value="${escapeAttr(draftName)}" />
              <button type="button" class="secondary" data-action="rename-custom-option" data-field-id="${field.id}" data-option="${escapeAttr(option)}">改名</button>
              <button type="button" class="danger" data-action="delete-custom-option" data-field-id="${field.id}" data-option="${escapeAttr(option)}">刪除</button>
            </div>
          `;
        }).join("")}
      </div>
      <div class="row">
        <input data-custom-option-new="${field.id}" placeholder="新增選項" value="${escapeAttr(newValue)}" />
        <button type="button" class="secondary" data-action="add-custom-option" data-field-id="${field.id}">新增選項</button>
      </div>
    </div>
  `;
}

function detailGroup(title, content, className = "") {
  if (!content) return "";
  return `<section class="detail-section ${className}"><h2 class="section-title">${escapeHtml(title)}</h2>${content}</section>`;
}

function detailLine(label, value = "", action = "", className = "") {
  return `<div class="detail-line ${className}"><span>${escapeHtml(label)}${value ? `<br><span class="muted">${escapeHtml(value)}</span>` : ""}</span><span class="detail-actions-row">${action}</span></div>`;
}

function bottomNav(current) {
  const target = current === "home" ? { name: "settings", label: "設定" } : { name: "home", label: "首頁" };
  return `
    <nav class="bottom-nav">
      <button data-nav="${target.name}">${target.label}</button>
    </nav>
  `;
}

function notFoundView() {
  return `<div class="empty">找不到這筆人物資料。<div class="actions"><button data-nav="home">回首頁</button></div></div>`;
}

function bind() {
  app.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      const fallbackRoute = { name: el.dataset.nav, id: el.dataset.id };
      if (el.textContent.trim() === "返回") navigateBack(fallbackRoute);
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
      state.route.draft[el.dataset.field] = el.value;
    });
  });
  app.querySelectorAll("[data-route-field]").forEach((el) => {
    el.addEventListener("input", () => {
      state.route[el.dataset.routeField] = el.value;
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
    el.addEventListener("input", () => {
      const row = state.route.draft[el.dataset.list][Number(el.dataset.index)];
      row[el.dataset.prop] = el.value;
    });
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
    el.addEventListener("input", () => {
      const row = state.route.draft.lifeEvents[Number(el.dataset.lifeEvent)];
      row[el.dataset.prop] = el.value;
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

function bindSecurityForms() {
  const handlers = {
    unlock: unlockWithMasterPassword,
    "drive-existing-unlock": unlockExistingDriveVault,
    "drive-merge-unlock": mergeExistingDriveVault,
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
  if (action === "export-data") return exportData();
  if (action === "export-excel") return exportExcel();
  if (action === "choose-import-file") return app.querySelector("[data-import-file]")?.click();
  if (action === "restore-local-snapshot") return restoreLocalSnapshot(el.dataset.id);
  if (action === "delete-local-snapshot") return deleteLocalSnapshot(el.dataset.id);
  if (action === "download-local-snapshot") return downloadLocalSnapshot(el.dataset.id);
  if (action === "open-detail") return navigate(detailRoute(el.dataset.id));
  if (action === "detail-back") return navigateBackFromDetail();
  if (action === "cancel-form") return navigate(state.route.id ? detailRoute(state.route.id) : { name: "home" });
  if (action === "edit-person") return navigate({ name: "edit", id: el.dataset.id, returnTo: state.route.returnTo });
  if (action === "delete-person") return deletePerson(el.dataset.id);
  if (action === "archive-person") return archivePerson(el.dataset.id);
  if (action === "restore-archived-person") return restoreArchivedPerson(el.dataset.id);
  if (action === "delete-archived-person") return deleteArchivedPerson(el.dataset.id);
  if (action === "restore-person") return restorePerson(el.dataset.id);
  if (action === "purge-person") return purgePerson(el.dataset.id);
  if (action === "add-list-item") return addListItem(el.dataset.listKey);
  if (action === "remove-list-item") return removeListItem(el.dataset.listKey, Number(el.dataset.index));
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
  if (action === "toggle-interest") return toggleInterest(el.dataset.id);
  if (action === "search-tag") return toggleSearchTag(el.dataset.id);
  if (action === "toggle-interest-manage") return toggleInterestManage();
  if (action === "confirm-add-interest") return addInterest();
  if (action === "cancel-interest-manage") return cancelInterestManage();
  if (action === "remove-interest") return removeInterest(el.dataset.id);
  if (action === "restore-default-interests") return restoreDefaultInterests();
  if (action === "toggle-custom-field-add") return toggleCustomFieldAdd();
  if (action === "toggle-custom-field-edit") return toggleCustomFieldEdit();
  if (action === "add-custom-field-draft-option") return addCustomFieldDraftOption();
  if (action === "remove-custom-field-draft-option") return removeCustomFieldDraftOption(Number(el.dataset.index));
  if (action === "confirm-add-custom-field") return addCustomField();
  if (action === "cancel-custom-field-add") return cancelCustomFieldAdd();
  if (action === "start-rename-custom-field") return startRenameCustomField(el.dataset.id);
  if (action === "confirm-rename-custom-field") return confirmRenameCustomField(el.dataset.id);
  if (action === "cancel-rename-custom-field") return cancelRenameCustomField();
  if (action === "delete-custom-field") return deleteCustomFieldById(el.dataset.id);
  if (action === "toggle-custom-choice") return toggleCustomChoice(el.dataset.fieldId, el.dataset.option);
  if (action === "add-custom-option") return addCustomOption(el.dataset.fieldId);
  if (action === "rename-custom-option") return renameCustomOption(el.dataset.fieldId, el.dataset.option);
  if (action === "delete-custom-option") return deleteCustomOption(el.dataset.fieldId, el.dataset.option);
  if (action === "apply-search") return render();
  if (action === "clear-search") return navigate({ name: "search", params: emptySearchParams() });
}

function toggleRouteFlag(key) {
  state.route[key] = !state.route[key];
  render();
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
  const vault = structuredClone(state.vault);
  const now = new Date().toISOString();
  const person = {
    ...draft,
    name: draft.name.trim(),
    nationalId: draft.nationalId.trim(),
    note: draft.note.trim(),
    phones: cleanList(draft.phones),
    addresses: cleanList(draft.addresses),
    favoriteItems: cleanFavoriteItems(draft.favoriteItems),
    familyMembers: cleanFamilyMembers(draft.familyMembers, draft.id),
    lifeEvents: cleanLifeEvents(draft.lifeEvents),
    customValues: cleanCustomValues(draft.customValues),
    updatedAt: now,
    updatedByDeviceId: state.appState.deviceId
  };
  const index = vault.people.findIndex((item) => item.id === person.id);
  if (index >= 0) vault.people[index] = person;
  else vault.people.push(person);
  state.route = { name: "detail", id: person.id, returnTo: state.route.returnTo };
  await commitVault(vault);
}

function addListItem(key) {
  state.route.draft[key].push({
    id: `${key}-${crypto.randomUUID()}`,
    label: key === "phones" ? "手機" : "住家",
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

function toggleInterest(id) {
  const selected = state.route.draft.interestTagIds;
  state.route.draft.interestTagIds = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
  render();
}

function toggleSearchTag(id) {
  const params = normalizeSearchParams(state.route.params);
  params.tagIds = params.tagIds.includes(id) ? params.tagIds.filter((item) => item !== id) : [...params.tagIds, id];
  state.route.params = params;
  render();
}

function toggleInterestManage() {
  state.route.interestManage = !state.route.interestManage;
  state.route.newInterestName ??= "";
  render();
}

function cancelInterestManage() {
  state.route.interestManage = false;
  state.route.newInterestName = "";
  render();
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
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString()
      }
    ]
  };
  if (state.route.draft) state.route.draft.interestTagIds = state.route.draft.interestTagIds.filter((item) => item !== tag.id);
  await commitVault(vault);
}

async function restoreDefaultInterests() {
  if (!confirm("確定要恢復預設興趣喜好嗎？\n這會重新加入缺少的預設項目，不會刪除你的自訂項目。")) return;
  const existing = new Set(state.vault.interestTags.map((tag) => tag.id));
  const missing = DEFAULT_INTEREST_TAGS.filter((tag) => !existing.has(tag.id));
  await commitVault({ ...state.vault, interestTags: [...state.vault.interestTags, ...missing] });
}

function toggleCustomFieldAdd() {
  state.route.customFieldAdd = !state.route.customFieldAdd;
  state.route.customFieldDraft ??= { name: "", type: "text", scope: "person", options: [], newOption: "" };
  render();
}

function toggleCustomFieldEdit() {
  state.route.customFieldEdit = !state.route.customFieldEdit;
  state.route.editingCustomFieldId = "";
  state.route.editingCustomFieldName = "";
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
  const tagIds = new Set(state.vault.interestTags.map((tag) => tag.id));
  const fieldIds = new Set(state.vault.customFieldDefs.map((field) => field.id));
  const people = visiblePeople(state.vault.people);
  const personNames = countBy(people, (person) => person.name.trim());
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
  const address = normalizedParams.address.trim().toLowerCase();
  const tagIds = normalizedParams.tagIds;
  const birthdayMonths = Number(normalizedParams.birthdayWithinMonths || 0);
  const matched = visiblePeople(state.vault.people).filter((person) => {
    const textMatch =
      !text ||
      [
        person.name,
        person.note,
        ...(person.favoriteItems ?? []).map((item) => item.value),
        ...(person.lifeEvents ?? []).map((event) => event.text),
        ...person.customValues.map((value) => formatSearchValue(value.value))
      ]
        .join(" ")
        .toLowerCase()
        .includes(text);
    const addressMatch = !address || person.addresses.some((item) => item.value.toLowerCase().includes(address));
    const tagMatch = tagIds.every((id) => (person.interestTagIds ?? []).includes(id));
    const birthdayMatch = !birthdayMonths || isBirthdayWithinMonths(person.birthDate, birthdayMonths);
    return textMatch && addressMatch && tagMatch && birthdayMatch;
  });
  return matched.sort((a, b) => {
    const aName = text && a.name.toLowerCase().includes(text);
    const bName = text && b.name.toLowerCase().includes(text);
    if (aName !== bName) return aName ? -1 : 1;
    return sortPeople([a, b])[0].id === a.id ? -1 : 1;
  });
}

function hasSearchCriteria(params) {
  const normalizedParams = normalizeSearchParams(params);
  return Boolean(normalizedParams.text.trim() || normalizedParams.address.trim() || normalizedParams.tagIds.length || normalizedParams.birthdayWithinMonths);
}

function emptySearchParams() {
  return { text: "", address: "", tagIds: [], birthdayWithinMonths: "" };
}

function normalizeSearchParams(params = {}) {
  return {
    text: params.text ?? "",
    address: params.address ?? "",
    tagIds: params.tagIds ?? [],
    birthdayWithinMonths: params.birthdayWithinMonths ?? ""
  };
}

function formatSearchValue(value) {
  if (Array.isArray(value)) return value.join(" ");
  return String(value ?? "");
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
    interestTagCount: state.vault?.interestTags?.length ?? 0,
    customFieldCount: state.vault?.customFieldDefs?.length ?? 0
  };
}

function driveErrorMessage(error, fallback) {
  const message = error?.message ?? "";
  if (message.includes("google-identity-services-load-failed")) return "無法載入 Google 登入服務，請確認網路連線後再試。";
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
    tombstones: (vault.tombstones ?? []).filter((item) => new Date(item.expiresAt).getTime() > now)
  };
}

function normalizeVault(vault) {
  const now = new Date().toISOString();
  return {
    ...vault,
    schemaVersion: vault.schemaVersion ?? 1,
    vaultId: vault.vaultId ?? `vault-import-${crypto.randomUUID()}`,
    people: (vault.people ?? []).map(normalizeDraft),
    interestTags: (vault.interestTags ?? []).map((tag) => {
      if (!tag.emoji) return tag;
      const name = tag.name.startsWith(tag.emoji) ? tag.name : `${tag.emoji} ${tag.name}`;
      const { emoji, ...rest } = tag;
      return { ...rest, name };
    }),
    customFieldDefs: vault.customFieldDefs ?? [],
    deletedItems: vault.deletedItems ?? [],
    tombstones: vault.tombstones ?? [],
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

function normalizeDraft(draft) {
  return {
    ...draft,
    nationalId: draft.nationalId ?? "",
    birthDate: draft.birthDate ?? "",
    phones: draft.phones?.length ? draft.phones : [],
    addresses: draft.addresses?.length ? draft.addresses : [],
    interestTagIds: draft.interestTagIds ?? [],
    favoriteItems: draft.favoriteItems ?? [],
    familyMembers: draft.familyMembers ?? [],
    lifeEvents: draft.lifeEvents ?? [],
    customValues: draft.customValues ?? [],
    archivedAt: draft.archivedAt ?? "",
    note: draft.note ?? ""
  };
}

function cleanList(rows) {
  const cleaned = rows.filter((row) => row.value.trim()).map((row) => ({ ...row, value: row.value.trim(), updatedAt: new Date().toISOString() }));
  ensureSingleDefault(cleaned);
  return cleaned;
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
    .map((item) => ({ ...item, value: Array.isArray(item.value) ? item.value.filter(Boolean) : item.value }))
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
  const aIndex = FAMILY_RELATIONSHIP_ORDER.indexOf(a.relationship);
  const bIndex = FAMILY_RELATIONSHIP_ORDER.indexOf(b.relationship);
  const aRank = aIndex >= 0 ? aIndex : FAMILY_RELATIONSHIP_ORDER.length;
  const bRank = bIndex >= 0 ? bIndex : FAMILY_RELATIONSHIP_ORDER.length;
  if (aRank !== bRank) return aRank - bRank;
  return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
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
