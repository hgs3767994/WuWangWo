import assert from "node:assert/strict";
import test from "node:test";
import { createOAuthState, verifyOAuthState } from "../src/oauth-state.js";

test("OAuth state is signed and expires", async () => {
  const state = await createOAuthState({ returnTo: "https://hgs3767994.github.io/WuWangWo/", nonce: "nonce", secret: "test-secret", now: 1000, lifetimeMs: 100 });
  assert.deepEqual(await verifyOAuthState({ state, secret: "test-secret", now: 1100 }), { returnTo: "https://hgs3767994.github.io/WuWangWo/", nonce: "nonce", popup: false, expiresAt: 1100 });
  await assert.rejects(() => verifyOAuthState({ state, secret: "test-secret", now: 1101 }), /oauth-state-expired/);
  await assert.rejects(() => verifyOAuthState({ state: `${state}x`, secret: "test-secret", now: 1001 }), /oauth-state-invalid/);
});

test("OAuth state signs popup mode instead of trusting a later callback query", async () => {
  const state = await createOAuthState({ returnTo: "https://example.test/app", nonce: "nonce", popup: true, secret: "test-secret", now: 1000 });
  assert.equal((await verifyOAuthState({ state, secret: "test-secret", now: 1001 })).popup, true);
});
