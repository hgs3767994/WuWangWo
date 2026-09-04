import { APP_CONFIG, isGoogleDriveConfigured } from "./config.js";

const SESSION_STORAGE_KEY = "forget-me-not-oauth-session";

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

export async function connectGoogleDrive({ interactive = true } = {}) {
  const session = await completeGoogleOAuthHandoff();
  if (session) return { connected: true, accountEmail: session.accountEmail };
  const existing = readSession();
  if (existing && Date.parse(existing.expiresAt) > Date.now() + 30_000) return { connected: true, accountEmail: existing.accountEmail ?? "" };
  if (!interactive) throw new Error("google-drive-auth-required");
  const returnTo = new URL(location.href);
  returnTo.searchParams.delete("oauth_handoff");
  location.assign(`${apiUrl()}/v1/oauth/google/start?${new URLSearchParams({ return_to: returnTo.toString() })}`);
  return new Promise(() => {});
}

export function disconnectGoogleDrive() { sessionStorage.removeItem(SESSION_STORAGE_KEY); }

export function googleDriveAuthStatus() {
  const session = readSession();
  return { hasAccessToken: Boolean(session && Date.parse(session.expiresAt) > Date.now()), expiresAt: session?.expiresAt ?? "", accountEmail: session?.accountEmail ?? "" };
}

export function googleDriveReadiness() {
  if (isGoogleDriveConfigured()) return { ready: true, message: "" };
  return { ready: false, message: "尚未設定 Google Drive Worker API 網址，目前仍需使用本機模擬同步。" };
}

export async function completeGoogleOAuthHandoff() {
  const url = new URL(location.href);
  const handoff = url.searchParams.get("oauth_handoff");
  if (!handoff) return null;
  try {
    const response = await apiFetch("/v1/oauth/google/handoff/exchange", { handoff }, false);
    const profile = await execute("profile", {}, response.sessionToken);
    const session = { sessionToken: response.sessionToken, expiresAt: response.expiresAt, accountEmail: profile?.email ?? "" };
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    url.searchParams.delete("oauth_handoff");
    history.replaceState(history.state, "", url);
    return session;
  } catch {
    url.searchParams.delete("oauth_handoff");
    history.replaceState(history.state, "", url);
    throw new Error("google-drive-handoff-failed");
  }
}

async function execute(operation, values = {}, overrideToken = "") {
  const session = overrideToken ? { sessionToken: overrideToken } : readSession();
  if (!session?.sessionToken) throw new Error("google-drive-auth-required");
  const response = await apiFetch("/v1/drive/execute", { operation, ...values }, session.sessionToken);
  return response.result;
}

async function apiFetch(path, body, sessionToken) {
  if (!isGoogleDriveConfigured()) throw new Error(googleDriveReadiness().message);
  const response = await fetch(`${apiUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}) },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "google-drive-request-failed");
  return payload;
}

function apiUrl() { return String(APP_CONFIG.googleDrive.oauthApiUrl).replace(/\/$/, ""); }
function readSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? "null"); } catch { return null; } }
