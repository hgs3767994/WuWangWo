import { getItem, removeItem, setItem } from "./db.js";
import { connectDrive, disconnectDrive, driveAuthStatus, driveReadiness, listDriveFiles, readDriveFile, testDriveConnection, writeDriveFile } from "./drive.js";
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
let state = {
  appState: null,
  dekBytes: null,
  vault: null,
  route: { name: "loading" },
  updateAvailable: false,
  waitingServiceWorker: null
};

async function boot() {
  const appState = await getItem("appState");
  const vault = await getItem("vault");
  const trustedSession = await getItem("trustedSession");
  if (!appState || !vault) {
    state = { ...state, route: { name: "welcome" } };
  } else if (appState.mode === "driveSync" && !trustedSession) {
    state = { appState, vault: normalizeVault(pruneDeleted(vault)), route: { name: "unlock" } };
  } else {
    let dekBytes = null;
    if (appState.mode === "driveSync") {
      const sessionCheck = await checkTrustedSessionStillValid(appState, trustedSession);
      if (!sessionCheck.valid) {
        await removeItem("trustedSession");
        state = {
          appState,
          vault: normalizeVault(pruneDeleted(vault)),
          route: { name: "unlock", message: sessionCheck.message, showForgotPassword: true }
        };
        render();
        registerServiceWorker();
        return;
      }
      try {
        dekBytes = await restoreDekFromTrustedSession(trustedSession);
      } catch {
        await removeItem("trustedSession");
        state = { appState, vault: normalizeVault(pruneDeleted(vault)), route: { name: "unlock" } };
        render();
        registerServiceWorker();
        return;
      }
    }
    state = { appState, dekBytes, vault: normalizeVault(pruneDeleted(vault)), route: { name: "home" } };
    await save();
    void resumeDriveSyncInBackground();
  }
  render();
  registerServiceWorker();
}

async function checkTrustedSessionStillValid(appState, trustedSession) {
  if (!trustedSession) return { valid: false, message: "請輸入密碼以繼續使用" };
  const localKeyPackage = await getKeyPackage();
  let remoteKeyPackage = null;
  if (appState.googleDrive?.connected) {
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

async function initializeLocalMode() {
  const deviceId = createDeviceId();
  const vault = createEmptyVault(deviceId);
  state.appState = {
    schemaVersion: 1,
    mode: "localOnly",
    deviceId,
    currentVaultId: vault.vaultId,
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
    await connectDrive();
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
        simulated: isSimulatedDrive()
      }
    };
    await setItem("appState", state.appState);
    await syncNow({ silent: true });
    alert(`已重新連結 Google Drive（${driveProviderLabel()}）`);
    render();
    return;
  }
  if (!state.appState || !state.vault) {
    const driveFiles = await listDriveFiles();
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
      googleDrive: {
        connected: false,
        syncStatus: "disabled"
      }
    };
    state.vault = vault;
  }
  navigate({ name: "driveIntro" });
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
  state.vault = touchVault(vault, state.appState.deviceId);
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
  state.route = { name: "home" };
  render();
}

async function getKeyPackage() {
  return getItem("keyPackage");
}

async function getCurrentKeyPackage() {
  const localKeyPackage = await getKeyPackage();
  if (!state.appState?.googleDrive?.connected) return localKeyPackage;
  const remoteKeyPackage = await readDriveFile(driveFileName("keyPackage"));
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
  if (state.appState.googleDrive.connected) {
    await writeDriveFile(driveFileName("vault"), envelope);
  }
}

async function uploadKeyPackageToDrive() {
  if (!state.appState?.googleDrive?.connected) return;
  const keyPackage = await getKeyPackage();
  if (keyPackage) await writeDriveFile(driveFileName("keyPackage"), keyPackage);
}

