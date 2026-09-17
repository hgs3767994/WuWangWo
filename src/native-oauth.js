import { APP_CONFIG, isGoogleDriveConfigured } from "./config.js";

const SESSION_STORAGE_KEY = "forget-me-not-oauth-session";

function sessionPlugin() {
  const capacitor = globalThis.Capacitor;
  if (!capacitor?.isNativePlatform?.()) return null;
  return capacitor.Plugins?.OAuthSession ?? null;
}

export function isNativeOAuthRuntime() {
  const plugins = globalThis.Capacitor?.Plugins;
  return Boolean(globalThis.Capacitor?.isNativePlatform?.() && plugins?.GoogleDriveAuthorization?.authorize);
}

export function nativeOAuthReadiness() {
  if (!isNativeOAuthRuntime()) return { ready: false, message: "目前不是原生 App 執行環境。" };
  const serverClientId = String(APP_CONFIG.googleDrive?.nativeServerClientId ?? "").trim();
  if (!serverClientId.endsWith(".apps.googleusercontent.com")) {
    return { ready: false, message: "原生 Google Drive 尚未設定 Google Web server client ID。" };
  }
  return { ready: true, serverClientId };
}

export async function connectNativeGoogleDrive({ interactive = true } = {}) {
  const existing = readSession() ?? await restoreNativeGoogleOAuthSession();
  if (existing && Date.parse(existing.expiresAt) > Date.now() + 30_000) {
    return { connected: true, accountEmail: existing.accountEmail ?? "" };
  }
  if (!interactive) throw new Error("google-drive-auth-required");
  const readiness = nativeOAuthReadiness();
  if (!readiness.ready) throw new Error("native-oauth-not-configured");
  if (!isGoogleDriveConfigured()) throw new Error("native-oauth-worker-not-configured");

  let authorization;
  try {
    authorization = await globalThis.Capacitor.Plugins.GoogleDriveAuthorization.authorize({
      serverClientId: readiness.serverClientId
    });
  } catch (error) {
    const message = String(error?.message ?? error ?? "unknown");
    if (message.includes("cancel")) throw new Error("google-drive-authorization-cancelled");
    throw new Error(`native-oauth-authorization-failed:${message}`);
  }

  const serverAuthCode = String(authorization?.serverAuthCode ?? "").trim();
  if (!serverAuthCode) throw new Error("native-oauth-authorization-code-missing");
  const response = await fetch(`${apiUrl()}/v1/oauth/google/native/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ server_auth_code: serverAuthCode })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.sessionToken) {
    throw new Error(`native-oauth-exchange-failed:${payload?.error ?? "unknown"}`);
  }
  const session = {
    sessionToken: payload.sessionToken,
    expiresAt: payload.expiresAt,
    accountEmail: payload.accountEmail ?? ""
  };
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  await storeNativeGoogleOAuthSession(session);
  return { connected: true, accountEmail: session.accountEmail };
}

export async function restoreNativeGoogleOAuthSession() {
  const bridge = sessionPlugin();
  if (!bridge?.load) return null;
  try {
    const session = await bridge.load();
    if (!session?.sessionToken || Date.parse(session.expiresAt ?? "") <= Date.now() + 30_000) {
      await clearNativeGoogleOAuthSession();
      return null;
    }
    const restored = {
      sessionToken: String(session.sessionToken),
      expiresAt: String(session.expiresAt),
      accountEmail: String(session.accountEmail ?? "")
    };
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(restored));
    return restored;
  } catch (error) {
    console.warn("無法還原原生 Google Drive 短效 session", error);
    return null;
  }
}

export async function clearNativeGoogleOAuthSession() {
  const bridge = sessionPlugin();
  if (!bridge?.clear) return;
  try { await bridge.clear(); } catch (error) { console.warn("無法清除原生 Google Drive 短效 session", error); }
}

// AuthorizationClient returns directly to the Android activity; there is no
// browser deep-link launch to consume during WebView startup.
export async function completeNativeGoogleOAuthLaunch() {
  return null;
}

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? "null"); } catch { return null; }
}

async function storeNativeGoogleOAuthSession(session) {
  const bridge = sessionPlugin();
  if (!bridge?.store) return;
  try {
    await bridge.store(session);
  } catch (error) {
    // The current in-memory session remains usable even if secure persistence
    // is temporarily unavailable; the next launch will simply authorize again.
    console.warn("無法保存原生 Google Drive 短效 session", error);
  }
}

function apiUrl() {
  return String(APP_CONFIG.googleDrive.oauthApiUrl).replace(/\/$/, "");
}
