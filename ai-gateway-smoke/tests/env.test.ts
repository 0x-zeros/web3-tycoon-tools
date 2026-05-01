import { test } from "node:test";
import assert from "node:assert/strict";

import { parseEnv } from "../src/utils/env.js";

test("parseEnv 在空环境下返回默认值", () => {
  const cfg = parseEnv({});
  assert.equal(cfg.baseUrl, "http://127.0.0.1:8787");
  assert.equal(cfg.modelAlias, "codex-default");
  assert.equal(cfg.apiToken, undefined);
});

test("parseEnv 接受自定义 base URL", () => {
  const cfg = parseEnv({ AI_GATEWAY_BASE_URL: "http://example.com:9000" });
  assert.equal(cfg.baseUrl, "http://example.com:9000");
});

test("parseEnv 去掉 base URL 末尾斜杠", () => {
  const cfg = parseEnv({ AI_GATEWAY_BASE_URL: "http://example.com:9000/" });
  assert.equal(cfg.baseUrl, "http://example.com:9000");
});

test("parseEnv 读取 API token", () => {
  const cfg = parseEnv({ AI_GATEWAY_API_TOKEN: "secret" });
  assert.equal(cfg.apiToken, "secret");
});

test("parseEnv 把空 API token 视作未设置", () => {
  const cfg = parseEnv({ AI_GATEWAY_API_TOKEN: "   " });
  assert.equal(cfg.apiToken, undefined);
});

test("parseEnv 读取自定义模型别名", () => {
  const cfg = parseEnv({ AI_GATEWAY_MODEL_ALIAS: "gpt-5-codex" });
  assert.equal(cfg.modelAlias, "gpt-5-codex");
});

test("parseEnv 在 base URL 非法时抛错", () => {
  assert.throws(
    () => parseEnv({ AI_GATEWAY_BASE_URL: "not a url" }),
    /AI_GATEWAY_BASE_URL/,
  );
});

test("parseEnv 在 base URL 协议非 http/https 时抛错", () => {
  assert.throws(
    () => parseEnv({ AI_GATEWAY_BASE_URL: "ftp://example.com" }),
    /http\/https/,
  );
});

test("parseEnv 忽略 base URL 前后空白", () => {
  const cfg = parseEnv({ AI_GATEWAY_BASE_URL: "  http://localhost:1234  " });
  assert.equal(cfg.baseUrl, "http://localhost:1234");
});
