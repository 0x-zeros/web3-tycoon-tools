/**
 * auth login 进入时的模式选择交互。
 *
 * 抽离的目的：让选择逻辑跟实际 IO（readline / stdin）解耦，便于单测覆盖
 * 文案 + 默认值 + 重试。CLI 入口（cli/index.ts）负责把真实的 stdin reader 注入。
 */

export type LoginMode = "loopback" | "device";

export type PromptLoginModeDeps = {
  /** 读一行用户输入（不含末尾换行）。CLI 端用 readline 接进来。 */
  read: () => Promise<string>;
  /** 打一行到面向用户的输出。 */
  print: (line: string) => void;
};

export async function promptLoginMode(deps: PromptLoginModeDeps): Promise<LoginMode> {
  deps.print("请选择登录方式：");
  deps.print("");
  deps.print("  1) 浏览器自动回调（loopback）");
  deps.print("     - 优点：浏览器登录完成后凭据自动写入，无需手动复制 URL/code");
  deps.print("     - 适用：本机有图形浏览器、且能访问 http://localhost:1455");
  deps.print("            （devcontainer 已开 forwardPorts 也可）");
  deps.print("");
  deps.print("  2) Device code（设备码）");
  deps.print("     - 优点：不需要本机 callback server，浏览器和 CLI 可以在不同设备");
  deps.print("            / 不同网络（手机扫码也行），过 NAT / 防火墙不影响");
  deps.print("     - 适用：headless server / SSH 远程 / devcontainer 端口转发不通");
  deps.print("            等场景");
  deps.print("");

  while (true) {
    deps.print("输入 1 或 2 [默认 1]：");
    const answer = (await deps.read()).trim();
    if (answer === "" || answer === "1") {
      return "loopback";
    }
    if (answer === "2") {
      return "device";
    }
    deps.print(`无效输入：${answer}`);
  }
}
