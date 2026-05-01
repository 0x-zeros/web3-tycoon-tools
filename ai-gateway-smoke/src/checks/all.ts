// check:all
// 顺序跑全部 5 个 check：health → status → responses → responses:stream → errors。
// 任一失败立即非零退出。**会消耗 2 次上游模型额度**（responses + responses:stream）。
import { runErrorsCheck } from "./errors.js";
import { runHealthCheck } from "./health.js";
import { runResponsesCheck } from "./responses.js";
import { runResponsesStreamCheck } from "./responses-stream.js";
import { runStatusCheck } from "./status.js";
import { fail, ok, section } from "../utils/print.js";

async function main(): Promise<void> {
  await runHealthCheck();
  await runStatusCheck();
  await runResponsesCheck();
  await runResponsesStreamCheck();
  await runErrorsCheck();
  section("结果");
  ok("全部冒烟检查通过");
}

main().catch((error) => {
  fail("冒烟检查中断", error instanceof Error ? error.message : String(error));
});
