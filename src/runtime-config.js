// 部署前可在這裡覆寫 App 設定。
// 注意：OAuth Client ID 屬於前端公開設定，不應放入 client secret。
//
// window.FORGET_ME_NOT_CONFIG = {
//   driveProvider: "google",
//   googleDrive: {
//     oauthApiUrl: "https://YOUR-WORKER.workers.dev"
//   }
// };

let localConfig = {};
try {
  localConfig = JSON.parse(localStorage.getItem("forget-me-not-runtime-config") ?? "{}");
} catch {}

window.FORGET_ME_NOT_CONFIG = {
  ...(window.FORGET_ME_NOT_CONFIG ?? {}),
  ...localConfig,
  googleDrive: {
    ...((window.FORGET_ME_NOT_CONFIG ?? {}).googleDrive ?? {}),
    ...(localConfig.googleDrive ?? {})
  }
};
