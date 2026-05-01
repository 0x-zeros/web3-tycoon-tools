import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import crypto from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import fsPromises, { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import { withFileLock } from "../src/util/file-lock.js";

async function tempDir(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "ai-gateway-lock-"));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(condition: () => boolean, timeoutMs: number, message: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (condition()) {
      return;
    }
    await sleep(5);
  }
  assert.fail(message);
}

function stateDir(lockPath: string): string {
  return `${lockPath}.holders`;
}

type TestHolder = {
  pid: number;
  processStartId?: string;
  ownerToken: string;
  acquiredAt: string;
  updatedAt: string;
  createdAtMs?: number;
};

const NON_LIVE_PID = 2_147_483_647;
const OWNER_UUID = "00000000-0000-4000-8000-000000000000";
const MISMATCHED_PROCESS_START_ID = "0";

function makeHolder(
  ownerToken: string,
  date = new Date(),
  pid = NON_LIVE_PID,
  processStartId?: string,
): TestHolder {
  const holder: TestHolder = {
    pid,
    ownerToken,
    acquiredAt: date.toISOString(),
    updatedAt: date.toISOString(),
  };
  if (processStartId !== undefined) {
    holder.processStartId = processStartId;
  }
  return holder;
}

function timestampFor(dateOrMs: Date | number): string {
  const timestamp = typeof dateOrMs === "number" ? dateOrMs : dateOrMs.getTime();
  return String(timestamp).padStart(13, "0");
}

function ownerFileName(dateOrMs: Date | number, pid: number, processStartId: string, uuid = OWNER_UUID): string {
  return `${timestampFor(dateOrMs)}-${pid}-${processStartId}-${uuid}.json`;
}

async function readLinuxProcessStartId(pid: number): Promise<string | undefined> {
  if (process.platform !== "linux") {
    return undefined;
  }

  try {
    const raw = await readFile(pid === process.pid ? "/proc/self/stat" : `/proc/${pid}/stat`, "utf8");
    const commandEndIndex = raw.lastIndexOf(")");
    if (commandEndIndex === -1) {
      return undefined;
    }
    const fieldsAfterCommand = raw.slice(commandEndIndex + 2).trim().split(/\s+/);
    return fieldsAfterCommand[19];
  } catch {
    return undefined;
  }
}

async function currentProcessStartId(): Promise<string> {
  const processStartId = await readLinuxProcessStartId(process.pid);
  if (processStartId === undefined) {
    assert.fail("当前 Linux 环境应能读取当前进程 starttime");
  }
  return processStartId;
}

async function writeOwnerFile(
  lockPath: string,
  fileName: string,
  raw: string | TestHolder,
  mtime?: Date,
): Promise<string> {
  await mkdir(stateDir(lockPath), { recursive: true, mode: 0o700 });
  await chmod(stateDir(lockPath), 0o700);
  const filePath = path.join(stateDir(lockPath), fileName);
  const content = typeof raw === "string" ? raw : `${JSON.stringify(raw)}\n`;
  await writeFile(filePath, content, { mode: 0o600 });
  await chmod(filePath, 0o600);
  if (mtime) {
    await utimes(filePath, mtime, mtime);
  }
  return filePath;
}

async function onlyOwnerPath(lockPath: string): Promise<string> {
  const entries = (await readdir(stateDir(lockPath))).filter((entry) => entry.endsWith(".json"));
  assert.equal(entries.length, 1);
  return path.join(stateDir(lockPath), entries[0]!);
}

type FileHandlePrototype = {
  readFile: FileHandle["readFile"];
  truncate: FileHandle["truncate"];
  write: FileHandle["write"];
  sync: FileHandle["sync"];
  stat: FileHandle["stat"];
  utimes: FileHandle["utimes"];
};

type StringDirent = {
  isFile: () => boolean;
  name: string;
};

async function getFileHandlePrototype(dir: string): Promise<FileHandlePrototype> {
  const probePath = path.join(dir, "file-handle-prototype.tmp");
  const handle = await fsPromises.open(probePath, "w", 0o600);
  try {
    return Object.getPrototypeOf(handle) as FileHandlePrototype;
  } finally {
    await handle.close();
    await rm(probePath, { force: true });
  }
}

