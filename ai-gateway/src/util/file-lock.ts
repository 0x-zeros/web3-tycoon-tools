import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { open, readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { ensurePrivateDirectory } from "./json-file.js";

const OWNER_STABILITY_MAX_WAIT_MS = 5;
const OWNER_FILE_NAME_PATTERN =
  /^\d{13,}-([1-9]\d*)(?:-(\d+))?-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;
const PROCESS_START_ID_PATTERN = /^\d+$/;

export type FileLockOptions = {
  staleMs: number;
  retryMs: number;
  timeoutMs: number;
};

const DEFAULT_FILE_LOCK_OPTIONS: FileLockOptions = {
  staleMs: 30_000,
  retryMs: 100,
  timeoutMs: 30_000,
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function retryWaitMs(options: FileLockOptions): number {
  return Math.max(1, Math.min(options.retryMs, Math.floor(options.staleMs / 3)));
}

function ownerStabilityWaitMs(options: FileLockOptions): number {
  return Math.min(OWNER_STABILITY_MAX_WAIT_MS, retryWaitMs(options));
}

async function sleepUntilNextRetry(deadline: number, waitMs: number): Promise<boolean> {
  const sleepMs = Math.min(waitMs, remainingMs(deadline));
  if (sleepMs <= 0) {
    return false;
  }
  await sleep(sleepMs);
  return true;
}

function validateOptions(options: FileLockOptions): void {
  if (!Number.isFinite(options.staleMs) || options.staleMs <= 0) {
    throw new Error("staleMs 必须大于 0");
  }
  if (!Number.isFinite(options.retryMs) || options.retryMs <= 0) {
    throw new Error("retryMs 必须大于 0");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
    throw new Error("timeoutMs 必须大于等于 0");
  }
}

function resolveOptions(options: Partial<FileLockOptions> | undefined): FileLockOptions {
  const resolved = {
    ...DEFAULT_FILE_LOCK_OPTIONS,
    ...options,
  };
  validateOptions(resolved);
  return resolved;
}

type LockHolder = {
  pid: number;
  processStartId?: string;
  ownerToken: string;
  acquiredAt: string;
  updatedAt: string;
  createdAtMs?: number;
};

type AcquiredLock = {
  lockPath: string;
  stateDir: string;
  ownerPath: string;
  ownerFileName: string;
  ownerToken: string;
  acquiredAt: string;
  createdAtMs: number;
  processStartId: string | undefined;
  handle: FileHandle;
};

type HeartbeatController = {
  stop: () => Promise<void>;
  getError: () => Error | undefined;
};

type ValidOwnerSnapshot = {
  state: "valid";
  fileName: string;
  filePath: string;
  raw: string;
  holder: LockHolder;
  stats: Stats;
};

type MalformedOwnerSnapshot = {
  state: "malformed";
  fileName: string;
  filePath: string;
  raw: string;
  mtimeMs: number;
  stats: Stats;
};

type UnstableOwnerSnapshot = {
  state: "unstable";
  fileName: string;
  filePath: string;
};

type StableOwnerSnapshot = ValidOwnerSnapshot | MalformedOwnerSnapshot;

type OwnerSnapshot = StableOwnerSnapshot | UnstableOwnerSnapshot;

type ElectionResult = {
  winner: ValidOwnerSnapshot | undefined;
  blockedByOwner: boolean;
};

class HeartbeatOwnershipError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HeartbeatOwnershipError";
  }
}

function stateDirFor(lockPath: string): string {
  return `${lockPath}.holders`;
}

function currentHighResolutionWallClockMs(): number {
  return performance.timeOrigin + performance.now();
}

function parseLinuxProcessStartId(raw: string): string | undefined {
  const commandEndIndex = raw.lastIndexOf(")");
  if (commandEndIndex === -1) {
    return undefined;
  }

  const fieldsAfterCommand = raw.slice(commandEndIndex + 2).trim().split(/\s+/);
  const processStartId = fieldsAfterCommand[19];
  if (processStartId === undefined || !PROCESS_START_ID_PATTERN.test(processStartId)) {
    return undefined;
  }
  return processStartId;
}

