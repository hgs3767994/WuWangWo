import { APP_CONFIG, isGoogleDriveConfigured } from "./config.js";
import { clearNativeGoogleOAuthSession, completeNativeGoogleOAuthLaunch, connectNativeGoogleDrive, isNativeOAuthRuntime, persistNativeGoogleOAuthSession, restoreNativeGoogleOAuthSession } from "./native-oauth.js";

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
  const requireFreshAuthorization = forceReauthorization || selectAccount;
  const session = requireFreshAuthorization ? null : await completeGoogleOAuthHandoff();
  if (session) return { connected: true, accountEmail: session.accountEmail };
  const existing = readSession();
  if (!requireFreshAuthorization && existing && Date.parse(existing.expiresAt) > Date.now() + 30_000) return { connected: true, accountEmail: existing.accountEmail ?? "" };
  if (!interactive) throw new Error("google-drive-auth-required");
  const returnTo = new URL(location.href);
  returnTo.searchParams.delete("oauth_handoff");
  const reauthorization = forceReauthorization ? "account-deletion" : selectAccount ? "account-selection" : "";
  const startParameters = { return_to: returnTo.toString(), ...(reauthorization ? { reauth: reauthorization } : {}) };
  const startUrl = `${apiUrl()}/v1/oauth/google/start?${new URLSearchParams({ ...startParameters, popup: "1" })}`;
  if (popupWindow && !popupWindow.closed) return connectGoogleDriveInPopup(popupWindow, startUrl);
  if (requirePopup) throw new Error("google-drive-popup-blocked");
  // Fallback for browsers that refuse a user-initiated popup.  The normal app
  // path supplies a popup, so this is only retained for compatibility.
  location.replace(`${apiUrl()}/v1/oauth/google/start?${new URLSearchParams(startParameters)}`);
  return new Promise(() => {});
}

export async function deleteGoogleCloudAccount({ popupWindow = null, expectedAccountEmail = "" } = {}) {
  const connection = await connectGoogleDrive({ interactive: true, popupWindow, requirePopup: !isNativeOAuthRuntime(), forceReauthorization: true });
  if (expectedAccountEmail && connection.accountEmail && connection.accountEmail.toLowerCase() !== expectedAccountEmail.toLowerCase()) {
    await clearClientSession();
    throw new Error("account-deletion-account-mismatch");
  }
  const result = await workerApiFetch("/v1/account/delete", { confirmation: "DELETE", deleteDriveData: true });
  await clearClientSession();
  return result;
}

export async function disconnectGoogleDrive() {
  const session = readSession();
  try {
    if (session) await apiFetch("/v1/oauth/session/revoke", {}, session);
  } finally {
    await clearClientSession();
  }
}

export function googleDriveAuthStatus() {
  const session = readSession();
  return { hasAccessToken: Boolean(session && Date.parse(session.expiresAt) > Date.now()), expiresAt: session?.expiresAt ?? "", accountEmail: session?.accountEmail ?? "" };
}

export async function restoreGoogleDriveSession() {
  let existing = readSession();
  if (!existing && isNativeOAuthRuntime()) existing = await restoreNativeGoogleOAuthSession();
  if (!existing || !hasFreshRenewal(existing)) return null;
  const refreshed = await apiFetch("/v1/oauth/session/refresh", {}, existing);
  if (!refreshed?.expiresAt || !refreshed?.renewalExpiresAt || (!refreshed.sessionToken && !existing.cookieSession)) throw new Error("session-refresh-failed");
  const nextSession = {
    ...(refreshed.sessionToken ? { sessionToken: refreshed.sessionToken } : { cookieSession: true }),
    expiresAt: refreshed.expiresAt,
    ...(refreshed.renewalToken ? { renewalToken: refreshed.renewalToken } : {}),
    renewalExpiresAt: refreshed.renewalExpiresAt,
    accountEmail: existing.accountEmail ?? ""
  };
  await storeClientSession(nextSession);
  return nextSession;
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
  const response = await apiFetch("/v1/oauth/google/handoff/exchange", { handoff });
  const profile = await execute("profile", {}, response.sessionToken);
  const session = {
    sessionToken: response.sessionToken,
    cookieSession: true,
    expiresAt: response.expiresAt,
    renewalExpiresAt: response.renewalExpiresAt,
    accountEmail: profile?.email ?? ""
  };
  await storeClientSession(session);
  return session;
}

async function execute(operation, values = {}, overrideToken = "") {
  const session = overrideToken ? { sessionToken: overrideToken, expiresAt: new Date(Date.now() + 60_000).toISOString() } : await ensureAccessSession();
  const response = await apiFetch("/v1/drive/execute", { operation, ...values }, session);
  return response.result;
}

async function apiFetch(path, body, session = {}) {
  if (!isGoogleDriveConfigured()) throw new Error(googleDriveReadiness().message);
  const response = await fetch(`${apiUrl()}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(session.sessionToken ? { Authorization: `Bearer ${session.sessionToken}` } : {}),
      ...(session.renewalToken ? { "X-Device-Renewal": session.renewalToken } : {})
    },
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
  const session = await ensureAccessSession();
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
  if (active && (hasFreshAccess(active) || hasFreshRenewal(active))) return active;
  if (active) sessionStorage.removeItem(SESSION_STORAGE_KEY);
  if (isNativeOAuthRuntime()) return null;
  const marker = parseStoredSession(localStorage, PERSISTENT_SESSION_MARKER_KEY);
  if (marker?.cookieSession && hasFreshRenewal(marker)) return marker;
  if (marker) localStorage.removeItem(PERSISTENT_SESSION_MARKER_KEY);
  return null;
}

async function storeClientSession(session) {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  if (isNativeOAuthRuntime()) {
    await persistNativeGoogleOAuthSession(session);
    return;
  }
  localStorage.setItem(PERSISTENT_SESSION_MARKER_KEY, JSON.stringify({
    cookieSession: true,
    expiresAt: session.expiresAt,
    renewalExpiresAt: session.renewalExpiresAt,
    accountEmail: session.accountEmail ?? ""
  }));
}

async function ensureAccessSession() {
  let session = readSession();
  if (!session && isNativeOAuthRuntime()) session = await restoreNativeGoogleOAuthSession();
  if (session && hasFreshAccess(session) && (session.sessionToken || session.cookieSession)) return session;
  if (session && hasFreshRenewal(session)) {
    const refreshed = await restoreGoogleDriveSession();
    if (refreshed && hasFreshAccess(refreshed)) return refreshed;
  }
  throw new Error("google-drive-auth-required");
}

function hasFreshAccess(session) {
  return Date.parse(session?.expiresAt ?? "") > Date.now() + 30_000;
}

function hasFreshRenewal(session) {
  return Date.parse(session?.renewalExpiresAt ?? "") > Date.now() + 30_000;
}

async function clearClientSession() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  localStorage.removeItem(PERSISTENT_SESSION_MARKER_KEY);
  await clearNativeGoogleOAuthSession();
}

function parseStoredSession(storage, key) {
  try { return JSON.parse(storage.getItem(key) ?? "null"); } catch { return null; }
}