test("withFileLock 串行化同一个锁文件", async () => {
  const dir = await tempDir();
  try {
    const lockPath = path.join(dir, "test.lock");
    const events: string[] = [];

    await Promise.all([
      withFileLock(lockPath, { staleMs: 5_000, retryMs: 10, timeoutMs: 1_000 }, async () => {
        events.push("a-start");
        await new Promise((resolve) => setTimeout(resolve, 50));
        events.push("a-end");
      }),
      withFileLock(lockPath, { staleMs: 5_000, retryMs: 10, timeoutMs: 1_000 }, async () => {
        events.push("b-start");
        events.push("b-end");
      }),
    ]);

    assert.equal(events.includes("a-start"), true);
    assert.equal(events.includes("b-start"), true);
    assert.equal(
      events.indexOf("a-end") < events.indexOf("b-start") || events.indexOf("b-end") < events.indexOf("a-start"),
      true,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 省略 options 时使用默认参数获取锁", async () => {
  const dir = await tempDir();
  try {
    const lockPath = path.join(dir, "default-options.lock");

    let entered = false;
    await withFileLock(lockPath, async () => {
      entered = true;
      return "ok";
    });

    assert.equal(entered, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 超时后报出 lock path", async () => {
  const dir = await tempDir();
  try {
    const lockPath = path.join(dir, "timeout.lock");
    let releaseLongLock: (() => void) | undefined;
    let longLockEnteredResolve: (() => void) | undefined;
    const longLockEntered = new Promise<void>((resolve) => {
      longLockEnteredResolve = resolve;
    });
    const longLockReleased = new Promise<void>((resolve) => {
      releaseLongLock = resolve;
    });

    const longLock = withFileLock(lockPath, { staleMs: 5_000, retryMs: 20, timeoutMs: 1_000 }, async () => {
      longLockEnteredResolve?.();
      await longLockReleased;
    });

    try {
      await longLockEntered;
      await assert.rejects(
        () => withFileLock(lockPath, { staleMs: 5_000, retryMs: 20, timeoutMs: 100 }, async () => undefined),
        /timeout.lock/,
      );
    } finally {
      releaseLongLock?.();
      await longLock;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 在 retryMs 大于 timeoutMs 时按 timeoutMs 超时且不泄露 ownerToken", async () => {
  const dir = await tempDir();
  const requestedSleeps: number[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  try {
    const lockPath = path.join(dir, "retry-timeout.lock");
    const holder = makeHolder("active-owner", new Date(Date.now() - 1_000));
    holder.updatedAt = new Date().toISOString();
    await writeOwnerFile(lockPath, "000-active.json", holder);

    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      const delay = args[1];
      if (typeof delay === "number") {
        requestedSleeps.push(delay);
      }
      return originalSetTimeout(...args);
    }) as typeof setTimeout;

    await assert.rejects(
      async () => {
        await withFileLock(lockPath, { staleMs: 10_000, retryMs: 500, timeoutMs: 20 }, async () => undefined);
      },
      (error) => {
        const message = (error as Error).message;
        assert.match(message, /获取文件锁超时/);
        assert.match(message, /retry-timeout\.lock/);
        assert.doesNotMatch(message, /active-owner/);
        return true;
      },
    );
    assert.equal(
      requestedSleeps.some((delay) => delay >= 200),
      false,
      `不应按完整 retryMs 等待，实际请求等待: ${requestedSleeps.join(", ")}`,
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock timeoutMs 为 0 时仍允许一次即时获取", async () => {
  const dir = await tempDir();
  try {
    const lockPath = path.join(dir, "zero-timeout.lock");

    let entered = false;
    await withFileLock(lockPath, { staleMs: 5_000, retryMs: 10, timeoutMs: 0 }, async () => {
      entered = true;
    });

    assert.equal(entered, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 已进入临界区后同毫秒后到 owner 不能按文件名抢占", async () => {
  const dir = await tempDir();
  const mutableCrypto = crypto as typeof crypto & {
    randomUUID: typeof crypto.randomUUID;
  };
  const originalRandomUUID = mutableCrypto.randomUUID;
  const RealDate = Date;
  const fixedMs = RealDate.now();
  const laterFileUuid = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const earlierFileUuid = "00000000-0000-4000-8000-000000000000";
  const uuidQueue = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    laterFileUuid,
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    earlierFileUuid,
  ];
  let releaseFirst: (() => void) | undefined;
  let firstEnteredResolve: (() => void) | undefined;
  const firstMayFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstEntered = new Promise<void>((resolve) => {
    firstEnteredResolve = resolve;
  });
  const events: string[] = [];
  let active = 0;
  let maxActive = 0;

  class FixedDate extends RealDate {
    constructor(value?: string | number | Date) {
      if (value === undefined) {
        super(fixedMs);
        return;
      }
      super(value);
    }

    static override now(): number {
      return RealDate.now();
    }
  }

  try {
    const lockPath = path.join(dir, "same-ms-late-owner-after-enter.lock");

    mutableCrypto.randomUUID = ((...args: Parameters<typeof crypto.randomUUID>) => {
      return uuidQueue.shift() ?? originalRandomUUID(...args);
    }) as typeof crypto.randomUUID;
    globalThis.Date = FixedDate as DateConstructor;
    syncBuiltinESMExports();

    const firstLock = withFileLock(lockPath, { staleMs: 10_000, retryMs: 5, timeoutMs: 1_000 }, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push("a-start");
      firstEnteredResolve?.();
      try {
        await firstMayFinish;
      } finally {
        events.push("a-end");
        active -= 1;
      }
    });

    await firstEntered;

    const secondLock = withFileLock(lockPath, { staleMs: 10_000, retryMs: 5, timeoutMs: 40 }, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push("b-start");
      try {
        events.push("b-end");
      } finally {
        active -= 1;
      }
    });

    const [secondOutcome] = await Promise.allSettled([secondLock]);
    releaseFirst?.();
    const [firstOutcome] = await Promise.allSettled([firstLock]);

    assert.equal(maxActive, 1);
    const aEndIndex = events.indexOf("a-end");
    const bStartIndex = events.indexOf("b-start");
    assert.equal(bStartIndex === -1 || aEndIndex < bStartIndex, true);
    assert.equal(secondOutcome.status, "rejected");
    if (secondOutcome.status === "rejected") {
      assert.match(secondOutcome.reason instanceof Error ? secondOutcome.reason.message : String(secondOutcome.reason), /获取文件锁超时/);
    }
    assert.ok(firstOutcome);
  } finally {
    releaseFirst?.();
    mutableCrypto.randomUUID = originalRandomUUID;
    globalThis.Date = RealDate;
    syncBuiltinESMExports();
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 同毫秒新 owner 未出现在首次竞选快照时仍保持互斥", async () => {
  const dir = await tempDir();
  const mutableFsPromises = fsPromises as typeof fsPromises & {
    readdir: typeof fsPromises.readdir;
  };
  const mutableCrypto = crypto as typeof crypto & {
    randomUUID: typeof crypto.randomUUID;
  };
  const originalReaddir = mutableFsPromises.readdir;
  const originalRandomUUID = mutableCrypto.randomUUID;
  const RealDate = Date;
  const fixedMs = RealDate.now();
  const processStartId = await currentProcessStartId();
  const laterFileUuid = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const earlierFileUuid = "00000000-0000-4000-8000-000000000000";
  const laterOwnerFileName = ownerFileName(fixedMs, process.pid, processStartId, laterFileUuid);
  const earlierOwnerFileName = ownerFileName(fixedMs, process.pid, processStartId, earlierFileUuid);
  const uuidQueue = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    laterFileUuid,
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    earlierFileUuid,
  ];
  let startSecond: (() => void) | undefined;
  const secondMayStart = new Promise<void>((resolve) => {
    startSecond = resolve;
  });
  let hidEarlierOwnerOnce = false;
  let active = 0;
  let maxActive = 0;

  class FixedDate extends RealDate {
    constructor(value?: string | number | Date) {
      if (value === undefined) {
        super(fixedMs);
        return;
      }
      super(value);
    }

    static override now(): number {
      return RealDate.now();
    }
  }

  try {
    const lockPath = path.join(dir, "same-ms-election-window.lock");
    const lockStateDir = stateDir(lockPath);
    const resolvedStateDir = path.resolve(lockStateDir);

    async function waitForEarlierOwnerFile(): Promise<void> {
      const deadline = RealDate.now() + 500;
      while (RealDate.now() <= deadline) {
        const entries = await originalReaddir(lockStateDir, { withFileTypes: true });
        if (entries.some((entry) => entry.isFile() && entry.name === earlierOwnerFileName)) {
          return;
        }
        await sleep(1);
      }
      assert.fail("同毫秒更早排序的 owner 文件未按预期创建");
    }

    mutableCrypto.randomUUID = ((...args: Parameters<typeof crypto.randomUUID>) => {
      return uuidQueue.shift() ?? originalRandomUUID(...args);
    }) as typeof crypto.randomUUID;

    mutableFsPromises.readdir = (async (...args: Parameters<typeof fsPromises.readdir>) => {
      const target = args[0];
      const entries = await originalReaddir(...args);
      const dirEntries = entries as unknown as StringDirent[];
      if (
        !hidEarlierOwnerOnce &&
        typeof target === "string" &&
        path.resolve(target) === resolvedStateDir &&
        Array.isArray(entries) &&
        dirEntries.some((entry) => entry.isFile() && entry.name === laterOwnerFileName) &&
        !dirEntries.some((entry) => entry.isFile() && entry.name === earlierOwnerFileName)
      ) {
        hidEarlierOwnerOnce = true;
        startSecond?.();
        await waitForEarlierOwnerFile();
        return entries;
      }
      return entries;
    }) as typeof fsPromises.readdir;

    globalThis.Date = FixedDate as DateConstructor;
    syncBuiltinESMExports();

    async function runLocked(name: string): Promise<void> {
      if (name === "second") {
        await secondMayStart;
      }
      await withFileLock(lockPath, { staleMs: 10_000, retryMs: 100, timeoutMs: 1_000 }, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          await sleep(30);
        } finally {
          active -= 1;
        }
      });
    }

    await Promise.all([runLocked("first"), runLocked("second")]);

    assert.equal(hidEarlierOwnerOnce, true);
    assert.equal(maxActive, 1);
  } finally {
    mutableFsPromises.readdir = originalReaddir;
    mutableCrypto.randomUUID = originalRandomUUID;
    globalThis.Date = RealDate;
    syncBuiltinESMExports();
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 持锁超过 staleMs 时仍保持互斥", async () => {
  const dir = await tempDir();
  try {
    const lockPath = path.join(dir, "heartbeat.lock");
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;

    async function runLocked(name: string, holdMs: number, startDelayMs = 0): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, startDelayMs));
      await withFileLock(lockPath, { staleMs: 50, retryMs: 5, timeoutMs: 2_000 }, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        events.push(`${name}-start`);
        await new Promise((resolve) => setTimeout(resolve, holdMs));
        events.push(`${name}-end`);
        active -= 1;
      });
    }

    await Promise.all([runLocked("a", 140), runLocked("b", 140), runLocked("c", 20, 80)]);

    assert.equal(maxActive, 1);
    assert.equal(events.filter((event) => event.endsWith("-start")).length, 3);
    assert.equal(events.filter((event) => event.endsWith("-end")).length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock heartbeat 写入失败后仍保活阻止并发进入", async () => {
  const dir = await tempDir();
  const prototype = await getFileHandlePrototype(dir);
  const mutableFsPromises = fsPromises as typeof fsPromises & {
    open: typeof fsPromises.open;
  };
  const originalOpen = mutableFsPromises.open;
  const originalWrite = prototype.write;
  const handlePaths = new WeakMap<FileHandle, string>();
  let failWrite = false;
  let failingOwnerPath: string | undefined;
  let writeFailures = 0;
  let releaseFirst: (() => void) | undefined;
  let firstEnteredResolve: (() => void) | undefined;
  const firstMayFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstEntered = new Promise<void>((resolve) => {
    firstEnteredResolve = resolve;
  });
  let firstLock: Promise<void> | undefined;
  let secondLock: Promise<void> | undefined;
  let firstOutcome: PromiseSettledResult<void> | undefined;
  let secondOutcome: PromiseSettledResult<void> | undefined;
  let active = 0;
  let maxActive = 0;
  let maxActiveWhileFirstHeld = 0;
  let secondStartedWhileFirstHeld = false;
  const events: string[] = [];

  try {
    const lockPath = path.join(dir, "heartbeat-write-failure-mutual-exclusion.lock");
    const staleMs = 40;

    mutableFsPromises.open = (async (...args: Parameters<typeof fsPromises.open>) => {
      const handle = await originalOpen(...args);
      const target = args[0];
      if (typeof target === "string") {
        handlePaths.set(handle, path.resolve(target));
      }
      return handle;
    }) as typeof fsPromises.open;

    prototype.write = (async function patchedWrite(this: FileHandle, ...args: unknown[]): Promise<unknown> {
      if (failWrite && failingOwnerPath && handlePaths.get(this) === failingOwnerPath) {
        writeFailures += 1;
        throw new Error("测试注入 heartbeat write 失败");
      }
      return await (originalWrite as (...innerArgs: unknown[]) => Promise<unknown>).apply(this, args);
    }) as FileHandle["write"];

    syncBuiltinESMExports();

    firstLock = withFileLock(lockPath, { staleMs, retryMs: 5, timeoutMs: 1_000 }, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push("first-start");
      try {
        failingOwnerPath = path.resolve(await onlyOwnerPath(lockPath));
        failWrite = true;
        firstEnteredResolve?.();
        await firstMayFinish;
      } finally {
        events.push("first-end");
        active -= 1;
      }
    });

    await firstEntered;
    await waitForCondition(() => writeFailures > 0, 300, "heartbeat write 未按预期失败");

    secondLock = withFileLock(lockPath, { staleMs, retryMs: 5, timeoutMs: 1_000 }, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push("second-start");
      try {
        await sleep(10);
      } finally {
        events.push("second-end");
        active -= 1;
      }
    });

    await sleep(staleMs * 4);
    maxActiveWhileFirstHeld = maxActive;
    secondStartedWhileFirstHeld = events.includes("second-start");
  } finally {
    failWrite = false;
    releaseFirst?.();
    [firstOutcome, secondOutcome] = await Promise.allSettled([
      firstLock ?? Promise.resolve(),
      secondLock ?? Promise.resolve(),
    ]);
    mutableFsPromises.open = originalOpen;
    prototype.write = originalWrite;
    syncBuiltinESMExports();
    await rm(dir, { recursive: true, force: true });
  }

  assert.equal(maxActiveWhileFirstHeld, 1);
  assert.equal(secondStartedWhileFirstHeld, false);
  assert.equal(maxActive, 1);
  assert.deepEqual(events, ["first-start", "first-end", "second-start", "second-end"]);
  assert.ok(firstOutcome);
  assert.equal(firstOutcome.status, "rejected");
  if (firstOutcome.status === "rejected") {
    const messages =
      firstOutcome.reason instanceof AggregateError
        ? [
            firstOutcome.reason.message,
            ...firstOutcome.reason.errors.map((inner) => (inner instanceof Error ? inner.message : String(inner))),
          ]
        : [firstOutcome.reason instanceof Error ? firstOutcome.reason.message : String(firstOutcome.reason)];
    assert.equal(messages.some((message) => /文件锁 heartbeat 写入失败/.test(message)), true);
  }
  assert.ok(secondOutcome);
  assert.equal(secondOutcome.status, "fulfilled");
  assert.equal(writeFailures > 0, true);
});

test("withFileLock heartbeat write 破坏 owner 且后续保活失败时用文件名 live pid 阻止并发", async () => {
  const dir = await tempDir();
  const prototype = await getFileHandlePrototype(dir);
  const mutableFsPromises = fsPromises as typeof fsPromises & {
    open: typeof fsPromises.open;
  };
  const originalOpen = mutableFsPromises.open;
  const originalTruncate = prototype.truncate;
  const originalWrite = prototype.write;
  const originalUtimes = prototype.utimes;
  const handlePaths = new WeakMap<FileHandle, string>();
  let failInitialWrite = false;
  let failLaterRefresh = false;
  let failingOwnerPath: string | undefined;
  let writeFailures = 0;
  let truncateFailures = 0;
  let utimesFailures = 0;
  let initialTouchObserved = false;
  let releaseFirst: (() => void) | undefined;
  let firstEnteredResolve: (() => void) | undefined;
  const firstMayFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstEntered = new Promise<void>((resolve) => {
    firstEnteredResolve = resolve;
  });
  let firstLock: Promise<void> | undefined;
  let secondLock: Promise<void> | undefined;
  let firstOutcome: PromiseSettledResult<void> | undefined;
  let secondOutcome: PromiseSettledResult<void> | undefined;
  let active = 0;
  let maxActive = 0;
  let maxActiveWhileFirstHeld = 0;
  let secondStartedWhileFirstHeld = false;
  let ownerTokenBeforeFailure = "";
  const events: string[] = [];

  try {
    const lockPath = path.join(dir, "heartbeat-write-malformed-live-pid.lock");
    const staleMs = 40;
    const processStartId = await currentProcessStartId();

    mutableFsPromises.open = (async (...args: Parameters<typeof fsPromises.open>) => {
      const handle = await originalOpen(...args);
      const target = args[0];
      if (typeof target === "string") {
        handlePaths.set(handle, path.resolve(target));
      }
      return handle;
    }) as typeof fsPromises.open;

    prototype.write = (async function patchedWrite(this: FileHandle, ...args: unknown[]): Promise<unknown> {
      if (failInitialWrite && failingOwnerPath && handlePaths.get(this) === failingOwnerPath) {
        failInitialWrite = false;
        writeFailures += 1;
        throw new Error("测试注入 heartbeat write 失败");
      }
      return await (originalWrite as (...innerArgs: unknown[]) => Promise<unknown>).apply(this, args);
    }) as FileHandle["write"];

    prototype.truncate = (async function patchedTruncate(this: FileHandle, ...args: unknown[]): Promise<unknown> {
      if (failLaterRefresh && failingOwnerPath && handlePaths.get(this) === failingOwnerPath) {
        truncateFailures += 1;
        throw new Error("测试注入 heartbeat truncate 失败");
      }
      return await (originalTruncate as (...innerArgs: unknown[]) => Promise<unknown>).apply(this, args);
    }) as FileHandle["truncate"];

    prototype.utimes = (async function patchedUtimes(this: FileHandle, ...args: unknown[]): Promise<unknown> {
      if (failingOwnerPath && handlePaths.get(this) === failingOwnerPath) {
        if (!initialTouchObserved && writeFailures > 0) {
          const result = await (originalUtimes as (...innerArgs: unknown[]) => Promise<unknown>).apply(this, args);
          initialTouchObserved = true;
          failLaterRefresh = true;
          return result;
        }
        if (failLaterRefresh) {
          utimesFailures += 1;
          throw new Error("测试注入 heartbeat utimes 失败");
        }
      }
      return await (originalUtimes as (...innerArgs: unknown[]) => Promise<unknown>).apply(this, args);
    }) as FileHandle["utimes"];

    syncBuiltinESMExports();

    firstLock = withFileLock(lockPath, { staleMs, retryMs: 5, timeoutMs: 1_000 }, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push("first-start");
      try {
        failingOwnerPath = path.resolve(await onlyOwnerPath(lockPath));
        assert.match(
          path.basename(failingOwnerPath),
          new RegExp(`^\\d{13,}-${process.pid}-${processStartId}-[0-9a-f-]{36}\\.json$`),
        );
        ownerTokenBeforeFailure = (JSON.parse(await readFile(failingOwnerPath, "utf8")) as TestHolder).ownerToken;
        failInitialWrite = true;
        firstEnteredResolve?.();
        await firstMayFinish;
      } finally {
        events.push("first-end");
        active -= 1;
      }
    });

    await firstEntered;
    await waitForCondition(
      () => writeFailures > 0 && initialTouchObserved,
      300,
      "heartbeat write 失败后未按预期完成一次 mtime 保活",
    );
    await waitForCondition(
      () => truncateFailures > 0 && utimesFailures > 0,
      300,
      "后续 heartbeat truncate 和 utimes 未按预期同时失败",
    );
    await sleep(staleMs * 2);

    secondLock = withFileLock(lockPath, { staleMs, retryMs: 5, timeoutMs: 80 }, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push("second-start");
      try {
        await sleep(10);
      } finally {
        events.push("second-end");
        active -= 1;
      }
    });

    await Promise.race([
      secondLock.catch(() => undefined),
      sleep(staleMs * 4),
    ]);
    maxActiveWhileFirstHeld = maxActive;
    secondStartedWhileFirstHeld = events.includes("second-start");
  } finally {
    failInitialWrite = false;
    failLaterRefresh = false;
    releaseFirst?.();
    [firstOutcome, secondOutcome] = await Promise.allSettled([
      firstLock ?? Promise.resolve(),
      secondLock ?? Promise.resolve(),
    ]);
    mutableFsPromises.open = originalOpen;
    prototype.truncate = originalTruncate;
    prototype.write = originalWrite;
    prototype.utimes = originalUtimes;
    syncBuiltinESMExports();
    await rm(dir, { recursive: true, force: true });
  }

  assert.equal(maxActiveWhileFirstHeld, 1);
  assert.equal(secondStartedWhileFirstHeld, false);
  assert.equal(maxActive, 1);
  const firstEndIndex = events.indexOf("first-end");
  const secondStartIndex = events.indexOf("second-start");
  assert.equal(secondStartIndex === -1 || (firstEndIndex !== -1 && firstEndIndex < secondStartIndex), true);
  assert.ok(firstOutcome);
  assert.equal(firstOutcome.status, "rejected");
  if (firstOutcome.status === "rejected") {
    const messages =
      firstOutcome.reason instanceof AggregateError
        ? [
            firstOutcome.reason.message,
            ...firstOutcome.reason.errors.map((inner) => (inner instanceof Error ? inner.message : String(inner))),
          ]
        : [firstOutcome.reason instanceof Error ? firstOutcome.reason.message : String(firstOutcome.reason)];
    assert.equal(messages.some((message) => /文件锁 heartbeat 写入失败/.test(message)), true);
    assert.equal(messages.some((message) => message.includes(ownerTokenBeforeFailure)), false);
  }
  assert.ok(secondOutcome);
  assert.equal(secondOutcome.status, "rejected");
  if (secondOutcome.status === "rejected") {
    assert.match(secondOutcome.reason instanceof Error ? secondOutcome.reason.message : String(secondOutcome.reason), /获取文件锁超时/);
    assert.equal(
      (secondOutcome.reason instanceof Error ? secondOutcome.reason.message : String(secondOutcome.reason)).includes(
        ownerTokenBeforeFailure,
      ),
      false,
    );
  }
  assert.equal(writeFailures, 1);
  assert.equal(truncateFailures > 0, true);
  assert.equal(utimesFailures > 0, true);
});