async function readProcessStartId(pid: number): Promise<string | undefined> {
  if (!Number.isInteger(pid) || pid <= 0 || process.platform !== "linux") {
    return undefined;
  }

  try {
    const raw = await readFile(pid === process.pid ? "/proc/self/stat" : `/proc/${pid}/stat`, "utf8");
    return parseLinuxProcessStartId(raw);
  } catch {
    return undefined;
  }
}

function buildHolder(
  ownerToken: string,
  acquiredAt: string,
  createdAtMs: number,
  processStartId: string | undefined,
): LockHolder {
  const holder: LockHolder = {
    pid: process.pid,
    ownerToken,
    acquiredAt,
    updatedAt: new Date().toISOString(),
    createdAtMs,
  };
  if (processStartId !== undefined) {
    holder.processStartId = processStartId;
  }
  return holder;
}

async function writeHolder(handle: FileHandle, holder: LockHolder): Promise<void> {
  const content = `${JSON.stringify(holder)}\n`;
  await handle.truncate(0);
  const { bytesWritten } = await handle.write(content, 0, "utf8");
  const expectedBytes = Buffer.byteLength(content, "utf8");
  if (bytesWritten !== expectedBytes) {
    throw new Error(`文件锁 owner 写入不完整: ${bytesWritten}/${expectedBytes} bytes`);
  }
  await handle.chmod(0o600);
  await handle.sync();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseLockHolder(raw: string): LockHolder | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) {
      return undefined;
    }
    if (
      typeof value.pid !== "number" ||
      typeof value.ownerToken !== "string" ||
      typeof value.acquiredAt !== "string" ||
      typeof value.updatedAt !== "string"
    ) {
      return undefined;
    }
    if (!Number.isFinite(Date.parse(value.acquiredAt)) || !Number.isFinite(Date.parse(value.updatedAt))) {
      return undefined;
    }
    if (value.createdAtMs !== undefined && (typeof value.createdAtMs !== "number" || !Number.isFinite(value.createdAtMs))) {
      return undefined;
    }
    if (
      value.processStartId !== undefined &&
      (typeof value.processStartId !== "string" || !PROCESS_START_ID_PATTERN.test(value.processStartId))
    ) {
      return undefined;
    }
    return {
      pid: value.pid,
      processStartId: value.processStartId,
      ownerToken: value.ownerToken,
      acquiredAt: value.acquiredAt,
      updatedAt: value.updatedAt,
      createdAtMs: value.createdAtMs,
    };
  } catch {
    return undefined;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function isLiveLocalPid(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isErrno(error, "EPERM")) {
      return true;
    }
    if (
      isErrno(error, "ESRCH") ||
      isErrno(error, "EINVAL") ||
      isErrno(error, "ERR_INVALID_ARG_TYPE") ||
      isErrno(error, "ERR_OUT_OF_RANGE")
    ) {
      return false;
    }
    return true;
  }
}

type OwnerFileNameInfo = {
  pid: number;
  processStartId: string | undefined;
};

function parseOwnerFileNameInfo(fileName: string): OwnerFileNameInfo | undefined {
  const match = OWNER_FILE_NAME_PATTERN.exec(fileName);
  if (!match) {
    return undefined;
  }

  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return undefined;
  }
  return {
    pid,
    processStartId: match[2],
  };
}

function validOwnerProcessStartId(snapshot: ValidOwnerSnapshot): string | undefined {
  if (snapshot.holder.processStartId !== undefined) {
    return snapshot.holder.processStartId;
  }

  const fileInfo = parseOwnerFileNameInfo(snapshot.fileName);
  if (fileInfo?.pid !== snapshot.holder.pid) {
    return undefined;
  }
  return fileInfo.processStartId;
}

async function isLiveProcessInstance(pid: number, processStartId: string | undefined): Promise<boolean> {
  if (!isLiveLocalPid(pid) || processStartId === undefined) {
    return false;
  }

  const currentProcessStartId = await readProcessStartId(pid);
  return currentProcessStartId !== undefined && currentProcessStartId === processStartId;
}

