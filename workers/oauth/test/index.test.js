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
    recoveryPolicy: "recovery-code-authorizes-reset-only"
  });
});

test("configuration endpoint names missing values without exposing any secret", async () => {
  const response = await worker.fetch(new Request("https://example.test/v1/oauth/google/configuration"), {
    APP_ORIGINS: "https://example.test",
    GOOGLE_WEB_CLIENT_ID: "public-client-id",
    GOOGLE_OAUTH_REDIRECT_URI: "https://example.test/callback"
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.oauthReady, false);
  assert.deepEqual(body.missing, ["GOOGLE_WEB_CLIENT_SECRET", "OAUTH_STATE_SIGNING_KEY", "TOKEN_ENCRYPTION_KEY"]);
  assert(!JSON.stringify(body).includes("public-client-id"));
});

test("unknown endpoints do not accidentally begin an OAuth flow", async () => {
  const response = await worker.fetch(new Request("https://example.test/v1/oauth/google/start"), {});
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not-found" });
});
