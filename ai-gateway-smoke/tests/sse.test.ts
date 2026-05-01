import { test } from "node:test";
import assert from "node:assert/strict";

import { SseChunkSplitter } from "../src/utils/sse.js";

test("SseChunkSplitter 单 chunk 单事件", () => {
  const splitter = new SseChunkSplitter();
  const events = splitter.push("event: ping\ndata: {}\n\n");
  assert.deepEqual(events, ["event: ping\ndata: {}"]);
});

test("SseChunkSplitter 单 chunk 多事件", () => {
  const splitter = new SseChunkSplitter();
  const events = splitter.push("data: a\n\ndata: b\n\n");
  assert.deepEqual(events, ["data: a", "data: b"]);
});

test("SseChunkSplitter 跨 chunk 边界", () => {
  const splitter = new SseChunkSplitter();
  assert.deepEqual(splitter.push("data: hel"), []);
  assert.deepEqual(splitter.push("lo\n\ndata: w"), ["data: hello"]);
  assert.deepEqual(splitter.push("orld\n\n"), ["data: world"]);
});

test("SseChunkSplitter 接受 Buffer", () => {
  const splitter = new SseChunkSplitter();
  const events = splitter.push(Buffer.from("data: 你好\n\n", "utf8"));
  assert.deepEqual(events, ["data: 你好"]);
});

test("SseChunkSplitter 空 chunk 返回空数组", () => {
  const splitter = new SseChunkSplitter();
  assert.deepEqual(splitter.push(""), []);
});

test("SseChunkSplitter 处理 CRLF 分隔符", () => {
  const splitter = new SseChunkSplitter();
  const events = splitter.push("event: a\r\ndata: 1\r\n\r\nevent: b\r\ndata: 2\r\n\r\n");
  assert.deepEqual(events, ["event: a\r\ndata: 1", "event: b\r\ndata: 2"]);
});

test("SseChunkSplitter flush 返回剩余未完成片段", () => {
  const splitter = new SseChunkSplitter();
  splitter.push("data: tail");
  assert.equal(splitter.flush(), "data: tail");
  assert.equal(splitter.flush(), null);
});

test("SseChunkSplitter flush 在没有剩余时返回 null", () => {
  const splitter = new SseChunkSplitter();
  splitter.push("data: a\n\n");
  assert.equal(splitter.flush(), null);
});