test("withFileLock heartbeat truncate 失败后用 fresh mtime 保活旧 valid owner", async () => {
  const dir = await tempDir();
  const prototype = await getFileHandlePrototype(dir);
  const mutableFsPromises = fsPromises as typeof fsPromises & {
    open: typeof fsPromises.open;
  };
  const originalOpen = mutableFsPromises.open;
  const originalTruncate = prototype.truncate;
  const handlePaths = new WeakMap<FileHandle, string>();
  let failTruncate = false;
  let failingOwnerPath: string | undefined;
  let truncateFailures = 0;
  let releaseFirst: (() => void) | undefined;
  let firstEnteredResolve: (() => void) | undefined;
  const firstMayFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstEntered = new Promise<void>((resolve) => {
    firstEnteredResolve = resolve;
  });
  let firstLock: Promise<void> | undefined;
  let secondLock: Promise<void> | undefined;
  let firstOutcome: PromiseSettledResult<void> | undefined;
  let secondOutcome: PromiseSettledResult<void> | undefined;
  let active = 0;
  let maxActive = 0;
  let maxActiveWhileFirstHeld = 0;
  let secondStartedWhileFirstHeld = false;
  let observedOldValidJsonWithFreshMtime = false;
  let ownerTokenAfterFailure = "";
  const events: string[] = [];

  try {
    const lockPath = path.join(dir, "heartbeat-truncate-failure-valid-owner.lock");
    const staleMs = 40;

    mutableFsPromises.open = (async (...args: Parameters<typeof fsPromises.open>) => {
      const handle = await originalOpen(...args);
      const target = args[0];
      if (typeof target === "string") {
        handlePaths.set(handle, path.resolve(target));
      }
      return handle;
    }) as typeof fsPromises.open;

    prototype.truncate = (async function patchedTruncate(this: FileHandle, ...args: unknown[]): Promise<unknown> {
      if (failTruncate && failingOwnerPath && handlePaths.get(this) === failingOwnerPath) {
        truncateFailures += 1;
        throw new Error("测试注入 heartbeat truncate 失败");
      }
      return await (originalTruncate as (...innerArgs: unknown[]) => Promise<unknown>).apply(this, args);
    }) as FileHandle["truncate"];

    syncBuiltinESMExports();

    firstLock = withFileLock(lockPath, { staleMs, retryMs: 5, timeoutMs: 1_000 }, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push("first-start");
      try {
        failingOwnerPath = path.resolve(await onlyOwnerPath(lockPath));
        failTruncate = true;
        firstEnteredResolve?.();
        await firstMayFinish;
      } finally {
        events.push("first-end");
        active -= 1;
      }
    });

    await firstEntered;
    await waitForCondition(() => truncateFailures > 0, 300, "heartbeat truncate 未按预期失败");

    assert.ok(failingOwnerPath);
    const observationDeadline = Date.now() + 300;
    while (Date.now() <= observationDeadline) {
      const holderAfterFailure = JSON.parse(await readFile(failingOwnerPath, "utf8")) as TestHolder;
      const statsAfterFailure = await stat(failingOwnerPath);
      if (Date.now() - Date.parse(holderAfterFailure.updatedAt) > staleMs && Date.now() - statsAfterFailure.mtimeMs < staleMs) {
        ownerTokenAfterFailure = holderAfterFailure.ownerToken;
        observedOldValidJsonWithFreshMtime = true;
        break;
      }
      await sleep(5);
    }

    secondLock = withFileLock(lockPath, { staleMs, retryMs: 5, timeoutMs: 1_000 }, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push("second-start");
      try {
        await sleep(10);
      } finally {
        events.push("second-end");
        active -= 1;
      }
    });

    await sleep(staleMs * 4);
    maxActiveWhileFirstHeld = maxActive;
    secondStartedWhileFirstHeld = events.includes("second-start");
  } finally {
    failTruncate = false;
    releaseFirst?.();
    [firstOutcome, secondOutcome] = await Promise.allSettled([
      firstLock ?? Promise.resolve(),
      secondLock ?? Promise.resolve(),
    ]);
    mutableFsPromises.open = originalOpen;
    prototype.truncate = originalTruncate;
    syncBuiltinESMExports();
    await rm(dir, { recursive: true, force: true });
  }

  assert.equal(observedOldValidJsonWithFreshMtime, true);
  assert.equal(maxActiveWhileFirstHeld, 1);
  assert.equal(secondStartedWhileFirstHeld, false);
  assert.equal(maxActive, 1);
  assert.deepEqual(events, ["first-start", "first-end", "second-start", "second-end"]);
  assert.ok(firstOutcome);
  assert.equal(firstOutcome.status, "rejected");
  if (firstOutcome.status === "rejected") {
    const messages =
      firstOutcome.reason instanceof AggregateError
        ? [
            firstOutcome.reason.message,
            ...firstOutcome.reason.errors.map((inner) => (inner instanceof Error ? inner.message : String(inner))),
          ]
        : [firstOutcome.reason instanceof Error ? firstOutcome.reason.message : String(firstOutcome.reason)];
    assert.equal(messages.some((message) => /文件锁 heartbeat 写入失败/.test(message)), true);
    assert.equal(messages.some((message) => message.includes(ownerTokenAfterFailure)), false);
  }
  assert.ok(secondOutcome);
  assert.equal(secondOutcome.status, "fulfilled");
  assert.equal(truncateFailures > 0, true);
});