async function isValidOwnerBlockedByLiveProcess(snapshot: ValidOwnerSnapshot): Promise<boolean> {
  return await isLiveProcessInstance(snapshot.holder.pid, validOwnerProcessStartId(snapshot));
}

async function isMalformedOwnerBlockedByLiveProcess(snapshot: MalformedOwnerSnapshot): Promise<boolean> {
  const fileInfo = parseOwnerFileNameInfo(snapshot.fileName);
  return fileInfo !== undefined && (await isLiveProcessInstance(fileInfo.pid, fileInfo.processStartId));
}

function validOwnerRefreshedAtMs(snapshot: ValidOwnerSnapshot): number {
  return Math.max(Date.parse(snapshot.holder.updatedAt), snapshot.stats.mtimeMs);
}

function isValidOwnerStale(snapshot: ValidOwnerSnapshot, staleMs: number): boolean {
  return Date.now() - validOwnerRefreshedAtMs(snapshot) > staleMs;
}

function isMalformedOwnerStale(snapshot: MalformedOwnerSnapshot, staleMs: number): boolean {
  return Date.now() - snapshot.mtimeMs > staleMs;
}

function sameFileByStat(left: Stats, right: Stats): boolean {
  if (left.ino === 0 && right.ino === 0) {
    return left.dev === right.dev && left.size === right.size && left.mtimeMs === right.mtimeMs;
  }
  return left.dev === right.dev && left.ino === right.ino;
}

function sameOwnerFileVersion(left: Stats, right: Stats): boolean {
  return (
    sameFileByStat(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function sameLockHolder(left: LockHolder, right: LockHolder): boolean {
  return (
    left.pid === right.pid &&
    left.processStartId === right.processStartId &&
    left.ownerToken === right.ownerToken &&
    left.acquiredAt === right.acquiredAt &&
    left.updatedAt === right.updatedAt &&
    left.createdAtMs === right.createdAtMs
  );
}

function isSameValidOwnerSnapshot(snapshot: ValidOwnerSnapshot, current: OwnerSnapshot): current is ValidOwnerSnapshot {
  return (
    current.state === "valid" &&
    sameOwnerFileVersion(snapshot.stats, current.stats) &&
    snapshot.raw === current.raw &&
    sameLockHolder(snapshot.holder, current.holder)
  );
}

function isSameMalformedOwnerSnapshot(snapshot: MalformedOwnerSnapshot, current: OwnerSnapshot): current is MalformedOwnerSnapshot {
  return (
    current.state === "malformed" &&
    sameOwnerFileVersion(snapshot.stats, current.stats) &&
    snapshot.raw === current.raw &&
    snapshot.mtimeMs === current.mtimeMs
  );
}

function isOwnSnapshot(snapshot: ValidOwnerSnapshot | undefined, lock: AcquiredLock): boolean {
  return (
    snapshot?.filePath === lock.ownerPath &&
    snapshot.holder.processStartId === lock.processStartId &&
    snapshot.holder.ownerToken === lock.ownerToken &&
    snapshot.holder.acquiredAt === lock.acquiredAt &&
    snapshot.holder.createdAtMs === lock.createdAtMs
  );
}

function compareOwnerCreationOrder(left: LockHolder, right: LockHolder): number {
  if (left.createdAtMs !== undefined && right.createdAtMs !== undefined) {
    return left.createdAtMs - right.createdAtMs;
  }
  if (left.createdAtMs === undefined && right.createdAtMs !== undefined) {
    return -1;
  }
  if (left.createdAtMs !== undefined && right.createdAtMs === undefined) {
    return 1;
  }
  return 0;
}

function compareOwners(left: ValidOwnerSnapshot, right: ValidOwnerSnapshot): number {
  const acquiredDiff = Date.parse(left.holder.acquiredAt) - Date.parse(right.holder.acquiredAt);
  if (acquiredDiff !== 0) {
    return acquiredDiff;
  }
  const creationDiff = compareOwnerCreationOrder(left.holder, right.holder);
  if (creationDiff !== 0) {
    return creationDiff;
  }
  return left.fileName.localeCompare(right.fileName);
}

function buildOwnerSnapshot(
  fileName: string,
  filePath: string,
  raw: string,
  stats: Stats,
): StableOwnerSnapshot {
  const holder = parseLockHolder(raw);
  if (!holder) {
    return { state: "malformed", fileName, filePath, raw, mtimeMs: stats.mtimeMs, stats };
  }
  return { state: "valid", fileName, filePath, raw, holder, stats };
}

async function readOwnerSnapshot(stateDir: string, fileName: string): Promise<OwnerSnapshot | undefined> {
  const filePath = path.join(stateDir, fileName);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let handle: FileHandle | undefined;
    try {
      handle = await open(filePath, constants.O_RDONLY);
      const before = await handle.stat();
      const raw = await handle.readFile("utf8");
      const after = await handle.stat();
      if (!sameOwnerFileVersion(before, after)) {
        continue;
      }

      const pathInfo = await stat(filePath);
      if (!sameOwnerFileVersion(after, pathInfo)) {
        continue;
      }

      return buildOwnerSnapshot(fileName, filePath, raw, after);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return undefined;
      }
      throw error;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
  return { state: "unstable", fileName, filePath };
}

async function unlinkSnapshotPathIfStillMatches(snapshot: StableOwnerSnapshot): Promise<boolean> {
  let pathInfo: Stats;
  try {
    pathInfo = await stat(snapshot.filePath);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return true;
    }
    throw error;
  }

  if (!sameOwnerFileVersion(snapshot.stats, pathInfo)) {
    return false;
  }

  try {
    await unlink(snapshot.filePath);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return true;
    }
    return false;
  }
  return true;
}

async function unlinkBestEffort(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // stale owner 文件名唯一，清理失败不应阻塞后续竞选。
  }
}

