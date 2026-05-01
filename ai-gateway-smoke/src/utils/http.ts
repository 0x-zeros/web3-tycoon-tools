import type { SmokeConfig } from "./env.js";

export interface HttpResult {
  status: number;
  headers: Headers;
  text: string;
  json<T = unknown>(): T;
}

export async function callJson(
  cfg: SmokeConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<HttpResult> {
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  if (cfg.apiToken) {
    headers.authorization = `Bearer ${cfg.apiToken}`;
  }
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    text,
    json<T>(): T {
      return JSON.parse(text) as T;
    },
  };
}

export async function openStream(
  cfg: SmokeConfig,
  path: string,
  body: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {
    accept: "text/event-stream",
    "content-type": "application/json",
  };
  if (cfg.apiToken) {
    headers.authorization = `Bearer ${cfg.apiToken}`;
  }
  return fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export async function callRaw(
  cfg: SmokeConfig,
  method: "GET" | "POST",
  path: string,
  init?: { body?: string; contentType?: string; skipAuth?: boolean },
): Promise<HttpResult> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (cfg.apiToken && !init?.skipAuth) {
    headers.authorization = `Bearer ${cfg.apiToken}`;
  }
  if (init?.contentType) {
    headers["content-type"] = init.contentType;
  }
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers,
    body: init?.body,
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    text,
    json<T>(): T {
      return JSON.parse(text) as T;
    },
  };
}
