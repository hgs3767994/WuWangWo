import { APP_CONFIG, isGoogleDriveConfigured } from "./config.js";
import { clearNativeGoogleOAuthSession, completeNativeGoogleOAuthLaunch, connectNativeGoogleDrive, isNativeOAuthRuntime, restoreNativeGoogleOAuthSession } from "./native-oauth.js";

const SESSION_STORAGE_KEY = "forget-me-not-oauth-session";
const PERSISTENT_SESSION_MARKER_KEY = "forget-me-not-oauth-session-marker-v1";

export async function writeGoogleDriveFile(name, content) { await execute("write", { name, content }); }
export async function readGoogleDriveFile(name) { return execute("read", { name }); }
export async function removeGoogleDriveFile(name) { await execute("delete", { name }); }
export async function listGoogleDriveFileRevisions(name) { return execute("revisions", { name }); }
export async function readGoogleDriveFileRevision(name, revisionId) { return execute("readRevision", { name, revisionId }); }
export async function listGoogleDriveFiles() { return execute("list"); }

export async function testGoogleDriveConnection() {
  const fileName = `diagnostic-${crypto.randomUUID()}.json`;
  const payload = { fileType: "forget-me-not-drive-diagnostic", createdAt: new Date().toISOString() };
  await writeGoogleDriveFile(fileName, payload);
  const loaded = await readGoogleDriveFile(fileName);
  await removeGoogleDriveFile(fileName);
  return { ok: loaded?.fileType === payload.fileType, fileName };
}

export async function createGoogleRecoveryRequest(values) { return workerApiFetch("/v1/recovery/requests", values); }
export async function listGoogleRecoveryRequests() { return workerApiFetch("/v1/recovery/requests", undefined, "GET"); }
export async function getGoogleRecoveryRequest(requestId) { return workerApiFetch(`/v1/recovery/requests/${encodeURIComponent(requestId)}`, undefined, "GET"); }
export async function approveGoogleRecoveryRequest(requestId, values) { return workerApiFetch(`/v1/recovery/requests/${encodeURIComponent(requestId)}/approve`, values); }
export async function verifyGoogleRecoveryRequest(requestId, values) { return workerApiFetch(`/v1/recovery/requests/${encodeURIComponent(requestId)}/verify`, values); }
export async function completeGoogleRecoveryRequest(requestId, values) { return workerApiFetch(`/v1/recovery/requests/${encodeURIComponent(requestId)}/complete`, values); }

export async function connectGoogleDrive({ interactive = true, popupWindow = null, requirePopup = false, forceReauthorization = false, selectAccount = false } = {}) {
  if (isNativeOAuthRuntime()) {
    // Native authorization is rendered by Google Play services inside the
    // Android app. Close a stale reserved web popup defensively so a caller
    // can never leave an external about:blank tab behind.
    try {
      if (popupWindow && !popupWindow.closed) popupWindow.close();
    } catch {}
    return connectNativeGoogleDrive({ interactive, forceReauthorization, selectAccount });
  }
  const session = forceReauthorization ? null : await completeGoogleOAuthHandoff();
  if (session) return { connected: true, accountEmail: session.accountEmail };
  const existing = readSession();
  if (!forceReauthorization && existing && Date.parse(existing.expiresAt) > Date.now() + 30_000) return { connected: true, accountEmail: existing.accountEmail ?? "" };
  if (!interactive) throw new Error("google-drive-auth-required");
  const returnTo = new URL(location.href);
  returnTo.searchParams.delete("oauth_handoff");
  const startUrl = `${apiUrl()}/v1/oauth/google/start?${new URLSearchParams({ return_to: returnTo.toString(), popup: "1", ...(forceReauthorization ? { reauth: "account-deletion" } : {}) })}`;
  if (popupWindow && !popupWindow.closed) return connectGoogleDriveInPopup(popupWindow, startUrl);
  if (requirePopup) throw new Error("google-drive-popup-blocked");
  // Fallback for browsers that refuse a user-initiated popup.  The normal app
  // path supplies a popup, so this is only retained for compatibility.
  location.replace(`${apiUrl()}/v1/oauth/google/start?${new URLSearchParams({ return_to: returnTo.toString() })}`);
  return new Promise(() => {});
}

