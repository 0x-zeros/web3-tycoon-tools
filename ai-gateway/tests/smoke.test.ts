import test from "node:test";
import assert from "node:assert/strict";
import { AI_GATEWAY_VERSION } from "../src/index.js";

test("导出版本号", () => {
  assert.equal(AI_GATEWAY_VERSION, "0.1.0");
});