async function removeStaleOwnerIfUnchanged(
  stateDir: string,
  snapshot: StableOwnerSnapshot,
  staleMs: number,
): Promise<OwnerSnapshot | undefined> {
  const current = await readOwnerSnapshot(stateDir, snapshot.fileName);
  if (!current) {
    return undefined;
  }

  if (snapshot.state === "valid") {
    if (isSameValidOwnerSnapshot(snapshot, current) && isValidOwnerStale(current, staleMs)) {
      if (await isValidOwnerBlockedByLiveProcess(current)) {
        return current;
      }
      if (await unlinkSnapshotPathIfStillMatches(current)) {
        return undefined;
      }
      return await readOwnerSnapshot(stateDir, snapshot.fileName);
    }
    return current;
  }

  if (isSameMalformedOwnerSnapshot(snapshot, current) && isMalformedOwnerStale(current, staleMs)) {
    if (await isMalformedOwnerBlockedByLiveProcess(current)) {
      return current;
    }
    if (await unlinkSnapshotPathIfStillMatches(current)) {
      return undefined;
    }
    return await readOwnerSnapshot(stateDir, snapshot.fileName);
  }
  return current;
}

async function trackActiveOwner(
  snapshot: OwnerSnapshot,
  staleMs: number,
  activeOwners: ValidOwnerSnapshot[],
): Promise<boolean> {
  if (snapshot.state === "unstable") {
    return true;
  }

  if (snapshot.state === "malformed") {
    return true;
  }

  if (!isValidOwnerStale(snapshot, staleMs)) {
    activeOwners.push(snapshot);
    return false;
  }

  if (await isValidOwnerBlockedByLiveProcess(snapshot)) {
    activeOwners.push(snapshot);
  }
  return true;
}

