import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fsPromises, { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { assertSecretFilePermissions, readJsonFile, writeSecretJsonFile } from "../src/util/json-file.js";

async function tempDir(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "ai-gateway-json-"));
}

test("writeSecretJsonFile 写入 0600 JSON", async () => {
  const dir = await tempDir();
  try {
    const file = path.join(dir, "credentials.json");

    await writeSecretJsonFile(file, { ok: true });

    assert.deepEqual(await readJsonFile(file), { ok: true });
    assert.equal(await readFile(file, "utf8"), "{\n  \"ok\": true\n}\n");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeSecretJsonFile 收敛已有父目录权限到 0700", async () => {
  const dir = await tempDir();
  try {
    const secretDir = path.join(dir, "secrets");
    await mkdir(secretDir, { mode: 0o777 });
    await chmod(secretDir, 0o777);
    const file = path.join(secretDir, "credentials.json");

    await writeSecretJsonFile(file, { ok: true });

    assert.equal((await stat(secretDir)).mode & 0o777, 0o700);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeSecretJsonFile 拒绝顶层 undefined", async () => {
  const dir = await tempDir();
  try {
    const file = path.join(dir, "credentials.json");

    await assert.rejects(() => writeSecretJsonFile(file, undefined), /顶层值不是合法 JSON/);
    await assert.rejects(() => stat(file), /ENOENT/);
    const entries = await readdir(dir);
    assert.deepEqual(
      entries.filter((entry) => entry.startsWith(".credentials.json.") && entry.endsWith(".tmp")),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertSecretFilePermissions 拒绝 group/world 权限", async () => {
  const dir = await tempDir();
  try {
    const file = path.join(dir, "credentials.json");
    await writeFile(file, "{}", { mode: 0o644 });
    await chmod(file, 0o644);

    await assert.rejects(() => assertSecretFilePermissions(file), /权限不安全/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertSecretFilePermissions 严格要求 0600", async () => {
  const dir = await tempDir();
  try {
    const file = path.join(dir, "credentials.json");
    await writeFile(file, "{}", { mode: 0o600 });

    await chmod(file, 0o400);
    await assert.rejects(() => assertSecretFilePermissions(file), /权限不安全/);

    await chmod(file, 0o700);
    await assert.rejects(() => assertSecretFilePermissions(file), /权限不安全/);

    await chmod(file, 0o600);
    await assert.doesNotReject(() => assertSecretFilePermissions(file));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readJsonFile 对非法 JSON 返回文件名", async () => {
  const dir = await tempDir();
  try {
    const file = path.join(dir, "bad.json");
    await writeFile(file, "{bad", "utf8");

    await assert.rejects(() => readJsonFile(file), /bad.json 不是合法 JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeSecretJsonFile 临时文件创建后的写入失败会清理临时文件", async () => {
  const dir = await tempDir();
  try {
    const file = path.join(dir, "credentials.json");
    await mkdir(file);

    await assert.rejects(() => writeSecretJsonFile(file, { ok: true }), /EISDIR|ENOTDIR|EPERM/);

    const entries = await readdir(dir);
    assert.deepEqual(
      entries.filter((entry) => entry.startsWith(".credentials.json.") && entry.endsWith(".tmp")),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeSecretJsonFile 写入失败且临时文件清理失败会报告清理错误", async () => {
  const dir = await tempDir();
  const originalUnlink = fsPromises.unlink;
  try {
    const file = path.join(dir, "credentials.json");
    await mkdir(file);

    let cleanupFailures = 0;
    let tempPath = "";
    fsPromises.unlink = (async (...args: Parameters<typeof originalUnlink>) => {
      const target = String(args[0]);
      if (path.basename(target).startsWith(".credentials.json.") && target.endsWith(".tmp")) {
        cleanupFailures += 1;
        tempPath = target;
        throw new Error("测试注入临时文件清理失败");
      }
      return await originalUnlink(...args);
    }) as typeof originalUnlink;
    syncBuiltinESMExports();

    await assert.rejects(
      () => writeSecretJsonFile(file, { ok: true }),
      (error) => {
        assert.match((error as Error).message, /临时文件清理失败/);
        return true;
      },
    );
    assert.equal(cleanupFailures, 1);
    assert.equal((await stat(tempPath)).mode & 0o777, 0o600);
  } finally {
    fsPromises.unlink = originalUnlink;
    syncBuiltinESMExports();
    await rm(dir, { recursive: true, force: true });
  }
});
