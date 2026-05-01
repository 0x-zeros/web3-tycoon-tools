import test from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs } from "../src/cli/index.js";

test("parseCliArgs 识别 auth status", () => {
  assert.deepEqual(parseCliArgs(["auth", "status"]), { command: "auth:status" });
});

test("parseCliArgs 识别 auth login", () => {
  assert.deepEqual(parseCliArgs(["auth", "login"]), { command: "auth:login" });
});

test("parseCliArgs 识别 import-codex-cli takeover", () => {
  assert.deepEqual(parseCliArgs(["auth", "import-codex-cli", "--takeover"]), {
    command: "auth:import-codex-cli",
    takeover: true,
  });
});

test("parseCliArgs 在缺 --takeover 时仍解析为 takeover=false", () => {
  assert.deepEqual(parseCliArgs(["auth", "import-codex-cli"]), {
    command: "auth:import-codex-cli",
    takeover: false,
  });
});

test("parseCliArgs 识别 serve host 和 port", () => {
  assert.deepEqual(parseCliArgs(["serve", "--host", "0.0.0.0", "--port", "9999"]), {
    command: "serve",
    host: "0.0.0.0",
    port: 9999,
  });
});

test("parseCliArgs serve 不带参数返回 host/port 为 undefined", () => {
  assert.deepEqual(parseCliArgs(["serve"]), { command: "serve", host: undefined, port: undefined });
});

test("parseCliArgs 跳过 pnpm 透传的 -- 分隔符", () => {
  assert.deepEqual(parseCliArgs(["--", "auth", "status"]), { command: "auth:status" });
  assert.deepEqual(parseCliArgs(["--", "serve", "--host", "0.0.0.0", "--port", "9999"]), {
    command: "serve",
    host: "0.0.0.0",
    port: 9999,
  });
});

test("parseCliArgs 拒绝未知命令", () => {
  assert.throws(() => parseCliArgs(["bad"]), /未知命令/);
  assert.throws(() => parseCliArgs([]), /未知命令/);
  assert.throws(() => parseCliArgs(["auth", "bad"]), /未知命令/);
});