async function electOwner(stateDir: string, staleMs: number): Promise<ElectionResult> {
  let entries;
  try {
    entries = await readdir(stateDir, { withFileTypes: true });
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      await ensurePrivateDirectory(stateDir);
      return { winner: undefined, blockedByOwner: false };
    }
    throw error;
  }

  const activeOwners: ValidOwnerSnapshot[] = [];
  let blockedByOwner = false;
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const snapshot = await readOwnerSnapshot(stateDir, entry.name);
    if (!snapshot) {
      continue;
    }
    if (snapshot.state === "unstable") {
      blockedByOwner = true;
      continue;
    }
    if (snapshot.state === "malformed") {
      if (isMalformedOwnerStale(snapshot, staleMs)) {
        const current = await removeStaleOwnerIfUnchanged(stateDir, snapshot, staleMs);
        if (current) {
          blockedByOwner = (await trackActiveOwner(current, staleMs, activeOwners)) || blockedByOwner;
        }
      } else {
        blockedByOwner = true;
      }
      continue;
    }

    if (isValidOwnerStale(snapshot, staleMs)) {
      const current = await removeStaleOwnerIfUnchanged(stateDir, snapshot, staleMs);
      if (current) {
        blockedByOwner = (await trackActiveOwner(current, staleMs, activeOwners)) || blockedByOwner;
      }
    } else {
      activeOwners.push(snapshot);
    }
  }

  activeOwners.sort(compareOwners);
  return { winner: activeOwners[0], blockedByOwner };
}

function buildOwnerFileName(timestamp: string, pid: number, processStartId: string | undefined, uuid: string): string {
  if (processStartId === undefined) {
    return `${timestamp}-${pid}-${uuid}.json`;
  }
  return `${timestamp}-${pid}-${processStartId}-${uuid}.json`;
}

async function createOwnerFile(lockPath: string, stateDir: string): Promise<AcquiredLock> {
  const ownerToken = randomUUID();
  const acquiredAt = new Date().toISOString();
  const createdAtMs = currentHighResolutionWallClockMs();
  const processStartId = await readProcessStartId(process.pid);
  const timestamp = String(Date.parse(acquiredAt)).padStart(13, "0");

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const ownerFileName = buildOwnerFileName(timestamp, process.pid, processStartId, randomUUID());
    const ownerPath = path.join(stateDir, ownerFileName);
    let handle: FileHandle | undefined;
    try {
      handle = await open(ownerPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
      await writeHolder(handle, buildHolder(ownerToken, acquiredAt, createdAtMs, processStartId));
      return { lockPath, stateDir, ownerPath, ownerFileName, ownerToken, acquiredAt, createdAtMs, processStartId, handle };
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined);
        await unlinkBestEffort(ownerPath);
      }
      if (isErrno(error, "EEXIST")) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`创建文件锁 owner 文件失败: ${lockPath}`);
}

async function refreshOwner(lock: AcquiredLock): Promise<void> {
  await writeHolder(lock.handle, buildHolder(lock.ownerToken, lock.acquiredAt, lock.createdAtMs, lock.processStartId));
}

async function statOwnerPathForHandle(lock: AcquiredLock): Promise<Stats> {
  let handleInfo: Stats;
  let pathInfo: Stats;
  try {
    handleInfo = await lock.handle.stat();
    pathInfo = await stat(lock.ownerPath);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      throw new Error(`文件锁已丢失或 owner 文件不存在: ${lock.lockPath}`, { cause: error });
    }
    throw error;
  }

  if (!sameFileByStat(handleInfo, pathInfo)) {
    throw new Error(`文件锁已丢失或被其他 owner 替换: ${lock.lockPath}`);
  }

  return pathInfo;
}

async function readOwnOwnerSnapshot(lock: AcquiredLock): Promise<StableOwnerSnapshot> {
  const pathInfo = await statOwnerPathForHandle(lock);

  const snapshot = await readOwnerSnapshot(lock.stateDir, lock.ownerFileName);
  if (!snapshot) {
    throw new Error(`文件锁已丢失或 owner 文件不存在: ${lock.lockPath}`);
  }
  if (snapshot.state === "unstable") {
    throw new Error(`文件锁已丢失或 owner 文件无效: ${lock.lockPath}`);
  }
  if (!sameFileByStat(pathInfo, snapshot.stats)) {
    throw new Error(`文件锁已丢失或被其他 owner 替换: ${lock.lockPath}`);
  }

  return snapshot;
}

