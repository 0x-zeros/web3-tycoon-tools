import http from "node:http";
import type { AuthContext } from "../auth/credential-manager.js";
import type { GatewayConfig } from "../config/types.js";
import type { RequestLogger } from "../logging/request-log.js";
import type { CodexProvider } from "../providers/codex.js";
import { sendError, sendJson } from "./errors.js";
import { isAuthorized } from "./request-auth.js";
import { handleResponses } from "./responses.js";
import { handleStatus, handleStatusPage } from "./status.js";

export type CreateGatewayServerParams = {
  config: GatewayConfig;
  apiToken: string | undefined;
  credentialManager: { getAuthContext: () => Promise<AuthContext> };
  provider: Pick<CodexProvider, "createResponse" | "status">;
  credentialStatus: () => Promise<unknown>;
  requestLogger: Pick<RequestLogger, "logRequest">;
};

export function createGatewayServer(params: CreateGatewayServerParams): http.Server {
  return http.createServer(async (req, res) => {
    if (!isAuthorized(req, params.apiToken)) {
      sendError(res, 401, "unauthorized", "未授权");
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/status") {
      await handleStatus({
        res,
        config: params.config,
        credentialStatus: params.credentialStatus,
        providerStatus: () => params.provider.status(),
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/") {
      handleStatusPage(res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/responses") {
      await handleResponses({
        req,
        res,
        config: params.config,
        credentialManager: params.credentialManager,
        provider: params.provider,
        requestLogger: params.requestLogger,
      });
      return;
    }
    sendError(res, 404, "not_found", "接口不存在");
  });
}
