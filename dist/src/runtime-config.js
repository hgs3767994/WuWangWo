// This file is generated during GitHub Pages deployment.
// OAuth Client ID is public browser configuration. Do not put a client secret here.
let localConfig = {};
try {
  localConfig = JSON.parse(localStorage.getItem("forget-me-not-runtime-config") ?? "{}");
} catch {}

window.FORGET_ME_NOT_CONFIG = {
  driveProvider: "mock",
  googleDrive: {
    clientId: ""
  },
  ...localConfig,
  googleDrive: {
    clientId: "",
    ...(localConfig.googleDrive ?? {})
  }
};