export async function deleteGoogleCloudAccount({ deleteDriveData, popupWindow = null, expectedAccountEmail = "" } = {}) {
  const connection = await connectGoogleDrive({ interactive: true, popupWindow, requirePopup: !isNativeOAuthRuntime(), forceReauthorization: true });
  if (expectedAccountEmail && connection.accountEmail && connection.accountEmail.toLowerCase() !== expectedAccountEmail.toLowerCase()) {
    await clearClientSession();
    throw new Error("account-deletion-account-mismatch");
  }
  const result = await workerApiFetch("/v1/account/delete", { confirmation: "DELETE", deleteDriveData: deleteDriveData === true });
  await clearClientSession();
  return result;
}

export async function disconnectGoogleDrive() {
  const session = readSession();
  try {
    if (session) await apiFetch("/v1/oauth/session/revoke", {}, session.sessionToken ?? "");
  } finally {
    await clearClientSession();
  }
}

export function googleDriveAuthStatus() {
  const session = readSession();
  return { hasAccessToken: Boolean(session && Date.parse(session.expiresAt) > Date.now()), expiresAt: session?.expiresAt ?? "", accountEmail: session?.accountEmail ?? "" };
}

export async function restoreGoogleDriveSession() {
  const existing = readSession();
  if (existing && Date.parse(existing.expiresAt) > Date.now() + 30_000) return existing;
  if (!isNativeOAuthRuntime()) return null;
  return restoreNativeGoogleOAuthSession();
}

export function googleDriveReadiness() {
  if (isGoogleDriveConfigured()) return { ready: true, message: "" };
  return { ready: false, message: "尚未設定 Google Drive Worker API 網址，目前仍需使用本機模擬同步。" };
}

export async function completeGoogleOAuthHandoff() {
  const nativeSession = await completeNativeGoogleOAuthLaunch();
  if (nativeSession) return nativeSession;
  const url = new URL(location.href);
  const handoff = url.searchParams.get("oauth_handoff");
  if (!handoff) return null;
  try {
    const session = await exchangeOAuthHandoff(handoff);
    url.searchParams.delete("oauth_handoff");
    history.replaceState(history.state, "", url);
    return session;
  } catch (error) {
    url.searchParams.delete("oauth_handoff");
    history.replaceState(history.state, "", url);
    throw new Error(`google-drive-handoff-failed:${error?.message ?? "unknown"}`);
  }
}

function connectGoogleDriveInPopup(popupWindow, startUrl) {
  const workerOrigin = new URL(apiUrl()).origin;
  return new Promise((resolve, reject) => {
    let settled = false;
    let closeGraceTimer = null;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      window.clearInterval(closeWatcher);
      window.clearTimeout(timeout);
      if (closeGraceTimer) window.clearTimeout(closeGraceTimer);
      callback();
    };
    const onMessage = (event) => {
      if (event.origin !== workerOrigin || event.source !== popupWindow) return;
      const message = event.data;
      if (!message || message.type !== "forget-me-not-oauth-handoff") return;
      if (message.error) return finish(() => reject(new Error(`google-drive-handoff-failed:${message.error}`)));
      if (typeof message.handoff !== "string" || !message.handoff) return finish(() => reject(new Error("google-drive-handoff-failed:handoff-invalid")));
      void exchangeOAuthHandoff(message.handoff).then(
        (session) => finish(() => resolve({ connected: true, accountEmail: session.accountEmail })),
        (error) => finish(() => reject(new Error(`google-drive-handoff-failed:${error?.message ?? "unknown"}`)))
      );
    };
    const closeWatcher = window.setInterval(() => {
      if (!popupWindow.closed || closeGraceTimer) return;
      // postMessage is queued on the opener.  A callback window can therefore
      // be closed before its already-sent message is delivered.  Give that
      // queued handoff a short, deterministic grace period before treating a
      // closed window as a user cancellation.
      closeGraceTimer = window.setTimeout(() => finish(() => reject(new Error("google-drive-authorization-cancelled"))), 1200);
    }, 250);
    const timeout = window.setTimeout(() => finish(() => reject(new Error("google-drive-authorization-timeout"))), 5 * 60 * 1000);
    window.addEventListener("message", onMessage);
    try {
      popupWindow.location.replace(startUrl);
      popupWindow.focus?.();
    } catch (error) {
      finish(() => reject(new Error(`google-drive-popup-failed:${error?.message ?? "unknown"}`)));
    }
  });
}

