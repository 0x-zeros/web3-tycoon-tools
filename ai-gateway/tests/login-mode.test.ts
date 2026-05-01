import test from "node:test";
import assert from "node:assert/strict";
import { promptLoginMode } from "../src/cli/login-mode.js";

function makeReader(answers: string[]): () => Promise<string> {
  return async () => {
    if (answers.length === 0) {
      throw new Error("reader exhausted");
    }
    return answers.shift()!;
  };
}

function captureLines(): { lines: string[]; print: (line: string) => void } {
  const lines: string[] = [];
  return { lines, print: (line: string) => lines.push(line) };
}

test("promptLoginMode 输入 1 选 loopback", async () => {
  const { print } = captureLines();
  const result = await promptLoginMode({ read: makeReader(["1"]), print });
  assert.equal(result, "loopback");
});

test("promptLoginMode 输入 2 选 device", async () => {
  const { print } = captureLines();
  const result = await promptLoginMode({ read: makeReader(["2"]), print });
  assert.equal(result, "device");
});

test("promptLoginMode 直接回车（空串）默认 loopback", async () => {
  const { print } = captureLines();
  const result = await promptLoginMode({ read: makeReader([""]), print });
  assert.equal(result, "loopback");
});

test("promptLoginMode trim 输入空白后再判定", async () => {
  const { print } = captureLines();
  const result = await promptLoginMode({ read: makeReader(["  2  "]), print });
  assert.equal(result, "device");
});

test("promptLoginMode 无效输入会重新询问", async () => {
  const { print, lines } = captureLines();
  const result = await promptLoginMode({
    read: makeReader(["abc", "9", "2"]),
    print,
  });
  assert.equal(result, "device");
  // 至少应该出现两次"无效输入"提示
  const invalidHits = lines.filter((l) => /无效输入/.test(l));
  assert.equal(invalidHits.length, 2);
});

test("promptLoginMode 打印两种方式的优点和适用范围", async () => {
  const { print, lines } = captureLines();
  await promptLoginMode({ read: makeReader(["1"]), print });
  const text = lines.join("\n");
  // 面向用户的关键信息必须存在 — UX 契约
  assert.match(text, /loopback|浏览器自动回调/);
  assert.match(text, /device|设备码/i);
  assert.match(text, /优点/);
  assert.match(text, /适用/);
  assert.match(text, /headless|SSH|devcontainer|端口转发/);
});
