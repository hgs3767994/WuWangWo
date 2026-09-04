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
    recoveryPolicy: "recovery-code-authorizes-reset-only"
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
