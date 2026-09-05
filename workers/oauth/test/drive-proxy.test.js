import assert from "node:assert/strict";
import test from "node:test";
import { executeDriveOperation } from "../src/drive-proxy.js";

test("Drive proxy limits access to app-owned encrypted file names", async () => {
  await assert.rejects(() => executeDriveOperation({ operation: "read", name: "other-user-file.txt", accessToken: "token" }), /drive-file-name-invalid/);
});

test("Drive proxy reads a named appData file without returning a Google token", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.includes("/files?")) return new Response(JSON.stringify({ files: [{ id: "file-id", name: "vault.enc" }] }), { headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ ciphertext: "encrypted-vault" }), { headers: { "content-type": "application/json" } });
  };
  assert.deepEqual(await executeDriveOperation({ operation: "read", name: "vault.enc", accessToken: "token", fetchImpl }), { ciphertext: "encrypted-vault" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.Authorization, "Bearer token");
});

test("Drive proxy reads the Google profile without attempting a file-name lookup", async () => {
  const requests = [];
  const profile = await executeDriveOperation({
    operation: "profile",
    accessToken: "token",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ sub: "subject", email: "user@example.test" }), { headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(profile.email, "user@example.test");
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /openidconnect\.googleapis\.com/);
});
