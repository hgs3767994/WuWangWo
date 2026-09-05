const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DEFAULT_ITERATIONS = 210000;

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function textBytes(value) {
  return new TextEncoder().encode(value);
}

function bytesText(bytes) {
  return new TextDecoder().decode(bytes);
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function importAesKey(rawKey, usages) {
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, usages);
}

async function deriveWrappingKey(secret, salt, iterations = DEFAULT_ITERATIONS) {
  const baseKey = await crypto.subtle.importKey("raw", textBytes(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function wrapDek(dekBytes, secret, iterations = DEFAULT_ITERATIONS) {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await deriveWrappingKey(secret, salt, iterations);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, dekBytes);
  return {
    salt: bytesToBase64(salt),
    nonce: bytesToBase64(nonce),
    wrappedDek: bytesToBase64(new Uint8Array(ciphertext)),
    updatedAt: new Date().toISOString()
  };
}

async function recoveryVerifierBytes(recoveryCode, salt, iterations) {
  const baseKey = await crypto.subtle.importKey("raw", textBytes(recoveryCode), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, baseKey, 256));
}

export async function createRecoveryAuthorizationVerifier(recoveryCode, iterations = DEFAULT_ITERATIONS) {
  const salt = randomBytes(16);
  const verifier = await recoveryVerifierBytes(recoveryCode, salt, iterations);
  return { version: 2, kdf: "PBKDF2", hash: "SHA-256", iterations, salt: bytesToBase64(salt), verifier: bytesToBase64(verifier), updatedAt: new Date().toISOString() };
}

export async function verifyRecoveryAuthorizationVerifier(record, recoveryCode) {
  if (!record || record.version !== 2 || !recoveryCode) return false;
  const actual = await recoveryVerifierBytes(recoveryCode, base64ToBytes(record.salt), record.iterations ?? DEFAULT_ITERATIONS);
  const expected = base64ToBytes(record.verifier);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

export async function wrapDekForSecret(dekBytes, secret, iterations = DEFAULT_ITERATIONS) {
  return wrapDek(dekBytes, secret, iterations);
}

export async function unwrapDek(wrapper, secret, iterations = DEFAULT_ITERATIONS) {
  const salt = base64ToBytes(wrapper.salt);
  const nonce = base64ToBytes(wrapper.nonce);
  const key = await deriveWrappingKey(secret, salt, iterations);
  const dekBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    base64ToBytes(wrapper.wrappedDek)
  );
  return new Uint8Array(dekBytes);
}

export async function createTrustedSessionWithDek({ vaultId, deviceId, sessionEpoch, dekBytes }) {
  const now = new Date().toISOString();
  const localDeviceKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const nonce = randomBytes(12);
  const wrappedDek = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, localDeviceKey, dekBytes);
  return {
    schemaVersion: 1,
    vaultId,
    deviceId,
    sessionEpoch,
    localDekWrapper: {
      nonce: bytesToBase64(nonce),
      wrappedDek: bytesToBase64(new Uint8Array(wrappedDek))
    },
    localDeviceKey,
    createdAt: now,
    lastUsedAt: now
  };
}

export async function createLocalStorageKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptLocalEnvelope(payload, localStorageKey, fileType = "local-data") {
  const nonce = randomBytes(12);
  const plaintext = textBytes(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, localStorageKey, plaintext);
  return {
    fileType,
    schemaVersion: 1,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    updatedAt: new Date().toISOString()
  };
}

export async function decryptLocalEnvelope(envelope, localStorageKey) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.nonce) },
    localStorageKey,
    base64ToBytes(envelope.ciphertext)
  );
  return JSON.parse(bytesText(new Uint8Array(plaintext)));
}

export async function restoreDekFromTrustedSession(trustedSession) {
  if (!trustedSession?.localDekWrapper || !trustedSession.localDeviceKey) {
    throw new Error("trusted-session-missing-local-key");
  }
  const dekBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(trustedSession.localDekWrapper.nonce) },
    trustedSession.localDeviceKey,
    base64ToBytes(trustedSession.localDekWrapper.wrappedDek)
  );
  return new Uint8Array(dekBytes);
}

export function normalizeRecoveryCode(value) {
  return value.trim().toUpperCase().replaceAll("-", "").match(/.{1,5}/g)?.join("-") ?? "";
}

export function generateRecoveryCode() {
  const values = randomBytes(25);
  const chars = [...values].map((value) => RECOVERY_ALPHABET[value % RECOVERY_ALPHABET.length]);
  return chars.join("").match(/.{1,5}/g).join("-");
}

export async function createKeyPackage({ vaultId, deviceId, masterPassword }) {
  const dekBytes = randomBytes(32);
  const recoveryCode = generateRecoveryCode();
  const now = new Date().toISOString();
  const masterPasswordWrapper = await wrapDek(dekBytes, masterPassword);
  const recoveryAuthorizationVerifier = await createRecoveryAuthorizationVerifier(recoveryCode);

  return {
    dekBytes,
    recoveryCode,
    keyPackage: {
      fileType: "key-package",
      schemaVersion: 1,
      vaultId,
      crypto: {
        kdf: "PBKDF2",
        iterations: DEFAULT_ITERATIONS,
        hash: "SHA-256",
        cipher: "AES-GCM"
      },
      masterPasswordWrapper: {
        ...masterPasswordWrapper,
        updatedByDeviceId: deviceId
      },
      recoveryAuthorizationVerifier: {
        ...recoveryAuthorizationVerifier,
        recoveryCodeVersion: 1,
        updatedByDeviceId: deviceId
      },
      securityMeta: {
        sessionEpoch: 1,
        createdAt: now,
        updatedAt: now
      }
    },
    trustedSession: await createTrustedSessionWithDek({ vaultId, deviceId, sessionEpoch: 1, dekBytes })
  };
}

export async function encryptVaultEnvelope(vault, dekBytes) {
  const nonce = randomBytes(12);
  const key = await importAesKey(dekBytes, ["encrypt"]);
  const plaintext = textBytes(JSON.stringify(vault));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext);
  return {
    fileType: "vault",
    schemaVersion: 1,
    vaultId: vault.vaultId,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    updatedAt: new Date().toISOString()
  };
}

export async function decryptVaultEnvelope(envelope, dekBytes) {
  const key = await importAesKey(dekBytes, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.nonce) },
    key,
    base64ToBytes(envelope.ciphertext)
  );
  return JSON.parse(bytesText(new Uint8Array(plaintext)));
}
