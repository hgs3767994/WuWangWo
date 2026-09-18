import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outputDir = "www";
const oauthApiUrl = process.env.GOOGLE_OAUTH_API_URL?.trim().replace(/\/$/, "") ?? "";
const nativeServerClientId = (process.env.GOOGLE_OAUTH_SERVER_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID)?.trim() ?? "";
const entries = [
  "index.html",
  "privacy.html",
  "terms.html",
  "data-deletion.html",
  "manifest.webmanifest",
  "service-worker.js",
  "assets",
  "pics",
  "src"
];

if (!oauthApiUrl) {
  throw new Error("GOOGLE_OAUTH_API_URL is required for a native bundle; do not build a Capacitor app against mock Drive.");
}
if (!nativeServerClientId.endsWith(".apps.googleusercontent.com")) {
  throw new Error("GOOGLE_OAUTH_SERVER_CLIENT_ID is required for Android Google Drive offline authorization.");
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
for (const entry of entries) await cp(entry, join(outputDir, entry), { recursive: true });
await writeFile(join(outputDir, "src", "runtime-config.js"), runtimeConfigSource(oauthApiUrl, nativeServerClientId));

console.log(`Capacitor web bundle ready in ${outputDir}/ using the Worker proxy.`);

function runtimeConfigSource(apiUrl, serverClientId) {
  return `// Generated for the native Capacitor bundle. These values are public OAuth configuration; no client secret belongs here.\nwindow.FORGET_ME_NOT_CONFIG = { driveProvider: "google", googleDrive: { oauthApiUrl: ${JSON.stringify(apiUrl)}, nativeServerClientId: ${JSON.stringify(serverClientId)} } };\n`;
}