test("withFileLock heartbeat truncate 和 utimes 都失败时仍由本机存活 pid 阻止并发进入", async () => {
  const dir = await tempDir();
  const prototype = await getFileHandlePrototype(dir);
  const mutableFsPromises = fsPromises as typeof fsPromises & {
    open: typeof fsPromises.open;
  };
  const originalOpen = mutableFsPromises.open;
  const originalTruncate = prototype.truncate;
  const originalUtimes = prototype.utimes;
  const handlePaths = new WeakMap<FileHandle, string>();
  let failHeartbeatRefresh = false;
  let failingOwnerPath: string | undefined;
  let truncateFailures = 0;
  let utimesFailures = 0;
  let releaseFirst: (() => void) | undefined;
  let firstEnteredResolve: (() => void) | undefined;
  const firstMayFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstEntered = new Promise<void>((resolve) => {
    firstEnteredResolve = resolve;
  });
  let firstLock: Promise<void> | undefined;
  let secondLock: Promise<void> | undefined;
  let firstOutcome: PromiseSettledResult<void> | undefined;
  let secondOutcome: PromiseSettledResult<void> | undefined;
  let active = 0;
  let maxActive = 0;
  let maxActiveWhileFirstHeld = 0;
  let secondStartedWhileFirstHeld = false;
  let ownerTokenAfterFailure = "";
  const events: string[] = [];

  try {
    const lockPath = path.join(dir, "heartbeat-truncate-utimes-failure-live-pid.lock");
    const staleMs = 40;

    mutableFsPromises.open = (async (...args: Parameters<typeof fsPromises.open>) => {
      const handle = await originalOpen(...args);
      const target = args[0];
      if (typeof target === "string") {
        handlePaths.set(handle, path.resolve(target));
      }
      return handle;
    }) as typeof fsPromises.open;

    prototype.truncate = (async function patchedTruncate(this: FileHandle, ...args: unknown[]): Promise<unknown> {
      if (failHeartbeatRefresh && failingOwnerPath && handlePaths.get(this) === failingOwnerPath) {
        truncateFailures += 1;
        throw new Error("测试注入 heartbeat truncate 失败");
      }
      return await (originalTruncate as (...innerArgs: unknown[]) => Promise<unknown>).apply(this, args);
    }) as FileHandle["truncate"];

    prototype.utimes = (async function patchedUtimes(this: FileHandle, ...args: unknown[]): Promise<unknown> {
      if (failHeartbeatRefresh && failingOwnerPath && handlePaths.get(this) === failingOwnerPath) {
        utimesFailures += 1;
        throw new Error("测试注入 heartbeat utimes 失败");
      }
      return await (originalUtimes as (...innerArgs: unknown[]) => Promise<unknown>).apply(this, args);
    }) as FileHandle["utimes"];

    syncBuiltinESMExports();

    firstLock = withFileLock(lockPath, { staleMs, retryMs: 5, timeoutMs: 1_000 }, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push("first-start");
      try {
        failingOwnerPath = path.resolve(await onlyOwnerPath(lockPath));
        ownerTokenAfterFailure = (JSON.parse(await readFile(failingOwnerPath, "utf8")) as TestHolder).ownerToken;
        failHeartbeatRefresh = true;
        firstEnteredResolve?.();
        await firstMayFinish;
      } finally {
        events.push("first-end");
        active -= 1;
      }
    });

    await firstEntered;
    await waitForCondition(
      () => truncateFailures > 0 && utimesFailures > 0,
      300,
      "heartbeat truncate 和 utimes 未按预期同时失败",
    );

    secondLock = withFileLock(lockPath, { staleMs, retryMs: 5, timeoutMs: 1_000 }, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push("second-start");
      try {
        await sleep(10);
      } finally {
        events.push("second-end");
        active -= 1;
      }
    });

    await sleep(staleMs * 4);
    maxActiveWhileFirstHeld = maxActive;
    secondStartedWhileFirstHeld = events.includes("second-start");
  } finally {
    failHeartbeatRefresh = false;
    releaseFirst?.();
    [firstOutcome, secondOutcome] = await Promise.allSettled([
      firstLock ?? Promise.resolve(),
      secondLock ?? Promise.resolve(),
    ]);
    mutableFsPromises.open = originalOpen;
    prototype.truncate = originalTruncate;
    prototype.utimes = originalUtimes;
    syncBuiltinESMExports();
    await rm(dir, { recursive: true, force: true });
  }

  assert.equal(maxActiveWhileFirstHeld, 1);
  assert.equal(secondStartedWhileFirstHeld, false);
  assert.equal(maxActive, 1);
  const firstEndIndex = events.indexOf("first-end");
  const secondStartIndex = events.indexOf("second-start");
  assert.equal(secondStartIndex === -1 || (firstEndIndex !== -1 && firstEndIndex < secondStartIndex), true);
  assert.ok(firstOutcome);
  assert.equal(firstOutcome.status, "rejected");
  if (firstOutcome.status === "rejected") {
    const messages =
      firstOutcome.reason instanceof AggregateError
        ? [
            firstOutcome.reason.message,
            ...firstOutcome.reason.errors.map((inner) => (inner instanceof Error ? inner.message : String(inner))),
          ]
        : [firstOutcome.reason instanceof Error ? firstOutcome.reason.message : String(firstOutcome.reason)];
    assert.equal(messages.some((message) => /文件锁 heartbeat 写入失败/.test(message)), true);
    assert.equal(messages.some((message) => message.includes(ownerTokenAfterFailure)), false);
  }
  assert.ok(secondOutcome);
  assert.equal(secondOutcome.status, "fulfilled");
  assert.equal(truncateFailures > 0, true);
  assert.equal(utimesFailures > 0, true);
});

