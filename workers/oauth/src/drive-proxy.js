const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const USERINFO_API = "https://openidconnect.googleapis.com/v1/userinfo";
const MAX_CONTENT_BYTES = 5 * 1024 * 1024;

export async function executeDriveOperation({ operation, name, content, revisionId, accessToken, fetchImpl = fetch }) {
  if (!["list", "profile"].includes(operation) && !validFileName(name)) throw new Error("drive-file-name-invalid");
  const request = (url, options = {}) => googleRequest(url, accessToken, options, fetchImpl);
  if (operation === "list") {
    const [keyPackage, vault] = await Promise.all([findFile(request, "key-package.enc"), findFile(request, "vault.enc")]);
    return { hasKeyPackage: Boolean(keyPackage), hasVault: Boolean(vault) };
  }
  const file = await findFile(request, name);
  if (operation === "read") return file ? request(`${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}?alt=media`) : null;
  if (operation === "delete") { if (file) await request(`${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}`, { method: "DELETE" }); return null; }
  if (operation === "write") {
    const encoded = JSON.stringify(content);
    if (new TextEncoder().encode(encoded).byteLength > MAX_CONTENT_BYTES) throw new Error("drive-content-too-large");
    const metadata = { name, mimeType: "application/json", parents: file ? undefined : ["appDataFolder"] };
    const path = file ? `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(file.id)}?uploadType=multipart` : `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`;
    await request(path, { method: file ? "PATCH" : "POST", headers: { "Content-Type": "multipart/related; boundary=forget_me_not_boundary" }, body: multipartBody(metadata, encoded) });
    return null;
  }
  if (operation === "revisions") {
    if (!file) return { file: null, revisions: [] };
    const result = await request(`${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}/revisions?${new URLSearchParams({ pageSize: "1000", fields: "revisions(id,modifiedTime,keepForever,mimeType,size)" })}`);
    return { file, revisions: result.revisions ?? [] };
  }
  if (operation === "readRevision") { if (!String(revisionId ?? "")) throw new Error("drive-revision-invalid"); return file ? request(`${DRIVE_API_BASE}/files/${encodeURIComponent(file.id)}/revisions/${encodeURIComponent(String(revisionId))}?alt=media&acknowledgeAbuse=true`) : null; }
  if (operation === "profile") return request(USERINFO_API);
  throw new Error("drive-operation-invalid");
}

async function findFile(request, name) {
  const escapedName = name.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  const result = await request(`${DRIVE_API_BASE}/files?${new URLSearchParams({ spaces: "appDataFolder", q: `name = '${escapedName}' and trashed = false`, fields: "files(id,name,modifiedTime)", pageSize: "1" })}`);
  return result.files?.[0] ?? null;
}

async function googleRequest(url, accessToken, options, fetchImpl) {
  const response = await fetchImpl(url, { ...options, headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers ?? {}) } });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`google-drive-request-failed:${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json") ? response.json() : response.text();
}

function validFileName(name) { return /^(key-package|vault)\.enc$|^diagnostic-[0-9a-f-]{36}\.json$/i.test(String(name ?? "")); }
function multipartBody(metadata, content) { const boundary = "forget_me_not_boundary"; return [`--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify(metadata), `--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", content, `--${boundary}--`].join("\r\n"); }
