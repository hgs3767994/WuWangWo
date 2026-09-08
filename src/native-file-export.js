function plugin() {
  const capacitor = globalThis.Capacitor;
  if (!capacitor?.isNativePlatform?.()) return null;
  return capacitor.Plugins?.NativeFileExport ?? null;
}

export function nativeFileExportAvailable() {
  return Boolean(plugin());
}

export async function saveNativeExport(blob, filename) {
  const bridge = plugin();
  if (!bridge) throw new Error("native-file-export-unavailable");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const base64Data = bytesToBase64(bytes);
  return bridge.save({
    filename,
    mimeType: blob.type || "application/octet-stream",
    base64Data
  });
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
