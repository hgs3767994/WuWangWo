import { deleteGoogleCloudAccount, googleDriveReadiness } from "./drive-google.js";

const button = document.querySelector("[data-delete-submit]");
const confirmation = document.querySelector("[data-delete-confirmation]");
const status = document.querySelector("[data-delete-status]");

button?.addEventListener("click", async () => {
  if (confirmation.value.trim() !== "DELETE") {
    showStatus("請先輸入 DELETE 才能繼續。", true);
    confirmation.focus();
    return;
  }
  const readiness = googleDriveReadiness();
  if (!readiness.ready) {
    showStatus("資料刪除服務目前未設定完成，請稍後再試。", true);
    return;
  }
  const popupWindow = window.open("about:blank", "forget_me_not_account_deletion", "popup,width=520,height=720");
  if (!popupWindow) {
    showStatus("瀏覽器阻擋了 Google 驗證視窗，請允許此網站開啟彈出式視窗後再試。", true);
    return;
  }
  button.disabled = true;
  button.textContent = "重新驗證中…";
  showStatus("請在 Google 視窗選擇要刪除的帳號。", false);
  try {
    await deleteGoogleCloudAccount({ popupWindow });
    confirmation.value = "";
    confirmation.disabled = true;
    button.textContent = "刪除完成";
    showStatus("刪除完成：雲端帳號、Google 授權與莫忘 Drive 加密同步檔都已永久刪除。", false);
  } catch (error) {
    try { popupWindow.close(); } catch {}
    button.disabled = false;
    button.textContent = "選擇 Google 帳號並永久刪除";
    showStatus(deletionErrorMessage(error), true);
  }
});

function showStatus(message, error) {
  status.textContent = message;
  status.classList.toggle("error-message", error);
  status.classList.toggle("success-message", !error);
}

function deletionErrorMessage(error) {
  const message = String(error?.message ?? "");
  if (message.includes("authorization-cancelled")) return "Google 重新驗證已取消，沒有刪除任何資料。";
  if (message.includes("reauth-required")) return "Google 重新驗證已逾時，請再試一次。";
  if (message.includes("drive-deletion-required")) return "此版本無法完成符合政策的刪除流程，請重新整理頁面後再試。沒有刪除任何資料。";
  if (message.includes("google-drive-request-failed")) return "無法刪除所選的 Google Drive 加密檔，因此雲端帳號尚未完成刪除。";
  return "刪除未完成。請視為資料仍然保留，確認網路後再試一次。";
}