test("withFileLock 释放时发现 owner 文件被替换会报错且保留新文件", async () => {
  const dir = await tempDir();
  try {
    const lockPath = path.join(dir, "owner.lock");
    const otherHolder = makeHolder("other-owner");
    let replacementPath = "";

    await assert.rejects(
      () =>
        withFileLock(lockPath, { staleMs: 60_000, retryMs: 60_000, timeoutMs: 1_000 }, async () => {
          replacementPath = await onlyOwnerPath(lockPath);
          await unlink(replacementPath);
          await writeFile(replacementPath, `${JSON.stringify(otherHolder)}\n`, { mode: 0o600 });
          await chmod(replacementPath, 0o600);
        }),
      /文件锁已丢失/,
    );

    assert.deepEqual(JSON.parse(await readFile(replacementPath, "utf8")), otherHolder);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 不修改 lockPath 父目录权限，状态目录为 0700 且 owner 文件为 0600", async () => {
  const dir = await tempDir();
  try {
    const lockDir = path.join(dir, "locks");
    await mkdir(lockDir, { mode: 0o777 });
    await chmod(lockDir, 0o777);
    const lockPath = path.join(lockDir, "secure.lock");

    await withFileLock(lockPath, { staleMs: 5_000, retryMs: 10, timeoutMs: 1_000 }, async () => {
      assert.equal((await stat(lockDir)).mode & 0o777, 0o777);
      assert.equal((await stat(stateDir(lockPath))).mode & 0o777, 0o700);
      const ownerPath = await onlyOwnerPath(lockPath);
      assert.equal((await stat(ownerPath)).mode & 0o777, 0o600);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 清理 stale owner 前会重新校验同一路径未被新 owner 替换", async () => {
  const dir = await tempDir();
  const prototype = await getFileHandlePrototype(dir);
  const mutableFsPromises = fsPromises as typeof fsPromises & {
    open: typeof fsPromises.open;
    readFile: typeof fsPromises.readFile;
  };
  const originalOpen = mutableFsPromises.open;
  const originalReadFile = mutableFsPromises.readFile;
  const originalHandleReadFile = prototype.readFile;
  const handlePaths = new WeakMap<FileHandle, string>();
  try {
    const lockPath = path.join(dir, "stale-replaced.lock");
    const staleAt = new Date(Date.now() - 60_000);
    const stalePath = await writeOwnerFile(lockPath, "000-stale-replaced.json", makeHolder("stale-owner", staleAt), staleAt);
    const stalePathResolved = path.resolve(stalePath);
    const freshHolder = makeHolder("fresh-owner", new Date(Date.now() - 1_000));
    freshHolder.updatedAt = new Date().toISOString();
    let replaced = false;
    let entered = false;

    function isStalePath(target: unknown): boolean {
      return typeof target === "string" && path.resolve(target) === stalePathResolved;
    }

    async function replaceOnce(target: unknown): Promise<void> {
      if (!replaced && isStalePath(target)) {
        replaced = true;
        await writeFile(stalePath, `${JSON.stringify(freshHolder)}\n`, { mode: 0o600 });
        await chmod(stalePath, 0o600);
      }
    }

    mutableFsPromises.open = (async (...args: Parameters<typeof fsPromises.open>) => {
      const handle = await originalOpen(...args);
      const target = args[0];
      if (isStalePath(target)) {
        handlePaths.set(handle, stalePathResolved);
      }
      return handle;
    }) as typeof fsPromises.open;

    const patchedReadFile = (async (...args: Parameters<typeof fsPromises.readFile>) => {
      const result = await originalReadFile(...args);
      await replaceOnce(args[0]);
      return result;
    }) as typeof fsPromises.readFile;
    mutableFsPromises.readFile = patchedReadFile;

    prototype.readFile = (async function patchedHandleReadFile(this: FileHandle, ...args: unknown[]): Promise<unknown> {
      const result = await (originalHandleReadFile as (...innerArgs: unknown[]) => Promise<unknown>).apply(this, args);
      await replaceOnce(handlePaths.get(this));
      return result;
    }) as FileHandle["readFile"];

    syncBuiltinESMExports();

    await assert.rejects(
      () =>
        withFileLock(lockPath, { staleMs: 10_000, retryMs: 5, timeoutMs: 30 }, async () => {
          entered = true;
        }),
      /获取文件锁超时/,
    );

    assert.equal(entered, false);
    assert.equal(replaced, true);
    assert.deepEqual(JSON.parse(await originalReadFile(stalePath, "utf8")), freshHolder);
  } finally {
    mutableFsPromises.open = originalOpen;
    mutableFsPromises.readFile = originalReadFile;
    prototype.readFile = originalHandleReadFile;
    syncBuiltinESMExports();
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 在 stale 清理复读后遇到同路径 fresh 覆盖时不会进入临界区", async () => {
  const dir = await tempDir();
  const prototype = await getFileHandlePrototype(dir);
  const mutableFsPromises = fsPromises as typeof fsPromises & {
    open: typeof fsPromises.open;
    readFile: typeof fsPromises.readFile;
    stat: typeof fsPromises.stat;
  };
  const originalOpen = mutableFsPromises.open;
  const originalPathReadFile = mutableFsPromises.readFile;
  const originalPathStat = mutableFsPromises.stat;
  const originalHandleReadFile = prototype.readFile;
  const originalHandleStat = prototype.stat;
  const handlePaths = new WeakMap<FileHandle, string>();
  try {
    const lockPath = path.join(dir, "stale-reread-overwritten.lock");
    const staleAt = new Date(Date.now() - 60_000);
    const stalePath = await writeOwnerFile(
      lockPath,
      "000-stale-reread-overwritten.json",
      makeHolder("stale-owner", staleAt),
      staleAt,
    );
    const stalePathResolved = path.resolve(stalePath);
    const freshHolder = makeHolder("fresh-owner", new Date(Date.now() - 1_000));
    freshHolder.updatedAt = new Date().toISOString();
    let staleReads = 0;
    let replaceBeforeNextStat = false;
    let replaced = false;
    let entered = false;

    function isStalePath(target: unknown): boolean {
      return typeof target === "string" && path.resolve(target) === stalePathResolved;
    }

    function markStaleRead(target: unknown): void {
      if (!isStalePath(target)) {
        return;
      }
      staleReads += 1;
      if (staleReads === 2) {
        replaceBeforeNextStat = true;
      }
    }

    async function replaceIfScheduled(target: unknown): Promise<void> {
      if (!replaceBeforeNextStat || !isStalePath(target)) {
        return;
      }
      replaceBeforeNextStat = false;
      replaced = true;
      await writeFile(stalePath, `${JSON.stringify(freshHolder)}\n`, { mode: 0o600 });
      await chmod(stalePath, 0o600);
    }

    mutableFsPromises.open = (async (...args: Parameters<typeof fsPromises.open>) => {
      const handle = await originalOpen(...args);
      const target = args[0];
      if (isStalePath(target)) {
        handlePaths.set(handle, stalePathResolved);
      }
      return handle;
    }) as typeof fsPromises.open;

    mutableFsPromises.readFile = (async (...args: Parameters<typeof fsPromises.readFile>) => {
      const result = await originalPathReadFile(...args);
      markStaleRead(args[0]);
      return result;
    }) as typeof fsPromises.readFile;

    mutableFsPromises.stat = (async (...args: Parameters<typeof fsPromises.stat>) => {
      await replaceIfScheduled(args[0]);
      return await originalPathStat(...args);
    }) as typeof fsPromises.stat;

    prototype.readFile = (async function patchedReadFile(this: FileHandle, ...args: unknown[]): Promise<unknown> {
      const result = await (originalHandleReadFile as (...innerArgs: unknown[]) => Promise<unknown>).apply(this, args);
      markStaleRead(handlePaths.get(this));
      return result;
    }) as FileHandle["readFile"];

    prototype.stat = (async function patchedStat(this: FileHandle, ...args: unknown[]): Promise<unknown> {
      await replaceIfScheduled(handlePaths.get(this));
      return await (originalHandleStat as (...innerArgs: unknown[]) => Promise<unknown>).apply(this, args);
    }) as FileHandle["stat"];

    syncBuiltinESMExports();

    await assert.rejects(
      () =>
        withFileLock(lockPath, { staleMs: 10_000, retryMs: 5, timeoutMs: 30 }, async () => {
          entered = true;
        }),
      /获取文件锁超时/,
    );

    assert.equal(entered, false);
    assert.equal(replaced, true);
    assert.deepEqual(JSON.parse(await originalPathReadFile(stalePath, "utf8")), freshHolder);
  } finally {
    mutableFsPromises.open = originalOpen;
    mutableFsPromises.readFile = originalPathReadFile;
    mutableFsPromises.stat = originalPathStat;
    prototype.readFile = originalHandleReadFile;
    prototype.stat = originalHandleStat;
    syncBuiltinESMExports();
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 清理 stale owner 时不会删除并存的新 owner 文件", async () => {
  const dir = await tempDir();
  try {
    const lockPath = path.join(dir, "race.lock");
    const staleAt = new Date(Date.now() - 60_000);
    const staleHolder = makeHolder("stale-owner", staleAt);
    const freshHolder = makeHolder("fresh-owner", new Date(Date.now() - 1_000));
    freshHolder.updatedAt = new Date().toISOString();
    const stalePath = await writeOwnerFile(lockPath, "000-stale.json", staleHolder, staleAt);
    const freshPath = await writeOwnerFile(lockPath, "001-fresh.json", freshHolder);

    await assert.rejects(
      () => withFileLock(lockPath, { staleMs: 10_000, retryMs: 5, timeoutMs: 30 }, async () => undefined),
      /获取文件锁超时/,
    );
    await assert.rejects(() => stat(stalePath), /ENOENT/);
    assert.deepEqual(JSON.parse(await readFile(freshPath, "utf8")), freshHolder);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 清理合法 stale owner 后进入临界区", async () => {
  const dir = await tempDir();
  try {
    const lockPath = path.join(dir, "valid-stale.lock");
    const staleAt = new Date(Date.now() - 60_000);
    const stalePath = await writeOwnerFile(lockPath, "000-valid-stale.json", makeHolder("valid-stale-owner", staleAt), staleAt);

    let entered = false;
    await withFileLock(lockPath, { staleMs: 10_000, retryMs: 5, timeoutMs: 1_000 }, async () => {
      entered = true;
    });

    assert.equal(entered, true);
    await assert.rejects(() => stat(stalePath), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 清理 PID 存活但进程实例不匹配的 stale valid owner", async () => {
  const dir = await tempDir();
  try {
    const lockPath = path.join(dir, "valid-stale-pid-reused.lock");
    const staleAt = new Date(Date.now() - 60_000);
    const processStartId = await currentProcessStartId();
    assert.notEqual(processStartId, MISMATCHED_PROCESS_START_ID);
    const stalePath = await writeOwnerFile(
      lockPath,
      ownerFileName(staleAt, process.pid, MISMATCHED_PROCESS_START_ID),
      makeHolder("stale-reused-pid-owner", staleAt, process.pid, MISMATCHED_PROCESS_START_ID),
      staleAt,
    );

    let entered = false;
    await withFileLock(lockPath, { staleMs: 10_000, retryMs: 5, timeoutMs: 1_000 }, async () => {
      entered = true;
    });

    assert.equal(entered, true);
    await assert.rejects(() => stat(stalePath), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 清理缺少进程实例标识的 stale valid owner 即使 PID 仍存活", async () => {
  const dir = await tempDir();
  try {
    const lockPath = path.join(dir, "valid-stale-legacy-live-pid.lock");
    const staleAt = new Date(Date.now() - 60_000);
    const stalePath = await writeOwnerFile(
      lockPath,
      `${timestampFor(staleAt)}-${process.pid}-${OWNER_UUID}.json`,
      makeHolder("stale-legacy-live-pid-owner", staleAt, process.pid),
      staleAt,
    );

    let entered = false;
    await withFileLock(lockPath, { staleMs: 10_000, retryMs: 5, timeoutMs: 1_000 }, async () => {
      entered = true;
    });

    assert.equal(entered, true);
    await assert.rejects(() => stat(stalePath), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 删除 stale owner 失败时不会进入临界区", async () => {
  const dir = await tempDir();
  const mutableFsPromises = fsPromises as typeof fsPromises & {
    unlink: typeof fsPromises.unlink;
  };
  const originalUnlink = mutableFsPromises.unlink;
  try {
    const lockPath = path.join(dir, "stale-unlink-error.lock");
    const staleAt = new Date(Date.now() - 60_000);
    const stalePath = await writeOwnerFile(
      lockPath,
      "000-stale-unlink-error.json",
      makeHolder("stale-owner", staleAt),
      staleAt,
    );
    const stalePathResolved = path.resolve(stalePath);
    let entered = false;

    mutableFsPromises.unlink = (async (...args: Parameters<typeof fsPromises.unlink>) => {
      const target = args[0];
      if (typeof target === "string" && path.resolve(target) === stalePathResolved) {
        throw new Error("测试注入 unlink 失败");
      }
      return await originalUnlink(...args);
    }) as typeof fsPromises.unlink;
    syncBuiltinESMExports();

    await assert.rejects(
      () =>
        withFileLock(lockPath, { staleMs: 10_000, retryMs: 5, timeoutMs: 30 }, async () => {
          entered = true;
        }),
      /获取文件锁超时/,
    );

    assert.equal(entered, false);
    assert.deepEqual(JSON.parse(await readFile(stalePath, "utf8")), makeHolder("stale-owner", staleAt));
  } finally {
    mutableFsPromises.unlink = originalUnlink;
    syncBuiltinESMExports();
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 清理旧 malformed owner 后进入临界区", async () => {
  for (const malformed of ["{bad", ""]) {
    const dir = await tempDir();
    try {
      const lockPath = path.join(dir, "malformed-stale.lock");
      const staleAt = new Date(Date.now() - 60_000);
      const malformedPath = await writeOwnerFile(lockPath, "000-malformed-stale.json", malformed, staleAt);

      let entered = false;
      await withFileLock(lockPath, { staleMs: 10_000, retryMs: 5, timeoutMs: 1_000 }, async () => {
        entered = true;
      });

      assert.equal(entered, true);
      await assert.rejects(() => stat(malformedPath), /ENOENT/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("withFileLock 清理文件名 PID 存活但进程实例不匹配的 stale malformed owner", async () => {
  const dir = await tempDir();
  try {
    const lockPath = path.join(dir, "malformed-stale-pid-reused.lock");
    const staleAt = new Date(Date.now() - 60_000);
    const processStartId = await currentProcessStartId();
    assert.notEqual(processStartId, MISMATCHED_PROCESS_START_ID);
    const malformedPath = await writeOwnerFile(
      lockPath,
      ownerFileName(staleAt, process.pid, MISMATCHED_PROCESS_START_ID),
      "{bad",
      staleAt,
    );

    let entered = false;
    await withFileLock(lockPath, { staleMs: 10_000, retryMs: 5, timeoutMs: 1_000 }, async () => {
      entered = true;
      const currentOwnerPath = await onlyOwnerPath(lockPath);
      assert.match(
        path.basename(currentOwnerPath),
        new RegExp(`^\\d{13,}-${process.pid}-${processStartId}-[0-9a-f-]{36}\\.json$`),
      );
      const currentHolder = JSON.parse(await readFile(currentOwnerPath, "utf8")) as TestHolder;
      assert.equal(currentHolder.processStartId, processStartId);
    });

    assert.equal(entered, true);
    await assert.rejects(() => stat(malformedPath), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 不清理未过期 malformed owner", async () => {
  const dir = await tempDir();
  try {
    const lockPath = path.join(dir, "malformed-fresh.lock");
    const malformedPath = await writeOwnerFile(lockPath, "000-malformed-fresh.json", "{bad");

    await assert.rejects(
      () => withFileLock(lockPath, { staleMs: 10_000, retryMs: 5, timeoutMs: 30 }, async () => undefined),
      /获取文件锁超时/,
    );
    assert.equal(await readFile(malformedPath, "utf8"), "{bad");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 不用陈旧 mtime 清理 updatedAt 未过期的 owner", async () => {
  const dir = await tempDir();
  try {
    const lockPath = path.join(dir, "fresh-holder.lock");
    const oldMtime = new Date(Date.now() - 60_000);
    const freshHolder = makeHolder("fresh-owner", new Date(Date.now() - 1_000));
    freshHolder.updatedAt = new Date().toISOString();
    const freshPath = await writeOwnerFile(lockPath, "000-fresh-holder.json", freshHolder, oldMtime);

    await assert.rejects(
      () => withFileLock(lockPath, { staleMs: 10_000, retryMs: 5, timeoutMs: 30 }, async () => undefined),
      /获取文件锁超时/,
    );
    assert.deepEqual(JSON.parse(await readFile(freshPath, "utf8")), freshHolder);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 不把旧 updatedAt 但 fresh mtime 的合法 owner 当 stale 清理", async () => {
  const dir = await tempDir();
  try {
    const lockPath = path.join(dir, "fresh-mtime-holder.lock");
    const oldUpdatedAt = new Date(Date.now() - 60_000);
    const freshMtime = new Date();
    const holder = makeHolder("fresh-mtime-owner", oldUpdatedAt);
    const ownerPath = await writeOwnerFile(lockPath, "000-fresh-mtime-holder.json", holder, freshMtime);

    let entered = false;
    await assert.rejects(
      () =>
        withFileLock(lockPath, { staleMs: 10_000, retryMs: 5, timeoutMs: 30 }, async () => {
          entered = true;
        }),
      /获取文件锁超时/,
    );

    assert.equal(entered, false);
    assert.deepEqual(JSON.parse(await readFile(ownerPath, "utf8")), holder);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock heartbeat 写入失败会在返回时抛出清晰错误", async () => {
  const dir = await tempDir();
  const prototype = await getFileHandlePrototype(dir);
  const originalSync = prototype.sync;
  let failSync = false;
  let syncFailures = 0;
  try {
    const lockPath = path.join(dir, "heartbeat-error.lock");

    await assert.rejects(
      () =>
        withFileLock(lockPath, { staleMs: 30, retryMs: 5, timeoutMs: 1_000 }, async () => {
          prototype.sync = async function patchedSync(this: FileHandle): Promise<void> {
            if (failSync) {
              syncFailures += 1;
              throw new Error("测试注入 sync 失败");
            }
            return await originalSync.call(this);
          };
          failSync = true;
          await new Promise((resolve) => setTimeout(resolve, 50));
          failSync = false;
          prototype.sync = originalSync;
        }),
      /文件锁 heartbeat 写入失败/,
    );
    assert.equal(syncFailures > 0, true);
  } finally {
    failSync = false;
    prototype.sync = originalSync;
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock heartbeat truncate 后写入失败不会残留 malformed owner", async () => {
  const dir = await tempDir();
  const prototype = await getFileHandlePrototype(dir);
  const originalWrite = prototype.write;
  let failWrite = false;
  let writeFailures = 0;
  try {
    const lockPath = path.join(dir, "heartbeat-truncated-owner.lock");

    await assert.rejects(
      () =>
        withFileLock(lockPath, { staleMs: 30, retryMs: 5, timeoutMs: 1_000 }, async () => {
          prototype.write = (async function patchedWrite(this: FileHandle, ...args: unknown[]): Promise<unknown> {
            if (failWrite) {
              writeFailures += 1;
              throw new Error("测试注入 write 失败");
            }
            return await (originalWrite as (...innerArgs: unknown[]) => Promise<unknown>).apply(this, args);
          }) as FileHandle["write"];
          failWrite = true;
          await new Promise((resolve) => setTimeout(resolve, 50));
          failWrite = false;
          prototype.write = originalWrite;
        }),
      (error) => {
        const messages =
          error instanceof AggregateError
            ? [error.message, ...error.errors.map((inner) => (inner instanceof Error ? inner.message : String(inner)))]
            : [error instanceof Error ? error.message : String(error)];
        assert.equal(messages.some((message) => /文件锁 heartbeat 写入失败/.test(message)), true);
        return true;
      },
    );

    assert.equal(writeFailures > 0, true);
    const owners = (await readdir(stateDir(lockPath))).filter((entry) => entry.endsWith(".json"));
    assert.deepEqual(owners, []);
  } finally {
    failWrite = false;
    prototype.write = originalWrite;
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock owner 文件短写时拒绝获取锁", async () => {
  const dir = await tempDir();
  const prototype = await getFileHandlePrototype(dir);
  const originalWrite = prototype.write;
  let shortWrites = 0;
  let entered = false;
  try {
    const lockPath = path.join(dir, "short-write.lock");

    prototype.write = (async (...args: unknown[]): Promise<unknown> => {
      shortWrites += 1;
      const content = typeof args[0] === "string" ? args[0] : "";
      return {
        bytesWritten: Math.max(0, Buffer.byteLength(content, "utf8") - 1),
        buffer: args[0],
      };
    }) as FileHandle["write"];

    await assert.rejects(
      () =>
        withFileLock(lockPath, { staleMs: 30, retryMs: 5, timeoutMs: 80 }, async () => {
          entered = true;
        }),
      /文件锁 owner 写入不完整/,
    );

    assert.equal(entered, false);
    assert.equal(shortWrites > 0, true);
  } finally {
    prototype.write = originalWrite;
    await rm(dir, { recursive: true, force: true });
  }
});

test("withFileLock 拒绝非法锁参数", async () => {
  const dir = await tempDir();
  try {
    const lockPath = path.join(dir, "invalid.lock");

    await assert.rejects(
      () => withFileLock(lockPath, { staleMs: 0, retryMs: 10, timeoutMs: 100 }, async () => undefined),
      /staleMs 必须大于 0/,
    );
    await assert.rejects(
      () => withFileLock(lockPath, { staleMs: 100, retryMs: 0, timeoutMs: 100 }, async () => undefined),
      /retryMs 必须大于 0/,
    );
    await assert.rejects(
      () => withFileLock(lockPath, { staleMs: 100, retryMs: 10, timeoutMs: -1 }, async () => undefined),
      /timeoutMs 必须大于等于 0/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
