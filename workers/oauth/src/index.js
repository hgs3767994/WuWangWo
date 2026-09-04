const SERVICE_NAME = "forget-me-not-oauth";
const REQUIRED_SECRETS = ["GOOGLE_WEB_CLIENT_SECRET", "OAUTH_STATE_SIGNING_KEY", "TOKEN_ENCRYPTION_KEY"];
const REQUIRED_PUBLIC_VALUES = ["APP_ORIGINS", "GOOGLE_WEB_CLIENT_ID", "GOOGLE_OAUTH_REDIRECT_URI"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

function missingConfiguration(env) {
  return [...REQUIRED_PUBLIC_VALUES, ...REQUIRED_SECRETS].filter((name) => !String(env?.[name] ?? "").trim());
}

async function databaseStatus(database) {
  if (!database?.prepare) return { ready: false, schemaReady: false };
  try {
    await database.prepare("SELECT 1 AS ready").first();
    const tables = await database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('oauth_accounts', 'oauth_handoffs')")
      .all();
    const names = new Set((tables.results ?? []).map((row) => row.name));
    return { ready: true, schemaReady: names.has("oauth_accounts") && names.has("oauth_handoffs") };
  } catch {
    return { ready: false, schemaReady: false };
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}
