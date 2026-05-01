import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import { redactValue } from "../src/logging/redact.js";
import { RequestLogger } from "../src/logging/request-log.js";

async function tempDir(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "ai-gateway-log-"));
}

test("redactValue 脱敏 token 和 Authorization", () => {
  const redacted = redactValue({
    authorization: "Bearer access-secret",
    accessToken: "access-secret",
    refresh_token: "refresh-secret",
    nested: { refreshToken: "refresh-secret", id_token: "id-secret" },
    arrayed: [{ access_token: "access-secret" }],
  });
  const text = JSON.stringify(redacted);
  assert.equal(text.includes("access-secret"), false);
  assert.equal(text.includes("refresh-secret"), false);
  assert.equal(text.includes("id-secret"), false);
  assert.equal(text.includes("[REDACTED]"), true);
});

test("redactValue 把 Bearer 前缀的字符串值替换为 Bearer [REDACTED]", () => {
  assert.equal(redactValue("Bearer abc.def"), "Bearer [REDACTED]");
  assert.equal(redactValue("not bearer abc"), "not bearer abc");
});

test("redactValue 不修改普通对象的非敏感字段", () => {
  const value = { input: "hello", nested: { extra: 42 } };
  assert.deepEqual(redactValue(value), value);
});

test("redactValue 不爆栈也不破坏原对象（不可变）", () => {
  const original = {
    accessToken: "secret",
    inner: { refresh_token: "secret2" },
  };
  const cloned = JSON.parse(JSON.stringify(original));
  redactValue(original);
  assert.deepEqual(original, cloned, "redact 应纯函数，不修改原对象");
});

test("默认日志只写摘要", async () => {
  const dir = await tempDir();
  try {
    const logger = new RequestLogger({ logsDir: dir, debugCapture: false });
    await logger.logRequest({
      requestId: "req_1",
      modelAlias: "codex-default",
      upstreamModel: "real-model",
      statusCode: 200,
      durationMs: 12,
      errorCode: null,
      requestBody: { input: "secret prompt" },
      responseBody: { output: "secret answer" },
    });
    const raw = await readFile(path.join(dir, "requests.jsonl"), "utf8");
    assert.equal(raw.includes("secret prompt"), false);
    assert.equal(raw.includes("secret answer"), false);
    assert.equal(raw.includes("codex-default"), true);
    assert.equal(raw.includes("real-model"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("requests.jsonl 文件权限为 0600，logs 目录权限为 0700", async () => {
  const dir = await tempDir();
  try {
    const subDir = path.join(dir, "logs");
    const logger = new RequestLogger({ logsDir: subDir, debugCapture: false });
    await logger.logRequest({
      requestId: "req_1",
      modelAlias: "codex-default",
      upstreamModel: "real-model",
      statusCode: 200,
      durationMs: 1,
      errorCode: null,
      requestBody: null,
      responseBody: null,
    });
    assert.equal((await stat(subDir)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(subDir, "requests.jsonl"))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("debug capture 显式开启时保存脱敏正文", async () => {
  const dir = await tempDir();
  try {
    const logger = new RequestLogger({ logsDir: dir, debugCapture: true });
    await logger.logRequest({
      requestId: "req_1",
      modelAlias: "codex-default",
      upstreamModel: "real-model",
      statusCode: 200,
      durationMs: 12,
      errorCode: null,
      requestBody: { input: "debug prompt", accessToken: "access-secret" },
      responseBody: { output: "debug answer", refreshToken: "refresh-secret" },
    });
    const raw = await readFile(path.join(dir, "debug-capture.jsonl"), "utf8");
    assert.equal(raw.includes("debug prompt"), true);
    assert.equal(raw.includes("debug answer"), true);
    assert.equal(raw.includes("access-secret"), false);
    assert.equal(raw.includes("refresh-secret"), false);
    assert.equal(raw.includes("[REDACTED]"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("多次 logRequest 追加而不覆盖", async () => {
  const dir = await tempDir();
  try {
    const logger = new RequestLogger({ logsDir: dir, debugCapture: false });
    for (let i = 0; i < 3; i += 1) {
      await logger.logRequest({
        requestId: `req_${i}`,
        modelAlias: "codex-default",
        upstreamModel: "real-model",
        statusCode: 200,
        durationMs: 1,
        errorCode: null,
        requestBody: null,
        responseBody: null,
      });
    }
    const raw = await readFile(path.join(dir, "requests.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
