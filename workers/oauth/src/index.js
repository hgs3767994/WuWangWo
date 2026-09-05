import { authorizationUrl, exchangeCode, googleProfile, refreshAccessToken } from "./google-oauth.js";
import { createOAuthState } from "./oauth-state.js";
import { verifyOAuthState } from "./oauth-state.js";
import { decryptTokenEnvelope, encryptTokenEnvelope } from "./token-envelope.js";
import { consumeHandoff, createHandoff, createSession, revokeSession, saveAccount, sessionAccount } from "./oauth-store.js";
import { executeDriveOperation } from "./drive-proxy.js";
import { approveRecoveryRequest, createRecoveryRequest, listRecoveryRequests, recoveryRequest } from "./recovery-store.js";

const SERVICE_NAME = "forget-me-not-oauth";
const REQUIRED_SECRETS = ["GOOGLE_WEB_CLIENT_SECRET", "OAUTH_STATE_SIGNING_KEY", "TOKEN_ENCRYPTION_KEY"];
const REQUIRED_PUBLIC_VALUES = ["APP_ORIGINS", "GOOGLE_WEB_CLIENT_ID", "GOOGLE_OAUTH_REDIRECT_URI"];

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
          if (!vaultId || !requesterDeviceId || !pairingCode) return json({ error: "recovery-request-invalid" }, 400, corsHeaders(origin));
          return json(await createRecoveryRequest(env.OAUTH_DB, { requestId: crypto.randomUUID(), subject: account.google_subject, vaultId, requesterDeviceId, pairingCode, now }), 201, corsHeaders(origin));
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
          if (!approverDeviceId || !Number.isSafeInteger(sessionEpoch) || sessionEpoch < 1) return json({ error: "recovery-approval-invalid" }, 400, corsHeaders(origin));
          const item = await approveRecoveryRequest(env.OAUTH_DB, { requestId: approveId, subject: account.google_subject, approverDeviceId, sessionEpoch, now });
          return item ? json({ request: item }, 200, corsHeaders(origin)) : json({ error: "recovery-request-not-pending" }, 409, corsHeaders(origin));
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
        recoveryPolicy: "recovery-code-authorizes-reset-only"
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
    return { ready: (result.results ?? []).some((row) => row.name === "recovery_requests") };
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
