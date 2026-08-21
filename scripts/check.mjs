import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "README.md",
  "index.html",
  "privacy.html",
  "terms.html",
  "manifest.webmanifest",
  "package.json",
  "service-worker.js",
  ".github/workflows/deploy-pages.yml",
  "scripts/build-pages.mjs",
  "scripts/check.mjs",
  "scripts/dev-server.mjs",
  "scripts/smoke-test.mjs",
  "src/app.js",
  "src/config.js",
  "src/crypto.js",
  "src/db.js",
  "src/drive.js",
  "src/drive-google.js",
  "src/drive-mock.js",
  "src/model.js",
  "src/runtime-config.js",
  "src/sync.js",
  "src/xlsx.js",
  "src/styles.css"
];
const appShellRequiredFiles = requiredFiles.filter((file) => ![
  "README.md",
  "package.json",
  "service-worker.js",
  ".github/workflows/deploy-pages.yml",
  "scripts/build-pages.mjs",
  "scripts/check.mjs",
  "scripts/dev-server.mjs",
  "scripts/smoke-test.mjs"
].includes(file));

const checks = [];

await check("required files exist and are readable", () => Promise.all(requiredFiles.map((file) => readFile(file, "utf8"))));

const manifest = await check("manifest JSON is valid", async () => JSON.parse(await readFile("manifest.webmanifest", "utf8")));

const configSource = await readFile("src/config.js", "utf8");
const serviceWorkerSource = await readFile("service-worker.js", "utf8");
const indexSource = await readFile("index.html", "utf8");
const workflowSource = await readFile(".github/workflows/deploy-pages.yml", "utf8");
const buildPagesSource = await readFile("scripts/build-pages.mjs", "utf8");
const configCacheName = configSource.match(/cacheName:\s*"([^"]+)"/)?.[1];
const serviceWorkerCacheName = serviceWorkerSource.match(/CACHE_NAME\s*=\s*"([^"]+)"/)?.[1];

await check("config cacheName matches service worker CACHE_NAME", () => {
  if (!configCacheName || !serviceWorkerCacheName || configCacheName !== serviceWorkerCacheName) {
    throw new Error("Config cacheName and service-worker CACHE_NAME must match.");
  }
});

await check("manifest has required PWA fields", () => {
  ["name", "short_name", "start_url", "display", "icons"].forEach((field) => {
    if (!manifest[field]) throw new Error(`manifest.webmanifest is missing ${field}.`);
  });
  if (!Array.isArray(manifest.icons) || !manifest.icons.length) throw new Error("manifest.webmanifest must include at least one icon.");
});

await check("manifest uses GitHub Pages friendly relative start_url", () => {
  if (manifest.start_url !== "./") throw new Error('manifest.webmanifest start_url must be "./" for project pages.');
});

await check("manifest icon files exist", async () => {
  await Promise.all(
    manifest.icons.map((icon) => {
      if (!icon.src) throw new Error("manifest icon is missing src.");
      return access(stripRelativePrefix(icon.src));
    })
  );
});

await check("runtime config loads before app module", () => {
  const runtimeConfigIndex = indexSource.indexOf("./src/runtime-config.js");
  const appModuleIndex = indexSource.indexOf("./src/app.js");
  if (runtimeConfigIndex < 0) throw new Error("index.html must load src/runtime-config.js.");
  if (appModuleIndex < 0) throw new Error("index.html must load src/app.js.");
  if (runtimeConfigIndex > appModuleIndex) throw new Error("runtime-config.js must load before app.js.");
});

await check("public legal pages exist for OAuth production readiness", async () => {
  const privacy = await readFile("privacy.html", "utf8");
  const terms = await readFile("terms.html", "utf8");
  ["Google Drive", "appDataFolder", "Email", "隱私權政策"].forEach((text) => {
    if (!privacy.includes(text)) throw new Error(`privacy.html must mention ${text}.`);
  });
  ["Google Drive", "服務條款"].forEach((text) => {
    if (!terms.includes(text)) throw new Error(`terms.html must mention ${text}.`);
  });
});

await check("GitHub Pages workflow builds deployable dist", () => {
  ["actions/deploy-pages", "npm run check", "npm run test", "npm run build:pages", "GOOGLE_OAUTH_CLIENT_ID"].forEach((text) => {
    if (!workflowSource.includes(text)) throw new Error(`GitHub Pages workflow is missing ${text}.`);
  });
  ["dist", "runtime-config.js", ".nojekyll", "GOOGLE_OAUTH_CLIENT_ID"].forEach((text) => {
    if (!buildPagesSource.includes(text)) throw new Error(`scripts/build-pages.mjs is missing ${text}.`);
  });
});

const appShell = parseAppShell(serviceWorkerSource);

await check("service worker app shell files exist", async () => {
  await Promise.all(appShell.filter((file) => file !== "./").map((file) => access(stripRelativePrefix(file))));
});

await check("required files are included in service worker app shell", () => {
  const appShellSet = new Set(appShell.map(stripRelativePrefix));
  appShellRequiredFiles.forEach((file) => {
      if (!appShellSet.has(file)) throw new Error(`${file} is not included in APP_SHELL.`);
    });
});

checks.forEach((item) => console.log(`${item.ok ? "✓" : "✗"} ${item.name}`));
console.log("Deployment checks passed.");

async function check(name, fn) {
  try {
    const result = await fn();
    checks.push({ name, ok: true });
    return result;
  } catch (error) {
    checks.push({ name, ok: false });
    checks.forEach((item) => console.log(`${item.ok ? "✓" : "✗"} ${item.name}`));
    throw error;
  }
}

function parseAppShell(source) {
  const match = source.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  if (!match) throw new Error("service-worker.js APP_SHELL was not found.");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function stripRelativePrefix(path) {
  return path.replace(/^\.\//, "");
}
