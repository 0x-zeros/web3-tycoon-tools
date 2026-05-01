import http from "node:http";

export function isAuthorized(req: http.IncomingMessage, apiToken: string | undefined): boolean {
  if (!apiToken) {
    return true;
  }
  return req.headers.authorization === `Bearer ${apiToken}`;
}
