import { Readable } from "node:stream";
import http from "node:http";
import { resolveModelAlias } from "../config/config-store.js";
import type { GatewayConfig } from "../config/types.js";
import type { RequestLogger } from "../logging/request-log.js";
import { ProviderCooldownError, type CodexProvider } from "../providers/codex.js";
import { AuthUnavailableError, type AuthContext } from "../auth/credential-manager.js";
import { normalizeCodexRequestBody } from "./codex-normalize.js";
import type { ResponsesRequestBody } from "./types.js";
import { sendError } from "./errors.js";

const REQUEST_BODY_MAX_BYTES = 1 * 1024 * 1024;

class RequestBodyTooLargeError extends Error {
  readonly code = "request_too_large";
  constructor() {
    super("request_body_too_large");
    this.name = "RequestBodyTooLargeError";
  }
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > REQUEST_BODY_MAX_BYTES) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

/**
 * 消费上游 SSE 流，提取 response.completed 事件里的 response 字段，
 * 必要时用 response.output_item.done 事件回填 response.output[] 数组。
 *
 * 来源：CLIProxyAPI codex_executor.go:230-298 (Execute 非流式聚合路径)
 */
export async function aggregateCodexCompletedResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  const outputItemsByIndex = new Map<number, unknown>();
  const outputItemsFallback: unknown[] = [];
  let completedResponse: Record<string, unknown> | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const dataPart = line.slice(5).trim();
    if (!dataPart || dataPart === "[DONE]") continue;
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(dataPart);
      if (typeof parsed !== "object" || parsed === null) continue;
      event = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = event.type;
    if (type === "response.output_item.done") {
      const item = event.item;
      if (!item) continue;
      const idx = event.output_index;
      if (typeof idx === "number" && Number.isFinite(idx)) {
        outputItemsByIndex.set(idx, item);
      } else {
        outputItemsFallback.push(item);
      }
    } else if (type === "response.completed") {
      const resp = event.response;
      if (typeof resp === "object" && resp !== null) {
        completedResponse = resp as Record<string, unknown>;
      }
    }
  }

  if (!completedResponse) {
    throw new Error(
      "upstream_no_completion: 上游 SSE 流结束前未出现 response.completed 事件",
    );
  }

  // 回填 output[]：CLIProxyAPI codex_executor.go:273-292 同款逻辑。
  const existingOutput = completedResponse.output;
  const needsPatch =
    !Array.isArray(existingOutput) ||
    existingOutput.length === 0 ||
    !existingOutput.every((v) => v !== undefined && v !== null);
  if (needsPatch && (outputItemsByIndex.size > 0 || outputItemsFallback.length > 0)) {
    const sortedIndexes = [...outputItemsByIndex.keys()].sort((a, b) => a - b);
    const patched: unknown[] = sortedIndexes.map((k) => outputItemsByIndex.get(k));
    patched.push(...outputItemsFallback);
    completedResponse = { ...completedResponse, output: patched };
  }

  return completedResponse;
}

export async function handleResponses(params: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  config: GatewayConfig;
  credentialManager: { getAuthContext: () => Promise<AuthContext> };
  provider: Pick<CodexProvider, "createResponse">;
  requestLogger: Pick<RequestLogger, "logRequest">;
}): Promise<void> {
  const started = Date.now();
  let body: ResponsesRequestBody = {};
  let clientWantsStream = false;
  try {
    const rawBody = await readJson(params.req);
    // 客户端是否要流式 SSE 看原始 body.stream，因为 normalize 会强制覆盖为 true
    clientWantsStream = rawBody.stream === true;
    body = normalizeCodexRequestBody(rawBody);
    const model = resolveModelAlias(params.config, body.model);
    const auth = await params.credentialManager.getAuthContext();
    const upstream = await params.provider.createResponse({
      accessToken: auth.accessToken,
      accountId: auth.accountId,
      upstreamModel: model.upstreamModel,
      body,
      stream: true,
    });
    if (!upstream.ok) {
      params.res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
      const text = await upstream.text();
      params.res.end(text);
    } else if (clientWantsStream) {
      // SSE 透传：保留上游 status/headers，body 直接 pipe
      params.res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
      if (upstream.body) {
        Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(params.res);
      } else {
        params.res.end();
      }
    } else {
      // 聚合：消费 SSE，提取 response.completed.response，必要时回填 output[]
      const aggregated = await aggregateCodexCompletedResponse(upstream);
      params.res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      params.res.end(JSON.stringify(aggregated));
    }
    await params.requestLogger.logRequest({
      requestId: crypto.randomUUID(),
      modelAlias: body.model ?? params.config.defaultModelAlias,
      upstreamModel: model.upstreamModel,
      statusCode: upstream.status,
      durationMs: Date.now() - started,
      errorCode: upstream.ok ? null : `upstream_${upstream.status}`,
      requestBody: body,
      responseBody: null,
    });
  } catch (error) {
    if (error instanceof ProviderCooldownError) {
      sendError(params.res, 429, "upstream_cooldown", "上游处于冷却窗口");
    } else if (error instanceof AuthUnavailableError) {
      sendError(params.res, 503, "auth_unavailable", error.message);
    } else if (error instanceof RequestBodyTooLargeError) {
      sendError(params.res, 413, "request_too_large", "请求体超过 1MB");
    } else if (error instanceof SyntaxError) {
      sendError(params.res, 400, "invalid_json", "请求体不是合法 JSON");
    } else if (error instanceof Error && error.message.startsWith("unknown_model_alias")) {
      sendError(params.res, 400, "unknown_model_alias", error.message);
    } else {
      sendError(params.res, 502, "upstream_error", error instanceof Error ? error.message : String(error));
    }
  }
}
