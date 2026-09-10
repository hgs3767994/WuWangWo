import { authorizationUrl, exchangeCode, googleProfile, refreshAccessToken } from "./google-oauth.js";
import { createOAuthState } from "./oauth-state.js";
import { verifyOAuthState } from "./oauth-state.js";
import { decryptTokenEnvelope, encryptTokenEnvelope } from "./token-envelope.js";
import { consumeHandoff, createHandoff, createSession, revokeSession, saveAccount, sessionAccount } from "./oauth-store.js";
import { executeDriveOperation } from "./drive-proxy.js";
import { approveRecoveryRequest, completeRecoveryRequest, createRecoveryRequest, listRecoveryRequests, recordFailedVerification, recoveryRequest, recoveryVerificationRecord } from "./recovery-store.js";

const SERVICE_NAME = "forget-me-not-oauth";
const REQUIRED_SECRETS = ["GOOGLE_WEB_CLIENT_SECRET", "OAUTH_STATE_SIGNING_KEY", "TOKEN_ENCRYPTION_KEY"];
const REQUIRED_PUBLIC_VALUES = ["APP_ORIGINS", "GOOGLE_WEB_CLIENT_ID", "GOOGLE_OAUTH_REDIRECT_URI"];
const REQUIRED_NATIVE_VALUES = ["APP_ORIGINS", "GOOGLE_NATIVE_CLIENT_ID", "NATIVE_OAUTH_APP_LINK_URI", "OAUTH_STATE_SIGNING_KEY", "TOKEN_ENCRYPTION_KEY"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && isAllowedOrigin(request.headers.get("Origin"), env.APP_ORIGINS)) {
      return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
    }

    if (request.method === "GET" && url.pathname === "/v1/oauth/google/start") {
      if (!hasRequiredConfiguration(env)) return json({ error: "oauth-not-configured" }, 503);
      if (!(await databaseStatus(env.OAUTH_DB)).schemaReady) return json({ error: "storage-not-ready" }, 503);
      const returnTo = url.searchParams.get("return_to") ?? "";
      if (!allowedReturnTo(returnTo, env.APP_ORIGINS)) return json({ error: "invalid-return-to" }, 400);
      const nonce = crypto.randomUUID();
      const popup = url.searchParams.get("popup") === "1";
      const state = await createOAuthState({ returnTo, nonce, popup, secret: env.OAUTH_STATE_SIGNING_KEY });
      return redirect(authorizationUrl({ clientId: env.GOOGLE_WEB_CLIENT_ID, redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI, state }), 302, `forget_me_not_oauth_nonce=${nonce}; HttpOnly; Secure; SameSite=Lax; Path=/v1/oauth/google; Max-Age=600`);
    }

    if (request.method === "GET" && url.pathname === "/v1/oauth/google/native/start") {
      if (!hasNativeConfiguration(env)) return json({ error: "native-oauth-not-configured", missing: missingNativeConfiguration(env) }, 503);
      if (!(await databaseStatus(env.OAUTH_DB)).schemaReady) return json({ error: "storage-not-ready" }, 503);
      const codeChallenge = url.searchParams.get("code_challenge") ?? "";
      if (!validCodeChallenge(codeChallenge)) return json({ error: "native-oauth-pkce-invalid" }, 400);
      const state = await createOAuthState({ returnTo: env.NATIVE_OAUTH_APP_LINK_URI, nonce: crypto.randomUUID(), native: true, codeChallenge, secret: env.OAUTH_STATE_SIGNING_KEY });
      return redirect(authorizationUrl({ clientId: env.GOOGLE_NATIVE_CLIENT_ID, redirectUri: env.NATIVE_OAUTH_APP_LINK_URI, state, codeChallenge }), 302);
    }

    if (request.method === "POST" && url.pathname === "/v1/oauth/google/native/exchange") {
      const origin = request.headers.get("Origin");
      if (!isAllowedOrigin(origin, env.APP_ORIGINS)) return json({ error: "origin-not-allowed" }, 403);
      if (!hasNativeConfiguration(env)) return json({ error: "native-oauth-not-configured", missing: missingNativeConfiguration(env) }, 503, corsHeaders(origin));
      if (!(await databaseStatus(env.OAUTH_DB)).schemaReady) return json({ error: "storage-not-ready" }, 503, corsHeaders(origin));
      try {
        const body = await request.json();
        const verifier = String(body?.code_verifier ?? "");
        const payload = await verifyOAuthState({ state: body?.state, secret: env.OAUTH_STATE_SIGNING_KEY });
        if (!payload.native || !validCodeVerifier(verifier) || !sameText(payload.codeChallenge, await pkceChallenge(verifier))) throw new Error("native-oauth-pkce-invalid");
        const tokens = await exchangeCode({ code: body?.code, clientId: env.GOOGLE_NATIVE_CLIENT_ID, redirectUri: env.NATIVE_OAUTH_APP_LINK_URI, codeVerifier: verifier });
        const profile = await googleProfile({ accessToken: tokens.access_token });
        const now = new Date().toISOString();
        await saveAccount(env.OAUTH_DB, { subject: profile.sub, envelope: await encryptTokenEnvelope(tokens, env.TOKEN_ENCRYPTION_KEY), scopes: tokens.scope ?? "", expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null, refreshTokenPresent: Boolean(tokens.refresh_token), now });
        const token = crypto.randomUUID();
        const session = await createSession(env.OAUTH_DB, { token, subject: profile.sub, now });
        return json({ sessionToken: token, expiresAt: session.expiresAt, accountEmail: profile.email ?? "" }, 200, corsHeaders(origin));
      } catch (error) {
        const message = String(error?.message ?? "");
        const status = message === "native-oauth-pkce-invalid" || message.startsWith("oauth-state-") ? 400 : 502;
        return json({ error: status === 400 ? "native-oauth-pkce-invalid" : "native-oauth-exchange-failed" }, status, corsHeaders(origin));
      }
    }

    if (request.method === "GET" && url.pathname === "/v1/oauth/google/callback") {
      const state = url.searchParams.get("state");
      const cookieNonce = cookie(request.headers.get("Cookie"), "forget_me_not_oauth_nonce");
      let payload = null;
      try {
        payload = await verifyOAuthState({ state, secret: env.OAUTH_STATE_SIGNING_KEY });
        if (!cookieNonce || cookieNonce !== payload.nonce) throw new Error("oauth-state-invalid");
        if (url.searchParams.get("error")) throw new Error("google-authorization-denied");
        const tokens = await exchangeCode({ code: url.searchParams.get("code"), clientId: env.GOOGLE_WEB_CLIENT_ID, clientSecret: env.GOOGLE_WEB_CLIENT_SECRET, redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI });
        const profile = await googleProfile({ accessToken: tokens.access_token });
        const now = new Date().toISOString();
        await saveAccount(env.OAUTH_DB, { subject: profile.sub, envelope: await encryptTokenEnvelope(tokens, env.TOKEN_ENCRYPTION_KEY), scopes: tokens.scope ?? "", expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null, refreshTokenPresent: Boolean(tokens.refresh_token), now });
        const handoff = await createHandoff(env.OAUTH_DB, { code: crypto.randomUUID(), subject: profile.sub, now });
        const destination = new URL(payload.returnTo); destination.searchParams.set("oauth_handoff", handoff.code);
        if (payload.popup) return popupHandoff(destination, handoff.code);
        return redirect(destination.toString(), 303, "forget_me_not_oauth_nonce=; HttpOnly; Secure; SameSite=Lax; Path=/v1/oauth/google; Max-Age=0");
      } catch {
        if (payload?.popup) return popupFailure(payload.returnTo);
        return json({ error: "oauth-authorization-failed" }, 400);
      }
    }

    if (request.method === "POST" && url.pathname === "/v1/oauth/google/handoff/exchange") {
      const origin = request.headers.get("Origin");
      if (!isAllowedOrigin(origin, env.APP_ORIGINS)) return json({ error: "origin-not-allowed" }, 403);
      if (!hasRequiredConfiguration(env)) return json({ error: "oauth-not-configured" }, 503, corsHeaders(origin));
      const storage = await databaseStatus(env.OAUTH_DB);
      if (!storage.schemaReady) return json({ error: "storage-not-ready" }, 503, corsHeaders(origin));
      try {
        const body = await request.json();
        const handoff = String(body?.handoff ?? "");
        if (!handoff || handoff.length > 200) throw new Error("handoff-invalid");
        const now = new Date().toISOString();
        const subject = await consumeHandoff(env.OAUTH_DB, { code: handoff, now });
        if (!subject) return json({ error: "handoff-invalid-or-expired" }, 400, corsHeaders(origin));
        const token = crypto.randomUUID();
        const session = await createSession(env.OAUTH_DB, { token, subject, now });
        return json({ sessionToken: token, expiresAt: session.expiresAt }, 200, corsHeaders(origin));
      } catch (error) {
        if (error?.message === "handoff-invalid") return json({ error: "handoff-invalid-or-expired" }, 400, corsHeaders(origin));
        return json({ error: "handoff-exchange-failed" }, 500, corsHeaders(origin));
      }
    }

    if (request.method === "POST" && url.pathname === "/v1/drive/execute") {
      const origin = request.headers.get("Origin");
      if (!isAllowedOrigin(origin, env.APP_ORIGINS)) return json({ error: "origin-not-allowed" }, 403);
      if (!hasRequiredConfiguration(env)) return json({ error: "oauth-not-configured" }, 503, corsHeaders(origin));
      const storage = await databaseStatus(env.OAUTH_DB);
      if (!storage.schemaReady) return json({ error: "storage-not-ready" }, 503, corsHeaders(origin));
      try {
        const token = bearerToken(request.headers.get("Authorization"));
        if (!token) return json({ error: "session-required" }, 401, corsHeaders(origin));
        const now = new Date().toISOString();
        const account = await sessionAccount(env.OAUTH_DB, { token, now });
        if (!account) return json({ error: "session-expired" }, 401, corsHeaders(origin));
        const accessToken = await currentAccessToken(env, account, now);
        const body = await request.json();
        const result = await executeDriveOperation({ ...body, accessToken });
        return json({ result }, 200, corsHeaders(origin));
      } catch (error) {
        const message = String(error?.message ?? "");
        const status = message.startsWith("drive-") ? 400 : message.includes("google-token") ? 401 : 502;
        return json({ error: message.startsWith("drive-") || message.includes("google-token") ? message : "drive-request-failed" }, status, corsHeaders(origin));
      }
    }

    if (request.method === "POST" && url.pathname === "/v1/oauth/session/revoke") {
      const origin = request.headers.get("Origin");
      if (!isAllowedOrigin(origin, env.APP_ORIGINS)) return json({ error: "origin-not-allowed" }, 403);
      if (!hasRequiredConfiguration(env)) return json({ error: "oauth-not-configured" }, 503, corsHeaders(origin));
      const storage = await databaseStatus(env.OAUTH_DB);
      if (!storage.schemaReady) return json({ error: "storage-not-ready" }, 503, corsHeaders(origin));
      const token = bearerToken(request.headers.get("Authorization"));
      if (!token) return json({ error: "session-required" }, 401, corsHeaders(origin));
      try {
        await revokeSession(env.OAUTH_DB, { token, now: new Date().toISOString() });
        // Treat repeated logout as successful without revealing whether a token was valid.
        return json({ revoked: true }, 200, corsHeaders(origin));
      } catch {
        return json({ error: "session-revoke-failed" }, 500, corsHeaders(origin));
      }
    }

    if (url.pathname === "/v1/recovery/requests" || url.pathname.startsWith("/v1/recovery/requests/")) {
      const origin = request.headers.get("Origin");
      if (!isAllowedOrigin(origin, env.APP_ORIGINS)) return json({ error: "origin-not-allowed" }, 403);
      if (!hasRequiredConfiguration(env)) return json({ error: "oauth-not-configured" }, 503, corsHeaders(origin));
      if (!(await recoveryDatabaseStatus(env.OAUTH_DB)).ready) return json({ error: "recovery-storage-not-ready" }, 503, corsHeaders(origin));
      const token = bearerToken(request.headers.get("Authorization"));
      const account = token ? await sessionAccount(env.OAUTH_DB, { token, now: new Date().toISOString() }) : null;
      if (!account) return json({ error: "session-expired" }, 401, corsHeaders(origin));
      const now = new Date().toISOString();
      const suffix = url.pathname.slice("/v1/recovery/requests/".length);
      try {
        if (request.method === "POST" && url.pathname === "/v1/recovery/requests") {
          const body = await request.json();
          const vaultId = bounded(body?.vaultId, 200);
          const requesterDeviceId = bounded(body?.requesterDeviceId, 200);
          const pairingCode = bounded(body?.pairingCode, 80);
          const requesterPublicKey = validRecoveryPublicKey(body?.requesterPublicKey) ? body.requesterPublicKey : null;
          const baseSessionEpoch = Number(body?.baseSessionEpoch);
          if (!vaultId || !requesterDeviceId || !pairingCode || !requesterPublicKey || !Number.isSafeInteger(baseSessionEpoch) || baseSessionEpoch < 1) return json({ error: "recovery-request-invalid" }, 400, corsHeaders(origin));
          return json(await createRecoveryRequest(env.OAUTH_DB, { requestId: crypto.randomUUID(), subject: account.google_subject, vaultId, requesterDeviceId, pairingCode, requesterPublicKey, baseSessionEpoch, now }), 201, corsHeaders(origin));
        }
        if (request.method === "GET" && url.pathname === "/v1/recovery/requests") return json({ requests: await listRecoveryRequests(env.OAUTH_DB, { subject: account.google_subject, now }) }, 200, corsHeaders(origin));
        if (request.method === "GET" && suffix && !suffix.includes("/")) {
          const item = await recoveryRequest(env.OAUTH_DB, { requestId: suffix, subject: account.google_subject, now });
          return item ? json({ request: item }, 200, corsHeaders(origin)) : json({ error: "recovery-request-not-found" }, 404, corsHeaders(origin));
        }
        const approveId = suffix.endsWith("/approve") ? suffix.slice(0, -"/approve".length) : "";
        if (request.method === "POST" && approveId) {
          const body = await request.json();
          const approverDeviceId = bounded(body?.approverDeviceId, 200);
          const sessionEpoch = Number(body?.sessionEpoch);
          const transferEnvelope = validTransferEnvelope(body?.transferEnvelope) ? body.transferEnvelope : null;
          if (!approverDeviceId || !Number.isSafeInteger(sessionEpoch) || sessionEpoch < 1 || !transferEnvelope) return json({ error: "recovery-approval-invalid" }, 400, corsHeaders(origin));
          const verificationCode = recoveryVerificationCode();
          const verificationCodeSalt = base64Url(crypto.getRandomValues(new Uint8Array(16)));
          const verificationCodeHash = await recoveryVerificationHash(env.OAUTH_STATE_SIGNING_KEY, verificationCodeSalt, verificationCode);
          const item = await approveRecoveryRequest(env.OAUTH_DB, { requestId: approveId, subject: account.google_subject, approverDeviceId, sessionEpoch, transferEnvelope, verificationCodeHash, verificationCodeSalt, now });
          return item ? json({ request: item, verificationCode }, 200, corsHeaders(origin)) : json({ error: "recovery-request-not-pending-or-stale" }, 409, corsHeaders(origin));
        }
        const verifyId = suffix.endsWith("/verify") ? suffix.slice(0, -"/verify".length) : "";
        if (request.method === "POST" && verifyId) {
          const body = await request.json();
          const verificationCode = bounded(body?.verificationCode, 32).replace(/\s/g, "");
          const record = await recoveryVerificationRecord(env.OAUTH_DB, { requestId: verifyId, subject: account.google_subject, now });
          if (!record || record.status !== "transfer_ready" || !verificationCode) return json({ error: record?.status === "expired" ? "recovery-request-expired" : "recovery-request-not-ready" }, 409, corsHeaders(origin));
          const actualHash = await recoveryVerificationHash(env.OAUTH_STATE_SIGNING_KEY, record.verification_code_salt, verificationCode);
          if (!sameText(actualHash, record.verification_code_hash)) {
            const failed = await recordFailedVerification(env.OAUTH_DB, { requestId: verifyId, subject: account.google_subject });
            return json({ error: failed?.status === "expired" ? "recovery-verification-locked" : "recovery-verification-invalid", attemptsRemaining: Math.max(0, 5 - Number(failed?.verification_attempts ?? 5)) }, 401, corsHeaders(origin));
          }
          return json({ transferEnvelope: JSON.parse(record.transfer_envelope), baseSessionEpoch: record.base_session_epoch }, 200, corsHeaders(origin));
        }
        const completeId = suffix.endsWith("/complete") ? suffix.slice(0, -"/complete".length) : "";
        if (request.method === "POST" && completeId) {
          const body = await request.json();
          const baseSessionEpoch = Number(body?.baseSessionEpoch);
          const completedSessionEpoch = Number(body?.completedSessionEpoch);
          if (!Number.isSafeInteger(baseSessionEpoch) || !Number.isSafeInteger(completedSessionEpoch) || completedSessionEpoch <= baseSessionEpoch) return json({ error: "recovery-completion-invalid" }, 400, corsHeaders(origin));
          const item = await completeRecoveryRequest(env.OAUTH_DB, { requestId: completeId, subject: account.google_subject, baseSessionEpoch, completedSessionEpoch, now });
          return item ? json({ request: item }, 200, corsHeaders(origin)) : json({ error: "recovery-request-not-completable" }, 409, corsHeaders(origin));
        }
      } catch {
        return json({ error: "recovery-request-failed" }, 500, corsHeaders(origin));
      }
      return json({ error: "not-found" }, 404, corsHeaders(origin));
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const storage = await databaseStatus(env?.OAUTH_DB);
      return json({
        ok: true,
        service: SERVICE_NAME,
        oauthReady: hasRequiredConfiguration(env),
        storageReady: storage.ready,
        schemaReady: storage.schemaReady,
        recoveryPolicy: "recovery-v3-code-or-sealed-device-transfer"
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/oauth/google/configuration") {
      const storage = await databaseStatus(env?.OAUTH_DB);
      return json({
        oauthReady: hasRequiredConfiguration(env),
        missing: missingConfiguration(env),
        storageReady: storage.ready,
        message: "OAuth、短效 session 與受限 Drive proxy 只會在 Google 設定、Worker secrets 與 D1 schema 都完整時啟用。"
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/oauth/google/native/configuration") {
      const storage = await databaseStatus(env?.OAUTH_DB);
      return json({ nativeOAuthReady: hasNativeConfiguration(env), missing: missingNativeConfiguration(env), storageReady: storage.ready, schemaReady: storage.schemaReady, message: "原生 OAuth 需要已驗證的 HTTPS App Link、Android/iOS OAuth client 與 PKCE；未設定時原生 App 不會退回 WebView popup。" });
    }

    return json({ error: "not-found" }, 404);
  }
};

function hasRequiredConfiguration(env) {
  return missingConfiguration(env).length === 0;
}

function allowedReturnTo(value, origins) {
  try { return String(origins).split(",").map((item) => item.trim()).includes(new URL(value).origin); } catch { return false; }
}
function isAllowedOrigin(origin, origins) { return Boolean(origin) && String(origins ?? "").split(",").map((item) => item.trim()).includes(origin); }
function cookie(header, name) { return String(header ?? "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? ""; }
function bearerToken(header) { const match = /^Bearer\s+(.+)$/i.exec(String(header ?? "")); return match?.[1] ?? ""; }

function missingConfiguration(env) {
  return [...REQUIRED_PUBLIC_VALUES, ...REQUIRED_SECRETS].filter((name) => !String(env?.[name] ?? "").trim());
}
function missingNativeConfiguration(env) { return REQUIRED_NATIVE_VALUES.filter((name) => !String(env?.[name] ?? "").trim()); }
function hasNativeConfiguration(env) { return missingNativeConfiguration(env).length === 0; }
function validCodeChallenge(value) { return /^[A-Za-z0-9_-]{43,128}$/.test(value); }
function validCodeVerifier(value) { return /^[A-Za-z0-9._~-]{43,128}$/.test(value); }
function validRecoveryPublicKey(value) { return value?.kty === "RSA" && value?.alg === "RSA-OAEP-256" && typeof value?.n === "string" && value.n.length > 300 && typeof value?.e === "string"; }
function validTransferEnvelope(value) { return value?.version === 1 && value?.algorithm === "RSA-OAEP-256" && typeof value?.ciphertext === "string" && value.ciphertext.length > 100 && value.ciphertext.length < 4096; }
function recoveryVerificationCode() { return String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000000).padStart(8, "0"); }
async function recoveryVerificationHash(secret, salt, code) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${salt}:${code}`));
  return base64Url(new Uint8Array(signature));
}
async function pkceChallenge(verifier) { return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))); }
function sameText(left, right) { const a = new TextEncoder().encode(String(left)); const b = new TextEncoder().encode(String(right)); if (a.length !== b.length) return false; let result = 0; for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index]; return result === 0; }
function base64Url(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }

async function databaseStatus(database) {
  if (!database?.prepare) return { ready: false, schemaReady: false };
  try {
    await database.prepare("SELECT 1 AS ready").first();
    const tables = await database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('oauth_accounts', 'oauth_handoffs', 'oauth_sessions')")
      .all();
    const names = new Set((tables.results ?? []).map((row) => row.name));
    return { ready: true, schemaReady: names.has("oauth_accounts") && names.has("oauth_handoffs") && names.has("oauth_sessions") };
  } catch {
    return { ready: false, schemaReady: false };
  }
}

async function recoveryDatabaseStatus(database) {
  if (!database?.prepare) return { ready: false };
  try {
    const result = await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recovery_requests'").all();
    if (!(result.results ?? []).some((row) => row.name === "recovery_requests")) return { ready: false };
    const columns = await database.prepare("PRAGMA table_info(recovery_requests)").all();
    const names = new Set((columns.results ?? []).map((row) => row.name));
    return { ready: ["requester_public_key", "base_session_epoch", "verification_code_hash", "transfer_envelope", "completed_at"].every((name) => names.has(name)) };
  } catch { return { ready: false }; }
}

function corsHeaders(origin) { return { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization", vary: "Origin" }; }
function bounded(value, maxLength) { const text = String(value ?? "").trim(); return text && text.length <= maxLength ? text : ""; }
function redirect(location, status, setCookie) { return new Response(null, { status, headers: { location, "set-cookie": setCookie, "cache-control": "no-store" } }); }

function popupHandoff(destination, handoff) {
  return popupPage(destination, { type: "forget-me-not-oauth-handoff", handoff });
}

function popupFailure(returnTo) {
  return popupPage(new URL(returnTo), { type: "forget-me-not-oauth-handoff", error: "oauth-authorization-failed" });
}

function popupPage(destination, message) {
  const targetOrigin = destination.origin;
  const fallback = destination.toString();
  const script = `<!doctype html><meta charset="utf-8"><title>Google Drive 授權完成</title><p>Google Drive 授權完成，正在回到 App…</p><script>const message=${JSON.stringify(message)};const targetOrigin=${JSON.stringify(targetOrigin)};const fallback=${JSON.stringify(fallback)};if(window.opener){window.opener.postMessage(message,targetOrigin);window.setTimeout(()=>window.close(),750);}else{window.location.replace(fallback);}</script>`;
  return new Response(script, { status: 200, headers: { "content-type": "text/html; charset=UTF-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "set-cookie": "forget_me_not_oauth_nonce=; HttpOnly; Secure; SameSite=Lax; Path=/v1/oauth/google; Max-Age=0" } });
}

async function currentAccessToken(env, account, now) {
  const tokens = await decryptTokenEnvelope({ ciphertext: account.token_ciphertext, iv: account.token_iv }, env.TOKEN_ENCRYPTION_KEY);
  const expiresAt = Date.parse(account.token_expires_at ?? "");
  if (tokens.access_token && Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) return tokens.access_token;
  const refreshed = await refreshAccessToken({ refreshToken: tokens.refresh_token, clientId: env.GOOGLE_WEB_CLIENT_ID, clientSecret: env.GOOGLE_WEB_CLIENT_SECRET });
  const nextTokens = { ...tokens, ...refreshed, refresh_token: refreshed.refresh_token ?? tokens.refresh_token };
  await saveAccount(env.OAUTH_DB, {
    subject: account.google_subject,
    envelope: await encryptTokenEnvelope(nextTokens, env.TOKEN_ENCRYPTION_KEY),
    scopes: account.scopes,
    expiresAt: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString() : null,
    refreshTokenPresent: Boolean(nextTokens.refresh_token),
    now
  });
  return nextTokens.access_token;
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}
