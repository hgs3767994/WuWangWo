const userConfig = globalThis.window?.FORGET_ME_NOT_CONFIG ?? {};

export const APP_CONFIG = {
  appVersion: "0.1.0",
  cacheName: "forget-me-not-v134",
  driveProvider: "mock",
  googleDrive: {
    clientId: "",
    oauthApiUrl: "",
    appFolderName: "勿忘我",
    fileNames: {
      keyPackage: "key-package.enc",
      vault: "vault.enc"
    }
  },
  ...userConfig,
  googleDrive: {
    clientId: "",
    oauthApiUrl: "",
    appFolderName: "勿忘我",
    fileNames: {
      keyPackage: "key-package.enc",
      vault: "vault.enc"
    },
    ...(userConfig.googleDrive ?? {}),
    fileNames: {
      keyPackage: "key-package.enc",
      vault: "vault.enc",
      ...(userConfig.googleDrive?.fileNames ?? {})
    }
  }
};

export function isMockDrive() {
  return APP_CONFIG.driveProvider !== "google";
}

export function isGoogleDriveConfigured() {
  return APP_CONFIG.driveProvider === "google" && Boolean(APP_CONFIG.googleDrive?.oauthApiUrl);
}

export function driveProviderLabel() {
  if (APP_CONFIG.driveProvider === "google") return isGoogleDriveConfigured() ? "Google Drive" : "Google Drive（尚未設定）";
  return "本機模擬";
}

export function driveFileName(key) {
  return APP_CONFIG.googleDrive.fileNames[key];
}
