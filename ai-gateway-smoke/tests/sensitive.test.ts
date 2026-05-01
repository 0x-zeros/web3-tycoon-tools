import { test } from "node:test";
import assert from "node:assert/strict";

import { scanSensitive } from "../src/utils/sensitive.js";

test("scanSensitive 干净字符串返回 found=false", () => {
  const result = scanSensitive("ok=true");
  assert.equal(result.found, false);
  assert.deepEqual(result.matches, []);
});

test("scanSensitive 检测三段 JWT", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature1234567890";
  const result = scanSensitive(`token=${jwt}`);
  assert.equal(result.found, true);
  assert.equal(result.matches.length, 1);
  assert.ok(result.matches[0].startsWith("eyJ"));
});

test("scanSensitive 检测 Bearer 头", () => {
  const result = scanSensitive("Authorization: Bearer abcdef0123456789xyzABCDEF");
  assert.equal(result.found, true);
  assert.ok(result.matches.some((m) => m.startsWith("Bearer ")));
});

test("scanSensitive 不会把短 eyJ 误报为 JWT", () => {
  const result = scanSensitive("eyJ.short");
  assert.equal(result.found, false);
});

test("scanSensitive 递归扫描对象", () => {
  const jwt = "eyJaaaaaaaaaa.bbbbbbbbbb.cccccccccc";
  const result = scanSensitive({
    auth: { loggedIn: true, accessToken: jwt },
    safe: "value",
  });
  assert.equal(result.found, true);
  assert.equal(result.matches[0], jwt);
});

test("scanSensitive 递归扫描数组", () => {
  const result = scanSensitive([
    "a",
    { nested: ["b", "Bearer 0123456789abcdefghij"] },
  ]);
  assert.equal(result.found, true);
});

test("scanSensitive 命中自定义 knownStrings", () => {
  const result = scanSensitive("hello world", { knownStrings: ["world"] });
  assert.equal(result.found, true);
  assert.deepEqual(result.matches, ["world"]);
});

test("scanSensitive 忽略空 knownStrings", () => {
  const result = scanSensitive("hello", { knownStrings: ["", "  "] });
  assert.equal(result.found, false);
});

test("scanSensitive 处理 null/undefined 不抛错", () => {
  assert.equal(scanSensitive(null).found, false);
  assert.equal(scanSensitive(undefined).found, false);
});

test("scanSensitive 命中自定义 extraPatterns", () => {
  const result = scanSensitive("debug=secret123", {
    extraPatterns: [/secret\d+/],
  });
  assert.equal(result.found, true);
  assert.ok(result.matches.includes("secret123"));
});
