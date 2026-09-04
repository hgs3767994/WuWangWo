const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function encryptTokenEnvelope(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(secret);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(value)));
  return { iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}

export async function decryptTokenEnvelope(envelope, secret) {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(envelope.iv) }, await keyFor(secret), decode(envelope.ciphertext));
  return JSON.parse(decoder.decode(plaintext));
}

async function keyFor(secret) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
function encode(bytes) { return btoa(String.fromCharCode(...bytes)); }
function decode(value) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