async function uploadCurrentVaultToDrive() {
  if (!state.dekBytes) return;
  await saveEncryptedVaultEnvelope();
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

async function syncNow(options = {}) {
  if (!state.appState?.googleDrive?.connected) return;
  if (state.appState.googleDrive.syncStatus === "syncing") return;
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
    await connectDrive();
    const remoteEnvelope = await readDriveFile(driveFileName("vault"));
    let conflicts = [];
    if (remoteEnvelope && state.dekBytes) {
      const remoteVault = await decryptVaultEnvelope(remoteEnvelope, state.dekBytes);
      const merged = mergeVaults(state.vault, normalizeVault(pruneDeleted(remoteVault)), state.appState.deviceId);
      state.vault = merged.vault;
      conflicts = merged.conflicts;
      await setItem("vault", state.vault);
    }
    await uploadKeyPackageToDrive();
    await uploadCurrentVaultToDrive();
    state.appState = {
      ...state.appState,
      googleDrive: {
        ...state.appState.googleDrive,
        syncStatus: conflicts.length ? "needsResolution" : "synced",
        lastSyncAt: new Date().toISOString(),
        pendingConflicts: conflicts,
        simulated: isSimulatedDrive(),
        lastSyncError: ""
      }
    };
    await save();
    if (!options.silent) alert(conflicts.length ? "已同步，但有資料衝突需要處理" : `已同步（${driveProviderLabel()}）`);
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

async function runDriveDiagnostics() {
  state.route = { ...state.route, running: true, result: null };
  render();
  try {
    const result = await testDriveConnection();
    state.route = {
      ...state.route,
      running: false,
      result: {
        ok: result.ok,
        fileName: result.fileName,
        message: result.ok ? "已成功完成授權、寫入、讀取與刪除測試。" : "測試檔讀回內容不一致，請稍後再試。"
      }
    };
  } catch (error) {
    state.route = {
      ...state.route,
      running: false,
      result: {
        ok: false,
        message: driveErrorMessage(error, "Google Drive 連線診斷失敗，請稍後再試。")
      }
    };
  }
  render();
}

function applyLocalGoogleConfig() {
  const clientId = state.route.oauthClientId?.trim() ?? "";
  if (!clientId.endsWith(".apps.googleusercontent.com")) {
    alert("OAuth Client ID 格式看起來不正確，應以 .apps.googleusercontent.com 結尾。");
    return;
  }
  localStorage.setItem(
    "forget-me-not-runtime-config",
    JSON.stringify({
      driveProvider: "google",
      googleDrive: {
        clientId
      }
    })
  );
  window.location.reload();
}

function clearLocalGoogleConfig() {
  localStorage.removeItem("forget-me-not-runtime-config");
  window.location.reload();
}

async function logoutGoogleDrive() {
  if (!confirm("確定要登出 Google Drive 嗎？\n此裝置將停止與 Google Drive 同步，但不會刪除本機資料或雲端資料。")) return;
  disconnectDrive();
  state.appState = {
    ...state.appState,
    googleDrive: {
      ...state.appState.googleDrive,
      connected: false,
      syncStatus: "disabled"
    }
  };
  await save();
  render();
}

async function resumeDriveSyncInBackground() {
  if (!state.appState?.googleDrive?.connected || state.route.name !== "home") return;
  try {
    await syncNow({ silent: true });
  } catch {}
}

function exportData() {
  if (!state.vault) return;
  const exportedAt = new Date().toISOString();
  const payload = {
    fileType: "forget-me-not-vault-export",
    schemaVersion: 1,
    appName: "勿忘我",
    exportedAt,
    note: "此檔案只包含人物資料，不包含密碼、資料金鑰或救援碼。",
    vault: state.vault
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `勿忘我-資料備份-${fileDateTime(exportedAt)}.json`);
}

function exportExcel() {
  if (!state.vault) return;
  const exportedAt = new Date().toISOString();
  const blob = buildVaultXlsx(state.vault, exportedAt);
  downloadBlob(blob, `勿忘我-資料匯出-${fileDateTime(exportedAt)}.xlsx`);
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
        `確定要匯入這份資料嗎？\n\n人物：${importedPeopleCount} 位\n興趣喜好：${importedTagCount} 個\n\n匯入會與目前資料合併，不會直接清空現有資料。`
      )
    ) {
      return;
    }
    const merged = mergeVaults(state.vault, importedVault, state.appState.deviceId);
    state.vault = merged.vault;
    const existingConflicts = state.appState.googleDrive.pendingConflicts ?? [];
    state.appState = {
      ...state.appState,
      googleDrive: {
        ...state.appState.googleDrive,
        syncStatus: merged.conflicts.length || existingConflicts.length ? "needsResolution" : state.appState.googleDrive.syncStatus,
        pendingConflicts: [...existingConflicts, ...merged.conflicts],
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

function navigate(route) {
  state.route = route;
  render();
}

function currentRouteSnapshot() {
  return structuredClone({
    name: state.route.name,
    params: state.route.params,
    id: state.route.id
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
  navigate(state.route.returnTo ?? { name: "home" });
}

function render() {
  app.innerHTML = `<main class="app">${view()}</main>${updatePromptView()}`;
  bind();
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
  if (state.route.name === "driveDeveloperGuide") return driveDeveloperGuideView();
  if (state.route.name === "driveDiagnostics") return driveDiagnosticsView();
  if (state.route.name === "deleted") return deletedView();
  if (state.route.name === "driveIntro") return driveIntroView();
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
        <button data-action="start-local">立即開始使用</button>
        <button class="secondary" data-action="drive-placeholder">連結 Google Drive 同步</button>
      </div>
    </section>
  `;
}

function homeView() {
  const people = sortPeople(state.vault.people);
  return `
    <header class="home-header">
      <h1 class="title">勿忘我</h1>
      <div class="home-actions">
        <button data-nav="new">＋ 新增人物</button>
        <button class="secondary" data-nav="search">搜尋</button>
      </div>
    </header>
    ${people.length ? people.map(personCard).join("") : `<div class="empty">還沒有任何人物，先新增一位吧。</div>`}
    ${bottomNav("home")}
  `;
}

function searchView() {
  const params = state.route.params ?? { text: "", address: "", tagIds: [] };
  const hasCriteria = hasSearchCriteria(params);
  const results = hasCriteria ? searchPeople(params) : [];
  return `
    <header class="topbar">
      <button class="secondary" data-nav="home">返回</button>
      <h1 class="section-title">搜尋</h1>
      <span></span>
    </header>
    <section class="panel">
      <div class="field">
        <label>依輸入文字搜尋</label>
        <input data-search="text" placeholder="姓名、其它、自訂欄位…" value="${escapeAttr(params.text)}" />
      </div>
      <div class="field">
        <label>依地址搜尋</label>
        <input data-search="address" placeholder="地址" value="${escapeAttr(params.address)}" />
      </div>
      <div class="field">
        <label>依興趣喜好搜尋</label>
        <div class="chip-list">${state.vault.interestTags.map((tag) => interestChip(tag, params.tagIds.includes(tag.id), "search-tag")).join("")}</div>
      </div>
      <div class="actions">
        <button data-action="apply-search" class="secondary">套用搜尋</button>
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
  const draft = person ? structuredClone(person) : createPerson(state.appState.deviceId, { name: "" });
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
      ${inputField("身分證字號", "nationalId", d.nationalId)}
      ${inputField("生日", "birthDate", d.birthDate, "date")}
      ${listEditor("電話", "phones", d.phones, ["手機", "家裡", "公司", "其它"], "電話號碼")}
      ${listEditor("地址", "addresses", d.addresses, ["住家", "公司", "其它"], "地址")}
      ${interestEditor(d.interestTagIds)}
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
  const identityLines = [
    person.nationalId ? detailLine("身分證字號", person.nationalId, `<button class="secondary" data-copy="${escapeAttr(person.nationalId)}">複製</button>`) : "",
    person.birthDate ? detailLine("生日", person.birthDate) : ""
  ]
    .filter(Boolean)
    .join("");
  const customLines = customDefsForPerson(person.id)
    .map((field) => {
      const value = person.customValues.find((item) => item.fieldId === field.id)?.value;
      if (value === undefined || value === "") return "";
      return detailLine(field.name, formatCustomValue(field, value), "", "custom-detail-line");
    })
    .filter(Boolean)
    .join("");
  const hasDetailContent = Boolean(
    identityLines ||
      person.phones.length ||
      person.addresses.length ||
      tags.length ||
      customLines ||
      person.note
  );
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-action="detail-back">返回</button>
      <h1 class="section-title">${escapeHtml(person.name)}</h1>
      <span></span>
    </header>
    ${identityLines ? `<section class="panel">${identityLines}</section>` : ""}
    ${person.phones.length ? detailGroup("電話", sortDefaultFirst(person.phones).map((phone) => detailLine(`${phone.label} ${phone.value}`, "", `<a class="button-link" href="tel:${escapeAttr(phone.value)}">撥打</a><button class="secondary" data-copy="${escapeAttr(phone.value)}">複製</button>`)).join("")) : ""}
    ${person.addresses.length ? detailGroup("地址", sortDefaultFirst(person.addresses).map((address) => detailLine(`${address.label} ${address.value}`, "", `<button class="secondary" data-copy="${escapeAttr(address.value)}">複製</button>`)).join("")) : ""}
    ${tags.length ? detailGroup("興趣喜好", `<div class="chip-list">${tags.map((tag) => `<span class="chip selected">${tagLabel(tag)}</span>`).join("")}</div>`) : ""}
    ${customLines ? detailGroup("自訂欄位", customLines) : ""}
    ${person.note ? detailGroup("其它備註", `<p>${escapeHtml(person.note).replaceAll("\n", "<br>")}</p>`) : ""}
    ${hasDetailContent ? "" : `<section class="panel blank-detail-card"></section>`}
    <div class="actions detail-actions">
      <button data-action="edit-person" data-id="${person.id}">編輯人物</button>
      <button class="danger" data-action="delete-person" data-id="${person.id}">刪除人物</button>
    </div>
  `;
}

function settingsView() {
  const gd = state.appState.googleDrive;
  const authStatus = driveAuthStatus();
  const pendingConflicts = gd.pendingConflicts ?? [];
  const syncStatusText = gd.connected
    ? syncStatusLabel(gd)
    : "尚未啟用";
  return `
    <header class="topbar">
      <h1 class="title">設定</h1>
    </header>
    <section class="panel stack">
      <h2 class="section-title">Google Drive 同步</h2>
      <p>狀態：${syncStatusText}</p>
      <p class="muted">同步模式：${driveProviderLabel()}</p>
      ${authStatus.hasAccessToken ? `<p class="muted">Google 授權：已取得暫時授權</p>` : ""}
      ${authStatus.expiresAt ? `<p class="muted">授權到期：約 ${formatDateTime(authStatus.expiresAt)}</p>` : ""}
      ${gd.connected && !authStatus.hasAccessToken ? `<p class="muted">提醒：若剛重新開啟瀏覽器，首次同步時可能需要重新向 Google 確認授權。</p>` : ""}
      ${gd.lastSyncAt ? `<p class="muted">上次同步：${formatDateTime(gd.lastSyncAt)}</p>` : ""}
      ${gd.lastSyncError ? `<p class="danger-text">${escapeHtml(gd.lastSyncError)}</p>` : ""}
      ${pendingConflicts.length ? `<button data-nav="syncConflicts">處理衝突資料</button>` : ""}
      <button class="secondary" data-nav="driveDiagnostics">Google Drive 連線診斷</button>
      ${gd.connected ? `<button class="secondary" data-action="sync-now" ${gd.syncStatus === "syncing" ? "disabled" : ""}>立即同步</button><button class="secondary" data-action="drive-logout">登出 Google Drive</button>` : `<button data-action="drive-placeholder">連結 Google Drive</button>`}
    </section>
    ${gd.connected ? `<section class="panel stack"><h2 class="section-title">安全性</h2><button class="secondary" data-nav="changePassword">更改密碼</button><button class="secondary" data-nav="forgotPassword">忘記密碼</button><button class="secondary" data-nav="regenerateRecovery">重新產生救援碼</button><button class="danger" data-nav="logoutAllDevices">登出所有裝置</button></section>` : ""}
    <section class="panel stack">
      <h2 class="section-title">資料管理</h2>
      <button class="secondary" data-nav="deleted">最近刪除</button>
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
      <button class="secondary" data-nav="driveDeveloperGuide">Google Drive 開發設定說明</button>
    </section>
    ${bottomNav("settings")}
  `;
}

function driveDeveloperGuideView() {
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-nav="settings">返回</button>
      <h1 class="section-title">Google Drive 開發設定</h1>
      <span></span>
    </header>
    <section class="panel stack">
      <h2 class="section-title">目前狀態</h2>
      <p>同步模式：${driveProviderLabel()}</p>
      <p class="muted">目前 App 預設使用本機模擬同步；正式串接 Google Drive 前，現有資料加密、同步合併與衝突處理流程都可以先繼續測試。</p>
    </section>
    <section class="panel stack">
      <h2 class="section-title">正式串接前需要準備</h2>
      <ol class="guide-list">
        <li>建立 Google Cloud 專案。</li>
        <li>啟用 Google Drive API。</li>
        <li>建立 OAuth Client ID，類型選擇 Web application。</li>
        <li>把本機測試網址與未來 GitHub Pages 網址加入 Authorized JavaScript origins。</li>
        <li>在 src/runtime-config.js 填入 OAuth Client ID。</li>
        <li>在 src/runtime-config.js 將同步模式從 mock 切換為 google。</li>
      </ol>
    </section>
    <section class="panel stack">
      <h2 class="section-title">目前設定值</h2>
      <p>driveProvider：${escapeHtml(APP_CONFIG.driveProvider)}</p>
      <p>appFolderName：${escapeHtml(APP_CONFIG.googleDrive.appFolderName)}</p>
      <p>keyPackage 檔名：${escapeHtml(driveFileName("keyPackage"))}</p>
      <p>vault 檔名：${escapeHtml(driveFileName("vault"))}</p>
      <p class="muted">Client ID 不在畫面中顯示，避免誤貼或截圖外流。OAuth Client ID 是前端公開設定，不應加入 client secret。</p>
    </section>
    <section class="panel stack">
      <h2 class="section-title">GitHub Pages 提醒</h2>
      <p class="muted">未來部署後，Google OAuth 的授權來源需要加入正式網址，例如 https://你的帳號.github.io。若使用專案頁，也要確認 PWA 路徑與 Service Worker 範圍。</p>
    </section>
  `;
}

function driveDiagnosticsView() {
  const result = state.route.result;
  const running = Boolean(state.route.running);
  const environment = oauthEnvironmentInfo();
  return `
    <header class="topbar topbar-centered">
      <button class="secondary" data-nav="settings">返回</button>
      <h1 class="section-title">Google Drive 連線診斷</h1>
      <span></span>
    </header>
    <section class="panel stack">
      <h2 class="section-title">目前狀態</h2>
      <p>同步模式：${driveProviderLabel()}</p>
      <p>Client ID：${escapeHtml(maskClientId(APP_CONFIG.googleDrive.clientId))}</p>
      <p>目前來源：<code>${escapeHtml(environment.origin)}</code></p>
      <p class="muted">Google Cloud Console 的 Authorized JavaScript origins 需要加入目前來源。</p>
      <p class="muted">此測試會建立一個暫時診斷檔，讀回確認後立刻刪除；不會修改正式資料檔。</p>
      <button type="button" data-action="run-drive-diagnostics" ${running ? "disabled" : ""}>${running ? "測試中…" : "開始連線診斷"}</button>
    </section>
    <section class="panel stack">
      <h2 class="section-title">本機 OAuth 測試設定</h2>
      <p class="muted">這裡只會把 Client ID 存在目前瀏覽器，用於本機測試；不會寫入專案檔案。</p>
      <div class="field">
        <label>OAuth Client ID</label>
        <input data-route-field="oauthClientId" placeholder="xxxxx.apps.googleusercontent.com" value="${escapeAttr(state.route.oauthClientId ?? APP_CONFIG.googleDrive.clientId ?? "")}" />
      </div>
      <div class="actions">
        <button type="button" data-action="apply-local-google-config">套用 Google 模式並重新載入</button>
        <button type="button" class="secondary" data-action="clear-local-google-config">清除本機 OAuth 設定</button>
      </div>
    </section>
    <section class="panel stack">
      <h2 class="section-title">OAuth 設定檢查清單</h2>
      ${oauthChecklist(environment).map(checklistItem).join("")}
    </section>
    ${
      result
        ? `<section class="panel stack ${result.ok ? "diagnostic-success" : "diagnostic-error"}">
            <h2 class="section-title">${result.ok ? "診斷通過" : "診斷失敗"}</h2>
            <p>${escapeHtml(result.message)}</p>
            ${result.fileName ? `<p class="muted">測試檔：${escapeHtml(result.fileName)}</p>` : ""}
          </section>`
        : ""
    }
  `;
}

function checklistItem(item) {
  return `
    <div class="checklist-item ${item.ok ? "ok" : "warn"}">
      <span>${item.ok ? "✓" : "!"}</span>
      <span>${escapeHtml(item.text)}</span>
    </div>
  `;
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
  return `
    <header class="topbar">
      <button class="secondary" data-action="cancel-drive-setup">返回</button>
      <h1 class="section-title">連結 Google Drive</h1>
      <span></span>
    </header>
    <section class="panel stack">
      <p>連結 Google Drive 後，勿忘我會先在本機建立加密用的資料金鑰，並用你的密碼與救援碼分別保護它。</p>
      <p class="muted">目前同步模式：${driveProviderLabel()}。未來接上 Google OAuth 後，會沿用同一套加密與同步流程。</p>
      <button data-nav="setupMasterPassword">開始設定密碼</button>
    </section>
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
    <form class="panel stack" data-form="${form}">
      ${intro ? `<p class="muted">${intro}</p>` : ""}
      ${fields
        .map(
          ([name, label, autocomplete]) => `
            <div class="field">
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
        <button type="button" class="secondary" data-action="toggle-interest-manage">新增/移除興趣喜好</button>
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
  const draft = state.route.customFieldDraft ?? { name: "", type: "text", scope: "person" };
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
        </select>
      </div>
      <div class="field">
        <label>使用範圍</label>
        <select data-custom-draft="scope">
          <option value="global" ${draft.scope === "global" ? "selected" : ""}>所有人物</option>
          <option value="person" ${draft.scope === "person" ? "selected" : ""}>僅此人物</option>
        </select>
      </div>
      <div class="actions">
        <button type="button" data-action="confirm-add-custom-field">確認</button>
        <button type="button" class="secondary" data-action="cancel-custom-field-add">取消</button>
      </div>
    </div>
  `;
}

function customFieldInput(field, person, editing) {
  const current = person.customValues.find((item) => item.fieldId === field.id)?.value ?? "";
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
    <div class="inline-actions">
      ${
        canEditInline
          ? `<input data-route-field="editingCustomFieldName" value="${escapeAttr(state.route.editingCustomFieldName ?? field.name)}" /><button type="button" data-action="confirm-rename-custom-field" data-id="${field.id}">確認改名</button><button type="button" class="secondary" data-action="cancel-rename-custom-field">取消</button>`
          : `<button type="button" class="secondary" data-action="start-rename-custom-field" data-id="${field.id}">變更欄位名稱</button><button type="button" class="danger" data-action="delete-custom-field" data-id="${field.id}">刪除</button>`
      }
    </div>
  `;
}

function detailGroup(title, content) {
  if (!content) return "";
  return `<section class="panel section"><h2 class="section-title">${title}</h2>${content}</section>`;
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
    el.addEventListener("click", () => navigate({ name: el.dataset.nav, id: el.dataset.id }));
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
      state.route.customFieldDraft ??= { name: "", type: "text", scope: "person" };
      state.route.customFieldDraft[el.dataset.customDraft] = el.value;
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
    el.addEventListener("input", () => {
      const params = state.route.params ?? { text: "", address: "", tagIds: [] };
      params[el.dataset.search] = el.value;
      state.route.params = params;
    });
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
  if (action === "drive-placeholder") return beginDriveSetup();
  if (action === "cancel-drive-setup") return cancelDriveSetup();
  if (action === "confirm-recovery-saved") return finishRecoveryCode();
  if (action === "sync-now") return syncNow();
  if (action === "run-drive-diagnostics") return runDriveDiagnostics();
  if (action === "apply-local-google-config") return applyLocalGoogleConfig();
  if (action === "clear-local-google-config") return clearLocalGoogleConfig();
  if (action === "resolve-sync-conflict") return resolveSyncConflict(Number(el.dataset.index), el.dataset.source);
  if (action === "drive-logout") return logoutGoogleDrive();
  if (action === "export-data") return exportData();
  if (action === "export-excel") return exportExcel();
  if (action === "choose-import-file") return app.querySelector("[data-import-file]")?.click();
  if (action === "open-detail") return navigate(detailRoute(el.dataset.id));
  if (action === "detail-back") return navigateBackFromDetail();
  if (action === "cancel-form") return navigate(state.route.id ? detailRoute(state.route.id) : { name: "home" });
  if (action === "edit-person") return navigate({ name: "edit", id: el.dataset.id, returnTo: state.route.returnTo });
  if (action === "delete-person") return deletePerson(el.dataset.id);
  if (action === "restore-person") return restorePerson(el.dataset.id);
  if (action === "purge-person") return purgePerson(el.dataset.id);
  if (action === "add-list-item") return addListItem(el.dataset.listKey);
  if (action === "remove-list-item") return removeListItem(el.dataset.listKey, Number(el.dataset.index));
  if (action === "set-default") return setDefault(el.dataset.listKey, Number(el.dataset.index));
  if (action === "toggle-interest") return toggleInterest(el.dataset.id);
  if (action === "search-tag") return toggleSearchTag(el.dataset.id);
  if (action === "toggle-interest-manage") return toggleInterestManage();
  if (action === "confirm-add-interest") return addInterest();
  if (action === "cancel-interest-manage") return cancelInterestManage();
  if (action === "remove-interest") return removeInterest(el.dataset.id);
  if (action === "restore-default-interests") return restoreDefaultInterests();
  if (action === "toggle-custom-field-add") return toggleCustomFieldAdd();
  if (action === "toggle-custom-field-edit") return toggleCustomFieldEdit();
  if (action === "confirm-add-custom-field") return addCustomField();
  if (action === "cancel-custom-field-add") return cancelCustomFieldAdd();
  if (action === "start-rename-custom-field") return startRenameCustomField(el.dataset.id);
  if (action === "confirm-rename-custom-field") return confirmRenameCustomField(el.dataset.id);
  if (action === "cancel-rename-custom-field") return cancelRenameCustomField();
  if (action === "delete-custom-field") return deleteCustomFieldById(el.dataset.id);
  if (action === "apply-search") return render();
  if (action === "clear-search") return navigate({ name: "search", params: { text: "", address: "", tagIds: [] } });
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

function toggleInterest(id) {
  const selected = state.route.draft.interestTagIds;
  state.route.draft.interestTagIds = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
  render();
}

function toggleSearchTag(id) {
  const params = state.route.params ?? { text: "", address: "", tagIds: [] };
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
  state.route.customFieldDraft ??= { name: "", type: "text", scope: "person" };
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
  state.route.customFieldDraft = { name: "", type: "text", scope: "person" };
  render();
}

async function addCustomField() {
  const draft = state.route.customFieldDraft ?? { name: "", type: "text", scope: "person" };
  const cleanName = draft.name.trim();
  if (!cleanName) {
    alert("欄位名稱不可空白");
    return;
  }
  const type = draft.type;
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
    scope,
    personId,
    createdAt: now,
    updatedAt: now,
    updatedByDeviceId: state.appState.deviceId
  };
  state.route.customFieldDraft = { name: "", type: "text", scope: "person" };
  state.route.customFieldAdd = false;
  await commitVault({ ...state.vault, customFieldDefs: [...state.vault.customFieldDefs, field] });
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
      syncStatus: conflicts.length ? "needsResolution" : "synced",
      pendingConflicts: conflicts,
      lastSyncAt: new Date().toISOString()
    }
  };
  await save();
  render();
}

function buildDataHealthReport() {
  const issues = [];
  const tagIds = new Set(state.vault.interestTags.map((tag) => tag.id));
  const fieldIds = new Set(state.vault.customFieldDefs.map((field) => field.id));
  const personNames = countBy(state.vault.people, (person) => person.name.trim());
  const nationalIds = countBy(state.vault.people, (person) => person.nationalId.trim());
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
        personIds: state.vault.people.filter((person) => person.name.trim() === name).map((person) => person.id)
      });
    });

  Object.entries(nationalIds)
    .filter(([, count]) => count > 1)
    .forEach(([nationalId, count]) => {
      issues.push({
        title: "身分證字號重複",
        detail: `「${nationalId}」出現 ${count} 次，請確認是否有重複人物資料。`,
        personIds: state.vault.people.filter((person) => person.nationalId.trim() === nationalId).map((person) => person.id)
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

  state.vault.people.forEach((person) => {
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
  const text = params.text.trim().toLowerCase();
  const address = params.address.trim().toLowerCase();
  const tagIds = params.tagIds;
  const matched = state.vault.people.filter((person) => {
    const textMatch =
      !text ||
      [person.name, person.note, ...person.customValues.map((value) => String(value.value))]
        .join(" ")
        .toLowerCase()
        .includes(text);
    const addressMatch = !address || person.addresses.some((item) => item.value.toLowerCase().includes(address));
    const tagMatch = tagIds.every((id) => person.interestTagIds.includes(id));
    return textMatch && addressMatch && tagMatch;
  });
  return matched.sort((a, b) => {
    const aName = text && a.name.toLowerCase().includes(text);
    const bName = text && b.name.toLowerCase().includes(text);
    if (aName !== bName) return aName ? -1 : 1;
    return sortPeople([a, b])[0].id === a.id ? -1 : 1;
  });
}

function hasSearchCriteria(params) {
  return Boolean(params.text.trim() || params.address.trim() || params.tagIds.length);
}

function customDefsForPerson(personId) {
  return state.vault.customFieldDefs.filter((field) => field.scope === "global" || field.personId === personId);
}

function formatCustomValue(field, value) {
  if (field.type === "date" && value) return String(value).replaceAll("-", "/");
  return String(value);
}

function syncStatusLabel(gd) {
  if (gd.syncStatus === "needsResolution") return "資料衝突需要處理";
  if (gd.syncStatus === "syncing") return "同步中…";
  if (gd.syncStatus === "error") return "同步失敗";
  return gd.simulated ? `已同步（${driveProviderLabel()}）` : "已同步";
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

function oauthEnvironmentInfo() {
  const { origin, protocol, hostname, pathname } = window.location;
  const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  const isHttps = protocol === "https:";
  const isGithubPages = hostname.endsWith(".github.io");
  return {
    origin,
    protocol,
    hostname,
    pathname,
    isLocalhost,
    isHttps,
    isGithubPages,
    serviceWorkerScopeHint: new URL("./", window.location.href).href
  };
}

function oauthChecklist(environment) {
  return [
    {
      ok: APP_CONFIG.driveProvider === "google",
      text: APP_CONFIG.driveProvider === "google" ? "同步模式已切換為 google。" : "目前仍是本機模擬模式；正式測試 OAuth 前需在 runtime-config.js 將 driveProvider 改為 google。"
    },
    {
      ok: Boolean(APP_CONFIG.googleDrive.clientId),
      text: APP_CONFIG.googleDrive.clientId ? "已設定 OAuth Client ID。" : "尚未設定 OAuth Client ID。"
    },
    {
      ok: environment.isHttps || environment.isLocalhost,
      text: environment.isHttps || environment.isLocalhost ? "目前網址符合 OAuth 測試基本要求。" : "正式 OAuth 需要 HTTPS；localhost 可作為本機測試例外。"
    },
    {
      ok: true,
      text: `Authorized JavaScript origins 請加入：${environment.origin}`
    },
    {
      ok: true,
      text: `Service Worker 目前作用範圍約為：${environment.serviceWorkerScopeHint}`
    },
    {
      ok: !environment.isGithubPages || environment.pathname !== "/",
      text: environment.isGithubPages ? "GitHub Pages 專案頁請確認 manifest start_url 與 Service Worker 路徑使用相對路徑。" : "若未來部署到 GitHub Pages，請把正式 origin 加入 Google Cloud Console。"
    }
  ];
}

function maskClientId(clientId = "") {
  if (!clientId) return "尚未設定";
  const [prefix, ...rest] = clientId.split(".");
  const maskedPrefix = prefix.length > 10 ? `${prefix.slice(0, 6)}…${prefix.slice(-4)}` : "已設定";
  return `${maskedPrefix}.${rest.join(".")}`;
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
    nationalId: "身分證字號",
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
    customValues: draft.customValues ?? [],
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
