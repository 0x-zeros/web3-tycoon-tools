// JWT 解码：从 Codex access_token / id_token 的 payload 中提取 expiry / email / accountId。
// JWT claim 结构参考 CLIProxyAPI internal/auth/codex/jwt_parser.go @ 8b286e8f：
//   - 顶层 exp（数字，秒）
//   - 顶层 email（字符串）
//   - 顶层 sub（OAuth user ID，**不是** chatgpt account id）
//   - 嵌套对象 "https://api.openai.com/auth": { chatgpt_account_id, chatgpt_user_id, ... }
// 不要把 sub 当 accountId 用，那是错的标识。

const OPENAI_AUTH_CLAIM_KEY = "https://api.openai.com/auth";

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function resolveJwtExpiryIso(token: string): string | null {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0) {
    return null;
  }
  return new Date(exp * 1000).toISOString();
}

export function resolveJwtEmail(token: string): string | null {
  const payload = decodeJwtPayload(token);
  const email = payload?.email;
  return typeof email === "string" && email.includes("@") ? email : null;
}

export function resolveJwtAccountId(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return null;
  }
  const codexAuth = payload[OPENAI_AUTH_CLAIM_KEY];
  if (typeof codexAuth !== "object" || codexAuth === null || Array.isArray(codexAuth)) {
    return null;
  }
  const accountId = (codexAuth as Record<string, unknown>).chatgpt_account_id;
  if (typeof accountId !== "string") {
    return null;
  }
  const trimmed = accountId.trim();
  return trimmed ? trimmed : null;
}
