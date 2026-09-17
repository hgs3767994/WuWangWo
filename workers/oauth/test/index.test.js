import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

test("health endpoint is available without OAuth configuration", async () => {
  const response = await worker.fetch(new Request("https://example.test/health"), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "forget-me-not-oauth",
    oauthReady: false,
    storageReady: false,
    schemaReady: false,
    recoveryPolicy: "recovery-v3-code-or-sealed-device-transfer"
  });
});

test("health endpoint verifies an attached D1 database without writing data", async () => {
  const queries = [];
  const database = {
    prepare(query) {
      queries.push(query);
      return query === "SELECT 1 AS ready"
        ? { first: async () => ({ ready: 1 }) }
        : { all: async () => ({ results: [{ name: "oauth_accounts" }, { name: "oauth_handoffs" }, { name: "oauth_sessions" }] }) };
    }
  };
  const response = await worker.fetch(new Request("https://example.test/health"), { OAUTH_DB: database });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).storageReady, true);
  assert.equal((await worker.fetch(new Request("https://example.test/health"), { OAUTH_DB: database })).status, 200);
  assert.deepEqual(queries, ["SELECT 1 AS ready", "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('oauth_accounts', 'oauth_handoffs', 'oauth_sessions')", "SELECT 1 AS ready", "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('oauth_accounts', 'oauth_handoffs', 'oauth_sessions')"]);
});

test("configuration endpoint names missing values without exposing any secret", async () => {
  const response = await worker.fetch(new Request("https://example.test/v1/oauth/google/configuration"), {
    APP_ORIGINS: "https://example.test",
    GOOGLE_WEB_CLIENT_ID: "public-client-id",
    GOOGLE_OAUTH_REDIRECT_URI: "https://example.test/callback",
    OAUTH_DB: { prepare: (query) => query === "SELECT 1 AS ready" ? { first: async () => ({ ready: 1 }) } : { all: async () => ({ results: [] }) } }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.oauthReady, false);
  assert.equal(body.storageReady, true);
  assert.deepEqual(body.missing, ["GOOGLE_WEB_CLIENT_SECRET", "OAUTH_STATE_SIGNING_KEY", "TOKEN_ENCRYPTION_KEY"]);
  assert(!JSON.stringify(body).includes("public-client-id"));
});

test("OAuth start remains unavailable without complete configuration", async () => {
  const response = await worker.fetch(new Request("https://example.test/v1/oauth/google/start"), {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "oauth-not-configured" });
});

test("native OAuth reports the same secure backend prerequisites as web OAuth", async () => {
  const response = await worker.fetch(new Request("https://example.test/v1/oauth/google/native/configuration"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.nativeOAuthReady, false);
  assert(body.missing.includes("GOOGLE_WEB_CLIENT_ID"));
  assert(body.missing.includes("GOOGLE_WEB_CLIENT_SECRET"));
  assert.match(body.message, /AuthorizationClient/);
});

test("OAuth start refuses to begin before the D1 session schema is ready", async () => {
  const response = await worker.fetch(new Request("https://example.test/v1/oauth/google/start?return_to=https://example.test/app"), {
    APP_ORIGINS: "https://example.test",
    GOOGLE_WEB_CLIENT_ID: "public-client-id",
    GOOGLE_OAUTH_REDIRECT_URI: "https://example.test/callback",
    GOOGLE_WEB_CLIENT_SECRET: "secret",
    OAUTH_STATE_SIGNING_KEY: "state-key",
    TOKEN_ENCRYPTION_KEY: "encryption-key",
    OAUTH_DB: { prepare: (query) => query === "SELECT 1 AS ready" ? { first: async () => ({ ready: 1 }) } : { all: async () => ({ results: [] }) } }
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "storage-not-ready" });
});

test("OAuth start redirects with a nonce cookie instead of throwing", async () => {
  const database = {
    prepare: (query) => query === "SELECT 1 AS ready"
      ? { first: async () => ({ ready: 1 }) }
      : { all: async () => ({ results: [{ name: "oauth_accounts" }, { name: "oauth_handoffs" }, { name: "oauth_sessions" }] }) }
  };
  const response = await worker.fetch(new Request("https://example.test/v1/oauth/google/start?return_to=https://example.test/app"), {
    APP_ORIGINS: "https://example.test",
    GOOGLE_WEB_CLIENT_ID: "public-client-id",
    GOOGLE_OAUTH_REDIRECT_URI: "https://example.test/callback",
    GOOGLE_WEB_CLIENT_SECRET: "secret",
    OAUTH_STATE_SIGNING_KEY: "state-key",
    TOKEN_ENCRYPTION_KEY: "encryption-key",
    OAUTH_DB: database
  });
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).origin, "https://accounts.google.com");
  assert.match(response.headers.get("set-cookie"), /^forget_me_not_oauth_nonce=/);
});