async function exchangeOAuthHandoff(handoff) {
  const response = await apiFetch("/v1/oauth/google/handoff/exchange", { handoff }, false);
  const profile = await execute("profile", {}, response.sessionToken);
  const session = { sessionToken: response.sessionToken, expiresAt: response.expiresAt, accountEmail: profile?.email ?? "" };
  await storeClientSession(session);
  return session;
}

async function execute(operation, values = {}, overrideToken = "") {
  const session = overrideToken ? { sessionToken: overrideToken } : readSession();
  if (!session?.sessionToken && !session?.cookieSession) throw new Error("google-drive-auth-required");
  const response = await apiFetch("/v1/drive/execute", { operation, ...values }, session.sessionToken ?? "");
  return response.result;
}

async function apiFetch(path, body, sessionToken) {
  if (!isGoogleDriveConfigured()) throw new Error(googleDriveReadiness().message);
  const response = await fetch(`${apiUrl()}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}) },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) await clearClientSession();
    throw new Error(payload.error ?? "google-drive-request-failed");
  }
  return payload;
}

async function workerApiFetch(path, body, method = "POST") {
  const session = readSession();
  if (!session?.sessionToken && !session?.cookieSession) throw new Error("google-drive-auth-required");
  if (!isGoogleDriveConfigured()) throw new Error(googleDriveReadiness().message);
  const response = await fetch(`${apiUrl()}${path}`, {
    method,
    credentials: "include",
    headers: { "content-type": "application/json", ...(session.sessionToken ? { Authorization: `Bearer ${session.sessionToken}` } : {}) },
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) await clearClientSession();
    throw new Error(payload.error ?? "recovery-request-failed");
  }
  return payload;
}

function apiUrl() { return String(APP_CONFIG.googleDrive.oauthApiUrl).replace(/\/$/, ""); }
function readSession() {
  const active = parseStoredSession(sessionStorage, SESSION_STORAGE_KEY);
  if (active && Date.parse(active.expiresAt ?? "") > Date.now()) return active;
  if (active) sessionStorage.removeItem(SESSION_STORAGE_KEY);
  if (isNativeOAuthRuntime()) return null;
  const marker = parseStoredSession(localStorage, PERSISTENT_SESSION_MARKER_KEY);
  if (marker?.cookieSession && Date.parse(marker.expiresAt ?? "") > Date.now()) return marker;
  if (marker) localStorage.removeItem(PERSISTENT_SESSION_MARKER_KEY);
  return null;
}

async function storeClientSession(session) {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  if (isNativeOAuthRuntime()) return;
  localStorage.setItem(PERSISTENT_SESSION_MARKER_KEY, JSON.stringify({
    cookieSession: true,
    expiresAt: session.expiresAt,
    accountEmail: session.accountEmail ?? ""
  }));
}

async function clearClientSession() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  localStorage.removeItem(PERSISTENT_SESSION_MARKER_KEY);
  await clearNativeGoogleOAuthSession();
}

function parseStoredSession(storage, key) {
  try { return JSON.parse(storage.getItem(key) ?? "null"); } catch { return null; }
}
