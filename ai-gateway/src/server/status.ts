import http from "node:http";
import type { GatewayConfig } from "../config/types.js";
import { sendJson } from "./errors.js";

export async function handleStatus(params: {
  res: http.ServerResponse;
  config: GatewayConfig;
  credentialStatus: () => Promise<unknown>;
  providerStatus: () => unknown;
}): Promise<void> {
  sendJson(params.res, 200, {
    auth: await params.credentialStatus(),
    models: Object.keys(params.config.models),
    defaultModelAlias: params.config.defaultModelAlias,
    provider: params.providerStatus(),
  });
}

export function handleStatusPage(res: http.ServerResponse): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    "<!doctype html><html><head><title>AI Gateway</title></head>" +
      "<body><h1>AI Gateway</h1>" +
      "<p>状态接口：<code>/status</code></p>" +
      "<p>登录请使用 CLI：<code>ai-gateway auth login</code></p>" +
      "</body></html>",
  );
}
