const encoder = new TextEncoder();

export async function createOAuthState({ returnTo, nonce, popup = false, secret, now = Date.now(), lifetimeMs = 10 * 60 * 1000 }) {
  const payload = { returnTo, nonce, popup: popup === true, expiresAt: now + lifetimeMs };
  const encoded = base64Url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${await sign(encoded, secret)}`;
}

export async function verifyOAuthState({ state, secret, now = Date.now() }) {
  const [encoded, signature, ...extra] = String(state ?? "").split(".");
  if (!encoded || !signature || extra.length || !(await equal(signature, await sign(encoded, secret)))) throw new Error("oauth-state-invalid");
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))); } catch { throw new Error("oauth-state-invalid"); }
  if (!payload?.returnTo || !payload?.nonce || !Number.isFinite(payload.expiresAt) || now > payload.expiresAt) throw new Error("oauth-state-expired");
  return payload;
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

async function equal(a, b) {
  const left = encoder.encode(a); const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let result = 0; for (let i = 0; i < left.length; i += 1) result |= left[i] ^ right[i];
  return result === 0;
}

function base64Url(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function fromBase64Url(value) { const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4); return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)); }
