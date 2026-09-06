import { APP_CONFIG, isGoogleDriveConfigured } from "./config.js";

const SESSION_STORAGE_KEY = "forget-me-not-oauth-session";
const NATIVE_PENDING_KEY = "forget-me-not-native-oauth-pending";
const NATIVE_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

export function isNativeOAuthRuntime() {
  const plugins = globalThis.Capacitor?.Plugins;
  return Boolean(globalThis.Capacitor?.isNativePlatform?.() && plugins?.Browser?.open && plugins?.App?.addListener);
}

export function nativeOAuthReadiness() {
  if (!isNativeOAuthRuntime()) return { ready: false, message: "目前不是原生 App 執行環境。" };
  const callbackUrl = String(APP_CONFIG.googleDrive?.nativeOAuthCallbackUrl ?? "").trim();
  if (!callbackUrl || !isHttpsUrl(callbackUrl)) return { ready: false, message: "原生 Google Drive 尚待設定正式 HTTPS 網域與 App Link，暫時不會使用 WebView 授權。" };
  return { ready: true, callbackUrl };
}

export async function connectNativeGoogleDrive({ interactive = true } = {}) {
  const existing = readSession();
  if (existing && Date.parse(existing.expiresAt) > Date.now() + 30_000) return { connected: true, accountEmail: existing.accountEmail ?? "" };
  if (!interactive) throw new Error("google-drive-auth-required");
  const readiness = nativeOAuthReadiness();
  if (!readiness.ready) throw new Error("native-oauth-not-configured");
  if (!isGoogleDriveConfigured()) throw new Error("native-oauth-worker-not-configured");

  const verifier = randomVerifier();
  const challenge = await pkceChallenge(verifier);
  rememberPending({ verifier, callbackUrl: readiness.callbackUrl });
  const startUrl = new URL(`${apiUrl()}/v1/oauth/google/native/start`);
  startUrl.searchParams.set("code_challenge", challenge);
  return waitForNativeCallback({ startUrl: startUrl.toString(), callbackUrl: readiness.callbackUrl, verifier });
}

export async function completeNativeGoogleOAuthLaunch() {
  if (!isNativeOAuthRuntime()) return null;
  const nativeApp = globalThis.Capacitor.Plugins.App;
  const launch = await nativeApp.getLaunchUrl?.();
  if (!launch?.url) return null;
  return completeNativeCallback(launch.url, pendingNativeOAuth());
}

function waitForNativeCallback({ startUrl, callbackUrl, verifier }) {
  const { App: nativeApp, Browser: nativeBrowser } = globalThis.Capacitor.Plugins;
  return new Promise(async (resolve, reject) => {
    let settled = false;
    let closeGraceTimer = null;
    let timeout = null;
    const remove = async (handle) => { try { await handle?.remove?.(); } catch {} };
    let appHandle;
    let browserHandle;
    const finish = async (callback) => {
      if (settled) return;
      settled = true;
      if (timeout) window.clearTimeout(timeout);
      if (closeGraceTimer) window.clearTimeout(closeGraceTimer);
      await Promise.all([remove(appHandle), remove(browserHandle)]);
      callback();
    };
    const onUrl = (event) => {
      void completeNativeCallback(event?.url, { verifier, callbackUrl }).then(
        (session) => { if (session) void finish(() => resolve({ connected: true, accountEmail: session.accountEmail ?? "" })); },
        (error) => void finish(() => reject(error))
      );
    };
    try {
      appHandle = await nativeApp.addListener("appUrlOpen", onUrl);
      browserHandle = await nativeBrowser.addListener("browserFinished", () => {
        if (closeGraceTimer) return;
        closeGraceTimer = window.setTimeout(() => void finish(() => reject(new Error("google-drive-authorization-cancelled"))), 1200);
      });
      await nativeBrowser.open({ url: startUrl });
    } catch (error) {
      await finish(() => reject(new Error(`native-oauth-browser-failed:${error?.message ?? "unknown"}`)));
      return;
    }
    timeout = window.setTimeout(() => void finish(() => reject(new Error("google-drive-authorization-timeout"))), NATIVE_OAUTH_TIMEOUT_MS);
  });
}

async function completeNativeCallback(value, pending) {
  if (!pending?.verifier || !pending?.callbackUrl || !value) return null;
  const callback = new URL(value);
  const expected = new URL(pending.callbackUrl);
  if (callback.origin !== expected.origin || callback.pathname !== expected.pathname) return null;
  forgetPending();
  if (callback.searchParams.get("error")) throw new Error(`google-drive-authorization-failed:${callback.searchParams.get("error")}`);
  const code = callback.searchParams.get("code");
  const state = callback.searchParams.get("state");
  if (!code || !state) throw new Error("native-oauth-callback-invalid");
  const response = await fetch(`${apiUrl()}/v1/oauth/google/native/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, state, code_verifier: pending.verifier })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.sessionToken) throw new Error(`native-oauth-exchange-failed:${payload?.error ?? "unknown"}`);
  const session = { sessionToken: payload.sessionToken, expiresAt: payload.expiresAt, accountEmail: payload.accountEmail ?? "" };
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  try { await globalThis.Capacitor.Plugins.Browser.close(); } catch {}
  return session;
}

function rememberPending(value) { sessionStorage.setItem(NATIVE_PENDING_KEY, JSON.stringify({ ...value, startedAt: Date.now() })); }
function pendingNativeOAuth() { try { const value = JSON.parse(sessionStorage.getItem(NATIVE_PENDING_KEY) ?? "null"); return value?.startedAt > Date.now() - NATIVE_OAUTH_TIMEOUT_MS ? value : null; } catch { return null; } }
function forgetPending() { sessionStorage.removeItem(NATIVE_PENDING_KEY); }
function readSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? "null"); } catch { return null; } }
function apiUrl() { return String(APP_CONFIG.googleDrive.oauthApiUrl).replace(/\/$/, ""); }
function isHttpsUrl(value) { try { return new URL(value).protocol === "https:"; } catch { return false; } }
function randomVerifier() { const bytes = crypto.getRandomValues(new Uint8Array(48)); return base64Url(bytes); }
async function pkceChallenge(verifier) { return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))); }
function base64Url(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
