import { constants } from "node:fs";
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const MAX_TEMP_FILE_CREATE_ATTEMPTS = 10;

export async function readJsonFile<T = unknown>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`${path.basename(filePath)} 不是合法 JSON`, { cause: error });
  }
}

export async function assertSecretFilePermissions(filePath: string): Promise<void> {
  const info = await stat(filePath);
  const mode = info.mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(`${filePath} 权限不安全，期望 0600，当前 ${mode.toString(8)}`);
  }
}

export async function ensurePrivateDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

export async function writeSecretJsonFile(filePath: string, value: unknown): Promise<void> {
  const serialized = serializeJsonFileValue(filePath, value);
  const dir = path.dirname(filePath);
  await ensurePrivateDirectory(dir);

  const { handle, tempPath } = await createTempFile(filePath);
  let renamed = false;
  try {
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();

    await chmod(tempPath, 0o600);
    await rename(tempPath, filePath);
    renamed = true;
    await chmod(filePath, 0o600);
    await fsyncParentDirBestEffort(dir);
  } catch (error) {
    await handle.close().catch(() => undefined);
    if (!renamed) {
      try {
        await removeIfExists(tempPath);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `${path.basename(filePath)} 写入失败，且临时文件清理失败`);
      }
    }
    throw error;
  }
}

function serializeJsonFileValue(filePath: string, value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new Error(`${path.basename(filePath)} 顶层值不是合法 JSON`);
  }
  return `${serialized}\n`;
}

export async function removeIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function fsyncParentDirBestEffort(dir: string): Promise<void> {
  try {
    const handle = await open(dir, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // 部分平台不支持目录 fsync；这里按 best-effort 处理。
  }
}

async function createTempFile(filePath: string) {
  const dir = path.dirname(filePath);
  const basename = path.basename(filePath);
  for (let attempt = 0; attempt < MAX_TEMP_FILE_CREATE_ATTEMPTS; attempt += 1) {
    const tempPath = path.join(dir, `.${basename}.${randomUUID()}.tmp`);
    try {
      const handle = await open(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      return { handle, tempPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }
  throw new Error(`${filePath} 创建临时文件失败`);
}
