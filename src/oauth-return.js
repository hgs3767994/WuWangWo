import { APP_CONFIG, isGoogleDriveConfigured } from "./config.js";

const PERSISTENT_SESSION_MARKER_KEY = "forget-me-not-oauth-session-marker-v1";
const OAUTH_POPUP_COMPLETION_KEY = "forget-me-not-oauth-popup-completion";
const OAUTH_POPUP_COMPLETION_LIFETIME_MS = 10 * 60 * 1000;
const statusElement = document.querySelector("#oauth-return-status");

void completePopupFallback();

async function completePopupFallback() {
  const url = new URL(location.href);
  const handoff = url.searchParams.get("oauth_handoff") ?? "";
  const purpose = url.searchParams.get("oauth_purpose") ?? "drive-connect";
  const returnRoute = url.searchParams.get("oauth_return") ?? "settings";
  try {
    if (!handoff || !isGoogleDriveConfigured()) throw new Error("oauth-return-invalid");
    const session = await apiFetch("/v1/oauth/google/handoff/exchange", { handoff });
    const profile = await apiFetch("/v1/drive/execute", { operation: "profile" }, session.sessionToken);
    const accountEmail = String(profile?.result?.email ?? "");
    localStorage.setItem(PERSISTENT_SESSION_MARKER_KEY, JSON.stringify({
      cookieSession: true,
      expiresAt: session.expiresAt,
      renewalExpiresAt: session.renewalExpiresAt,
      accountEmail
    }));
    const completion = {
      purpose,
      returnRoute,
      accountEmail,
      expiresAt: Date.now() + OAUTH_POPUP_COMPLETION_LIFETIME_MS
    };
    localStorage.setItem(OAUTH_POPUP_COMPLETION_KEY, JSON.stringify(completion));
    try {
      const channel = new BroadcastChannel("forget-me-not-oauth");
      channel.postMessage({ type: "oauth-popup-complete", ...completion });
      channel.close();
    } catch {}
    statusElement.textContent = "Google Drive 授權已完成，正在返回莫忘。";
    window.setTimeout(() => window.close(), 250);
    window.setTimeout(() => {
      statusElement.textContent = "Google Drive 授權已完成，請關閉此視窗並返回莫忘。";
    }, 1200);
  } catch {
    statusElement.textContent = "Google Drive 授權未完成，請關閉此視窗並返回莫忘後重試。";
  }
}

async function apiFetch(path, body, sessionToken = "") {
  const baseUrl = String(APP_CONFIG.googleDrive.oauthApiUrl ?? "").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "oauth-return-failed");
  return payload;
}