async function verifyOwnOwnerFile(lock: AcquiredLock): Promise<ValidOwnerSnapshot> {
  const snapshot = await readOwnOwnerSnapshot(lock);
  if (snapshot.state !== "valid") {
    throw new Error(`文件锁已丢失或 owner 文件无效: ${lock.lockPath}`);
  }
  if (
    snapshot.holder.processStartId !== lock.processStartId ||
    snapshot.holder.ownerToken !== lock.ownerToken ||
    snapshot.holder.acquiredAt !== lock.acquiredAt ||
    snapshot.holder.createdAtMs !== lock.createdAtMs
  ) {
    throw new Error(`文件锁已丢失或被其他 owner 替换: ${lock.lockPath}`);
  }
  return snapshot;
}

async function verifyReleasableOwnerFile(lock: AcquiredLock): Promise<void> {
  const snapshot = await readOwnOwnerSnapshot(lock);
  if (snapshot.state === "malformed") {
    return;
  }
  if (
    snapshot.holder.processStartId !== lock.processStartId ||
    snapshot.holder.ownerToken !== lock.ownerToken ||
    snapshot.holder.acquiredAt !== lock.acquiredAt ||
    snapshot.holder.createdAtMs !== lock.createdAtMs
  ) {
    throw new Error(`文件锁已丢失或被其他 owner 替换: ${lock.lockPath}`);
  }
}

async function unlinkOwnOwnerPath(lock: AcquiredLock): Promise<void> {
  await statOwnerPathForHandle(lock);
  try {
    await unlink(lock.ownerPath);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      throw new Error(`文件锁已丢失或 owner 文件不存在: ${lock.lockPath}`, { cause: error });
    }
    throw error;
  }
}

async function cleanupOwnOwnerFile(lock: AcquiredLock): Promise<void> {
  try {
    await verifyReleasableOwnerFile(lock);
    await unlinkOwnOwnerPath(lock);
  } catch {
    // 超时或获取失败时只清理自己的唯一 owner 文件；校验失败则避免误删。
  } finally {
    await lock.handle.close().catch(() => undefined);
  }
}

async function releaseLock(lock: AcquiredLock): Promise<void> {
  try {
    await verifyReleasableOwnerFile(lock);
    await unlinkOwnOwnerPath(lock);
  } finally {
    await lock.handle.close().catch(() => undefined);
  }
}

async function acquireLock(lockPath: string, options: FileLockOptions): Promise<AcquiredLock> {
  const stateDir = stateDirFor(lockPath);
  await ensurePrivateDirectory(stateDir);

  const lock = await createOwnerFile(lockPath, stateDir);
  const deadline = Date.now() + options.timeoutMs;
  const stabilityWaitMs = ownerStabilityWaitMs(options);
  let attempted = false;
  try {
    await sleep(stabilityWaitMs);
    while (!attempted || Date.now() <= deadline) {
      attempted = true;
      await refreshOwner(lock);
      const election = await electOwner(stateDir, options.staleMs);
      if (!election.blockedByOwner && isOwnSnapshot(election.winner, lock)) {
        await sleep(stabilityWaitMs);
        await refreshOwner(lock);
        const confirmation = await electOwner(stateDir, options.staleMs);
        if (!confirmation.blockedByOwner && isOwnSnapshot(confirmation.winner, lock)) {
          return lock;
        }
      }
      if (!(await sleepUntilNextRetry(deadline, retryWaitMs(options)))) {
        break;
      }
    }
    throw new Error(`获取文件锁超时: ${lockPath}`);
  } catch (error) {
    await cleanupOwnOwnerFile(lock);
    throw error;
  }
}

async function verifyHeartbeatOwnership(lock: AcquiredLock, options: FileLockOptions): Promise<void> {
  await verifyOwnOwnerFile(lock);
  const election = await electOwner(lock.stateDir, options.staleMs);
  if (!isOwnSnapshot(election.winner, lock)) {
    throw new HeartbeatOwnershipError(`文件锁 heartbeat 检测到当前 owner 不再持锁: ${lock.lockPath}`);
  }
}

function toHeartbeatWriteError(error: unknown): Error {
  const code = isRecord(error) ? error.code : undefined;
  const detail = typeof code === "string" ? `: ${code}` : "";
  return new Error(`文件锁 heartbeat 写入失败${detail}`, { cause: error });
}

