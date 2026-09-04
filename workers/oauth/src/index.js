import { authorizationUrl, exchangeCode, googleProfile } from "./google-oauth.js";
import { createOAuthState } from "./oauth-state.js";
import { verifyOAuthState } from "./oauth-state.js";
import { encryptTokenEnvelope } from "./token-envelope.js";
import { consumeHandoff, createHandoff, createSession, saveAccount } from "./oauth-store.js";

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
      const returnTo = url.searchParams.get("return_to") ?? "";
      if (!allowedReturnTo(returnTo, env.APP_ORIGINS)) return json({ error: "invalid-return-to" }, 400);
      const nonce = crypto.randomUUID();
      const state = await createOAuthState({ returnTo, nonce, secret: env.OAUTH_STATE_SIGNING_KEY });
      const response = Response.redirect(authorizationUrl({ clientId: env.GOOGLE_WEB_CLIENT_ID, redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI, state }), 302);
      response.headers.set("Set-Cookie", `forget_me_not_oauth_nonce=${nonce}; HttpOnly; Secure; SameSite=Lax; Path=/v1/oauth/google; Max-Age=600`);
      return response;
    }

    if (request.method === "GET" && url.pathname === "/v1/oauth/google/callback") {
      const state = url.searchParams.get("state");
      const cookieNonce = cookie(request.headers.get("Cookie"), "forget_me_not_oauth_nonce");
      try {
        const payload = await verifyOAuthState({ state, secret: env.OAUTH_STATE_SIGNING_KEY });
        if (!cookieNonce || cookieNonce !== payload.nonce) throw new Error("oauth-state-invalid");
        if (url.searchParams.get("error")) throw new Error("google-authorization-denied");
        const tokens = await exchangeCode({ code: url.searchParams.get("code"), clientId: env.GOOGLE_WEB_CLIENT_ID, clientSecret: env.GOOGLE_WEB_CLIENT_SECRET, redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI });
        const profile = await googleProfile({ accessToken: tokens.access_token });
        const now = new Date().toISOString();
        await saveAccount(env.OAUTH_DB, { subject: profile.sub, envelope: await encryptTokenEnvelope(tokens, env.TOKEN_ENCRYPTION_KEY), scopes: tokens.scope ?? "", expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null, refreshTokenPresent: Boolean(tokens.refresh_token), now });
        const handoff = await createHandoff(env.OAUTH_DB, { code: crypto.randomUUID(), subject: profile.sub, now });
        const destination = new URL(payload.returnTo); destination.searchParams.set("oauth_handoff", handoff.code);
        const response = Response.redirect(destination, 303);
        response.headers.set("Set-Cookie", "forget_me_not_oauth_nonce=; HttpOnly; Secure; SameSite=Lax; Path=/v1/oauth/google; Max-Age=0");
        return response;
      } catch { return json({ error: "oauth-authorization-failed" }, 400); }
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
        message: "OAuth code exchange is intentionally disabled until the Google clients, callback URL, and Worker secrets are configured."
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

function corsHeaders(origin) { return { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", vary: "Origin" }; }

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
