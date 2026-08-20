import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outputDir = "dist";
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
const driveProvider = clientId ? "google" : "mock";
const entries = [
  "index.html",
  "manifest.webmanifest",
  "service-worker.js",
  "assets",
  "src"
];

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const entry of entries) {
  await cp(entry, join(outputDir, entry), { recursive: true });
}

await writeFile(join(outputDir, ".nojekyll"), "");
await writeFile(join(outputDir, "404.html"), redirectPage());
await writeFile(join(outputDir, "src", "runtime-config.js"), runtimeConfigSource({ clientId, driveProvider }));

console.log(`GitHub Pages build ready in ${outputDir}/`);
console.log(clientId ? "Google Drive mode: google" : "Google Drive mode: mock; set GOOGLE_OAUTH_CLIENT_ID to enable google mode.");

function runtimeConfigSource({ clientId, driveProvider }) {
  return `// This file is generated during GitHub Pages deployment.
// OAuth Client ID is public browser configuration. Do not put a client secret here.
let localConfig = {};
try {
  localConfig = JSON.parse(localStorage.getItem("forget-me-not-runtime-config") ?? "{}");
} catch {}

window.FORGET_ME_NOT_CONFIG = {
  driveProvider: ${JSON.stringify(driveProvider)},
  googleDrive: {
    clientId: ${JSON.stringify(clientId)}
  },
  ...localConfig,
  googleDrive: {
    clientId: ${JSON.stringify(clientId)},
    ...(localConfig.googleDrive ?? {})
  }
};
`;
}

function redirectPage() {
  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>勿忘我</title>
    <script>
      const parts = location.pathname.split("/").filter(Boolean);
      const base = location.hostname.endsWith(".github.io") && parts.length ? "/" + parts[0] + "/" : "/";
      location.replace(base);
    </script>
  </head>
  <body></body>
</html>
`;
}
