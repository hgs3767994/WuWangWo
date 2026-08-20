import { APP_CONFIG, isGoogleDriveConfigured } from "./config.js";

const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

let gisLoadPromise = null;
let tokenClient = null;
let accessToken = "";
let tokenExpiresAt = 0;

export async function writeGoogleDriveFile(name, content) {
  const existing = await findGoogleDriveFile(name);
  const metadata = {
    name,
    mimeType: "application/json",
    parents: existing ? undefined : ["appDataFolder"]
  };
  const body = multipartBody(metadata, JSON.stringify(content));
  const path = existing
    ? `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(existing.id)}?uploadType=multipart`
    : `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`;
  await googleFetch(path, {
    method: existing ? "PATCH" : "POST",
    headers: {
      "Content-Type": `multipart/related; boundary=${multipartBoundary()}`
    },
    body
  });
}

export async function readGoogleDriveFile(name) {
  const file = await findGoogleDriveFile(name);
  if (!file) return null;
  return googleFetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}?alt=media`);
}

export async function removeGoogleDriveFile(name) {
  const file = await findGoogleDriveFile(name);
  if (!file) return;
  await googleFetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}`, { method: "DELETE" });
}

export async function listGoogleDriveFiles() {
  const [keyPackage, vault] = await Promise.all([
    findGoogleDriveFile(APP_CONFIG.googleDrive.fileNames.keyPackage),
    findGoogleDriveFile(APP_CONFIG.googleDrive.fileNames.vault)
  ]);
  return {
    hasKeyPackage: Boolean(keyPackage),
    hasVault: Boolean(vault)
  };
}

export async function testGoogleDriveConnection() {
  const testFileName = `diagnostic-${crypto.randomUUID()}.json`;
  const payload = {
    fileType: "forget-me-not-drive-diagnostic",
    createdAt: new Date().toISOString()
  };
  await connectGoogleDrive();
  await writeGoogleDriveFile(testFileName, payload);
  const loaded = await readGoogleDriveFile(testFileName);
  await removeGoogleDriveFile(testFileName);
  return {
    ok: loaded?.fileType === payload.fileType,
    fileName: testFileName
  };
}

export async function connectGoogleDrive(options = {}) {
  await ensureGoogleAccessToken({ interactive: options.interactive !== false });
  return { connected: true };
}

export function disconnectGoogleDrive() {
  if (accessToken && globalThis.google?.accounts?.oauth2?.revoke) {
    globalThis.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = "";
  tokenExpiresAt = 0;
}

export function googleDriveAuthStatus() {
  return {
    hasAccessToken: Boolean(accessToken),
    expiresAt: tokenExpiresAt ? new Date(tokenExpiresAt).toISOString() : ""
  };
}

export function googleDriveReadiness() {
  if (isGoogleDriveConfigured()) return { ready: true, message: "" };
  return {
    ready: false,
    message: "尚未設定 Google Drive OAuth Client ID，目前仍需使用本機模擬同步。"
  };
}

async function findGoogleDriveFile(name) {
  const escapedName = name.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  const query = encodeURIComponent(`name = '${escapedName}' and trashed = false`);
  const result = await googleFetch(
    `${DRIVE_API_BASE}/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)&pageSize=1`
  );
  return result.files?.[0] ?? null;
}

async function googleFetch(url, options = {}) {
  const token = await ensureGoogleAccessToken({ interactive: options.interactive === true });
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {})
    }
  });
  if (response.status === 204) return null;
  if (!response.ok) {
    let details = "";
    try {
      const payload = await response.clone().json();
      const apiMessage = payload?.error?.message ?? payload?.error_description ?? "";
      const apiStatus = payload?.error?.status ?? "";
      details = [apiStatus, apiMessage].filter(Boolean).join(":");
    } catch {}
    throw new Error(`google-drive-request-failed:${response.status}${details ? `:${details}` : ""}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

async function ensureGoogleAccessToken({ interactive = false } = {}) {
  if (accessToken && Date.now() < tokenExpiresAt - 60000) return accessToken;
  if (!isGoogleDriveConfigured()) throw new Error(googleDriveReadiness().message);
  await loadGoogleIdentityServices();
  tokenClient ??= globalThis.google.accounts.oauth2.initTokenClient({
    client_id: APP_CONFIG.googleDrive.clientId,
    scope: DRIVE_SCOPE,
    callback: () => {}
  });
  return new Promise((resolve, reject) => {
    tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      if (!response.access_token) {
        reject(new Error("google-drive-auth-required"));
        return;
      }
      accessToken = response.access_token;
      tokenExpiresAt = Date.now() + Number(response.expires_in ?? 3600) * 1000;
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}

function loadGoogleIdentityServices() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("google-identity-services-load-failed"));
    document.head.append(script);
  });
  return gisLoadPromise;
}

function multipartBoundary() {
  return "forget_me_not_boundary";
}

function multipartBody(metadata, content) {
  const boundary = multipartBoundary();
  return [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    content,
    `--${boundary}--`
  ].join("\r\n");
}
