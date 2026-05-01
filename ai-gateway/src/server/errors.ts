import http from "node:http";

export function sendJson(res: http.ServerResponse, statusCode: number, value: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

export function sendError(res: http.ServerResponse, statusCode: number, code: string, message: string): void {
  sendJson(res, statusCode, { error: { code, message } });
}
