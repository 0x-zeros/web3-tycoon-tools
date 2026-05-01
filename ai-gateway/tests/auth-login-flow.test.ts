import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import { resolveGatewayPaths } from "../src/util/home.js";
import { completeOAuthLoginWithCode } from "../src/auth/oauth.js";
import { loadCredentialStore } from "../src/auth/credential-store.js";
import { DEFAULT_PROFILE_ID } from "../src/auth/types.js";

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeJwt(payload: object): string {
  return `${b64url({ alg: "none" })}.${b64url(payload)}.signature`;
}

async function tempHome(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "ai-gateway-login-"));
}

test("completeOAuthLoginWithCode 交换 code 后写入 token sink，source.mode = gateway-oauth", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          access_token: fakeJwt({
            exp: 4102444800,
            email: "user@example.com",
            "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" },
          }),
          refresh_token: "refresh",
          expires_in: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    await completeOAuthLoginWithCode({
      paths,
      fetchFn,
      tokenUrl: "https://auth.openai.com/oauth/token",
      clientId: "client",
      code: "code",
      codeVerifier: "verifier",
      redirectUri: "http://127.0.0.1:1455/auth/callback",
    });
    const store = await loadCredentialStore(paths);
    const profile = store.profiles[DEFAULT_PROFILE_ID];
    assert.equal(profile.source.mode, "gateway-oauth");
    assert.equal(profile.source.importedFrom, null);
    assert.equal(profile.source.importedAt, null);
    assert.equal(profile.tokens.refreshToken, "refresh");
    assert.equal(profile.account.email, "user@example.com");
    assert.equal(profile.account.accountId, "acct_1");
    assert.equal(profile.lastRefresh.status, "never");
    assert.equal((await stat(paths.credentialsPath)).mode & 0o777, 0o600);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("completeOAuthLoginWithCode 上游错误时不会写入 credentials.json", async () => {
  const home = await tempHome();
  try {
    const paths = resolveGatewayPaths({ AI_GATEWAY_HOME: home });
    const fetchFn: typeof fetch = async () => new Response("server error", { status: 500 });
    await assert.rejects(
      () =>
        completeOAuthLoginWithCode({
          paths,
          fetchFn,
          tokenUrl: "https://auth.openai.com/oauth/token",
          clientId: "client",
          code: "code",
          codeVerifier: "verifier",
          redirectUri: "http://127.0.0.1:1455/auth/callback",
        }),
      /oauth_token_exchange_failed/,
    );
    const store = await loadCredentialStore(paths);
    assert.deepEqual(store.profiles, {});
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
