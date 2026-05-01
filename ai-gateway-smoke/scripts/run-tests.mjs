import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

async function collectTests(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const tests = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      tests.push(...(await collectTests(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      tests.push(fullPath);
    }
  }
  return tests.sort();
}

const tests =
  process.argv.length > 2
    ? process.argv.slice(2).map((testPath) => path.resolve(testPath))
    : await collectTests(path.resolve("tests"));
if (tests.length === 0) {
  process.stderr.write("未找到测试文件。\n");
  process.exit(1);
}

const child = spawn(process.execPath, ["--import", "tsx", "--test", ...tests], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