function toHeartbeatError(lock: AcquiredLock, error: unknown): Error {
  if (error instanceof HeartbeatOwnershipError) {
    return error;
  }
  if (error instanceof Error && error.message.startsWith("文件锁已丢失")) {
    return new HeartbeatOwnershipError(`文件锁 heartbeat 检测到文件锁已丢失: ${lock.lockPath}`, { cause: error });
  }
  return toHeartbeatWriteError(error);
}

async function touchOwnerMtime(lock: AcquiredLock): Promise<void> {
  await statOwnerPathForHandle(lock);
  const now = new Date();
  await lock.handle.utimes(now, now);
}

function startHeartbeat(lock: AcquiredLock, options: FileLockOptions): HeartbeatController {
  const heartbeatMs = retryWaitMs(options);
  let writing = false;
  let pending: Promise<void> | undefined;
  let heartbeatError: Error | undefined;

  async function recordHeartbeatFailure(error: unknown): Promise<void> {
    const heartbeatFailure = toHeartbeatError(lock, error);
    if (heartbeatFailure instanceof HeartbeatOwnershipError) {
      heartbeatError ??= heartbeatFailure;
      return;
    }

    try {
      await touchOwnerMtime(lock);
    } catch (touchError) {
      const touchFailure = toHeartbeatError(lock, touchError);
      heartbeatError ??= touchFailure instanceof HeartbeatOwnershipError ? touchFailure : heartbeatFailure;
      return;
    }

    heartbeatError ??= heartbeatFailure;
  }

  const timer = setInterval(() => {
    if (writing) {
      return;
    }
    writing = true;
    pending = (async () => {
      try {
        await refreshOwner(lock);
        await verifyHeartbeatOwnership(lock, options);
      } catch (error) {
        await recordHeartbeatFailure(error);
      }
    })()
      .finally(() => {
        writing = false;
      });
  }, heartbeatMs);
  timer.unref();

  return {
    stop: async () => {
      clearInterval(timer);
      await pending;
      if (heartbeatError) {
        throw heartbeatError;
      }
    },
    getError: () => heartbeatError,
  };
}

export function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options?: Partial<FileLockOptions>,
): Promise<T>;
export function withFileLock<T>(
  lockPath: string,
  options: Partial<FileLockOptions>,
  fn: () => Promise<T>,
): Promise<T>;
export async function withFileLock<T>(
  lockPath: string,
  fnOrOptions: (() => Promise<T>) | Partial<FileLockOptions>,
  optionsOrFn?: Partial<FileLockOptions> | (() => Promise<T>),
): Promise<T> {
  let fn: () => Promise<T>;
  let optionsInput: Partial<FileLockOptions> | undefined;
  if (typeof fnOrOptions === "function") {
    fn = fnOrOptions;
    if (optionsOrFn !== undefined && typeof optionsOrFn !== "object") {
      throw new Error("withFileLock 参数无效");
    }
    optionsInput = optionsOrFn;
  } else {
    if (typeof optionsOrFn !== "function") {
      throw new Error("withFileLock 参数无效");
    }
    optionsInput = fnOrOptions;
    fn = optionsOrFn;
  }

  const options = resolveOptions(optionsInput);
  const lock = await acquireLock(lockPath, options);
  const heartbeat = startHeartbeat(lock, options);
  let result: T | undefined;
  let fnError: unknown;
  let hasFnError = false;

  try {
    result = await fn();
  } catch (error) {
    fnError = error;
    hasFnError = true;
  }

  const cleanupErrors: unknown[] = [];
  try {
    await heartbeat.stop();
  } catch (error) {
    cleanupErrors.push(error);
  }
  const heartbeatError = heartbeat.getError();
  if (heartbeatError && !cleanupErrors.includes(heartbeatError)) {
    cleanupErrors.push(heartbeatError);
  }
  try {
    await releaseLock(lock);
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (hasFnError) {
    if (cleanupErrors.length === 0) {
      throw fnError;
    }
    throw new AggregateError([fnError, ...cleanupErrors], "文件锁临界区执行失败，且释放阶段也发生错误");
  }
  if (cleanupErrors.length === 1) {
    throw cleanupErrors[0];
  }
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, "文件锁释放阶段发生多个错误");
  }
  return result as T;
}
