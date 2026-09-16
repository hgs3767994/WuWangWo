import { APP_CONFIG, isGoogleDriveConfigured } from "./config.js";

const SESSION_STORAGE_KEY = "forget-me-not-oauth-session";

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
  const existing = readSession();
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
  return { connected: true, accountEmail: session.accountEmail };
}

// AuthorizationClient returns directly to the Android activity; there is no
// browser deep-link launch to consume during WebView startup.
export async function completeNativeGoogleOAuthLaunch() {
  return null;
}

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? "null"); } catch { return null; }
}

function apiUrl() {
  return String(APP_CONFIG.googleDrive.oauthApiUrl).replace(/\/$/, "");
}