test("web OAuth handoff creates a short-lived HttpOnly Worker session cookie", async () => {
  const database = {
    prepare(query) {
      if (query === "SELECT 1 AS ready") return { first: async () => ({ ready: 1 }) };
      if (query.includes("sqlite_master")) return { all: async () => ({ results: [{ name: "oauth_accounts" }, { name: "oauth_handoffs" }, { name: "oauth_sessions" }] }) };
      if (query.startsWith("UPDATE oauth_handoffs")) return { bind: () => ({ first: async () => ({ google_subject: "subject-1" }) }) };
      if (query.startsWith("INSERT INTO oauth_sessions")) return { bind: () => ({ run: async () => ({ success: true }) }) };
      throw new Error(`unexpected query: ${query}`);
    }
  };
  const response = await worker.fetch(new Request("https://example.test/v1/oauth/google/handoff/exchange", {
    method: "POST",
    headers: { Origin: "https://example.test", "content-type": "application/json" },
    body: JSON.stringify({ handoff: "single-use-handoff" })
  }), {
    APP_ORIGINS: "https://example.test",
    GOOGLE_WEB_CLIENT_ID: "public-client-id",
    GOOGLE_OAUTH_REDIRECT_URI: "https://example.test/callback",
    GOOGLE_WEB_CLIENT_SECRET: "secret",
    OAUTH_STATE_SIGNING_KEY: "state-key",
    TOKEN_ENCRYPTION_KEY: "encryption-key",
    OAUTH_DB: database
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(typeof payload.sessionToken, "string");
  assert.match(response.headers.get("set-cookie"), /^forget_me_not_worker_session=.*HttpOnly; Secure; SameSite=None; Path=\/v1; Max-Age=/);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});

test("native OAuth exchanges a one-time server auth code without exposing Google tokens", async () => {
  const writes = [];
  const database = {
    prepare(query) {
      if (query === "SELECT 1 AS ready") return { first: async () => ({ ready: 1 }) };
      if (query.includes("sqlite_master")) {
        return { all: async () => ({ results: [{ name: "oauth_accounts" }, { name: "oauth_handoffs" }, { name: "oauth_sessions" }] }) };
      }
      if (query.startsWith("SELECT google_subject")) {
        return { bind: () => ({ first: async () => null }) };
      }
      return {
        bind: (...values) => ({
          run: async () => { writes.push({ query, values }); }
        })
      };
    }
  };
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url) === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "google-access-token", refresh_token: "google-refresh-token", expires_in: 3600, scope: "drive.appdata openid email" });
    }
    if (String(url) === "https://openidconnect.googleapis.com/v1/userinfo") {
      return Response.json({ sub: "google-subject", email: "person@example.test" });
    }
    return new Response(null, { status: 404 });
  };

  try {
    const response = await worker.fetch(new Request("https://example.test/v1/oauth/google/native/exchange", {
      method: "POST",
      headers: { Origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify({ server_auth_code: "single-use-code" })
    }), {
      APP_ORIGINS: "https://example.test",
      GOOGLE_WEB_CLIENT_ID: "server-client.apps.googleusercontent.com",
      GOOGLE_OAUTH_REDIRECT_URI: "https://example.test/callback",
      GOOGLE_WEB_CLIENT_SECRET: "worker-only-secret",
      OAUTH_STATE_SIGNING_KEY: "state-key",
      TOKEN_ENCRYPTION_KEY: "encryption-key",
      OAUTH_DB: database
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.accountEmail, "person@example.test");
    assert.equal(typeof payload.sessionToken, "string");
    assert.equal(requests.length, 2);
    const tokenBody = new URLSearchParams(requests[0].options.body);
    assert.equal(tokenBody.get("code"), "single-use-code");
    assert.equal(tokenBody.get("client_secret"), "worker-only-secret");
    assert.equal(tokenBody.get("redirect_uri"), "");
    assert.equal(requests[1].options.headers.Authorization, "Bearer google-access-token");
    assert.equal(writes.length, 2);
    assert(!JSON.stringify(writes).includes("google-refresh-token"));
    assert(!JSON.stringify(writes).includes("google-access-token"));
    assert(!JSON.stringify(payload).includes("google-refresh-token"));
    assert(!JSON.stringify(payload).includes("google-access-token"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("session revoke accepts an opaque Bearer token and does not store its plaintext", async () => {
  const calls = [];
  const database = {
    prepare(query) {
      calls.push(query);
      if (query === "SELECT 1 AS ready") return { first: async () => ({ ready: 1 }) };
      if (query.includes("sqlite_master")) return { all: async () => ({ results: [{ name: "oauth_accounts" }, { name: "oauth_handoffs" }, { name: "oauth_sessions" }] }) };
      return { bind: (...values) => ({ first: async () => ({ google_subject: "subject-1" }), values }) };
    }
  };
  const response = await worker.fetch(new Request("https://example.test/v1/oauth/session/revoke", {
    method: "POST",
    headers: { Origin: "https://example.test", Authorization: "Bearer opaque-session" }
  }), {
    APP_ORIGINS: "https://example.test",
    GOOGLE_WEB_CLIENT_ID: "public-client-id",
    GOOGLE_OAUTH_REDIRECT_URI: "https://example.test/callback",
    GOOGLE_WEB_CLIENT_SECRET: "secret",
    OAUTH_STATE_SIGNING_KEY: "state-key",
    TOKEN_ENCRYPTION_KEY: "encryption-key",
    OAUTH_DB: database
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revoked: true });
  assert(calls.some((query) => query.includes("UPDATE oauth_sessions SET revoked_at")));
});

test("session revoke accepts the HttpOnly PWA session cookie", async () => {
  const database = {
    prepare(query) {
      if (query === "SELECT 1 AS ready") return { first: async () => ({ ready: 1 }) };
      if (query.includes("sqlite_master")) return { all: async () => ({ results: [{ name: "oauth_accounts" }, { name: "oauth_handoffs" }, { name: "oauth_sessions" }] }) };
      return { bind: () => ({ first: async () => ({ google_subject: "subject-1" }) }) };
    }
  };
  const response = await worker.fetch(new Request("https://example.test/v1/oauth/session/revoke", {
    method: "POST",
    headers: { Origin: "https://example.test", Cookie: "forget_me_not_worker_session=opaque-cookie-session" }
  }), {
    APP_ORIGINS: "https://example.test",
    GOOGLE_WEB_CLIENT_ID: "public-client-id",
    GOOGLE_OAUTH_REDIRECT_URI: "https://example.test/callback",
    GOOGLE_WEB_CLIENT_SECRET: "secret",
    OAUTH_STATE_SIGNING_KEY: "state-key",
    TOKEN_ENCRYPTION_KEY: "encryption-key",
    OAUTH_DB: database
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revoked: true });
  assert.match(response.headers.get("set-cookie"), /Max-Age=0$/);
});
