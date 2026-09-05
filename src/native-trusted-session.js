function plugin() {
  const capacitor = globalThis.Capacitor;
  if (!capacitor?.isNativePlatform?.()) return null;
  return capacitor.Plugins?.TrustedSession ?? null;
}

export function nativeTrustedSessionAvailable() {
  return Boolean(plugin());
}

export function isNativeTrustedSession(record) {
  return record?.schemaVersion === 2 && record?.storage === "android-keystore";
}

export async function storeNativeTrustedSession({ vaultId, deviceId, sessionEpoch, dekBytes }) {
  const bridge = plugin();
  if (!bridge) throw new Error("trusted-session-native-storage-unavailable");
  await bridge.store({ vaultId, deviceId, sessionEpoch, dekBase64: bytesToBase64(dekBytes) });
}

export async function restoreNativeTrustedSession({ vaultId, deviceId, sessionEpoch }) {
  const bridge = plugin();
  if (!bridge) throw new Error("trusted-session-native-storage-unavailable");
  const result = await bridge.restore({ vaultId, deviceId, sessionEpoch });
  if (!result?.dekBase64) throw new Error("trusted-session-native-record-missing");
  return base64ToBytes(result.dekBase64);
}

export async function clearNativeTrustedSession() {
  const bridge = plugin();
  if (!bridge) return;
  await bridge.clear();
}

export function nativeTrustedSessionAuthenticationError(error) {
  const message = String(error?.message ?? error ?? "");
  return message.includes("trusted-session-auth-");
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
