import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import { redactValue } from "./redact.js";

export type RequestLogEvent = {
  requestId: string;
  modelAlias: string;
  upstreamModel: string;
  statusCode: number;
  durationMs: number;
  errorCode: string | null;
  requestBody: unknown;
  responseBody: unknown;
};

export type RequestLoggerParams = {
  logsDir: string;
  debugCapture: boolean;
};

export class RequestLogger {
  constructor(private readonly params: RequestLoggerParams) {}

  async logRequest(event: RequestLogEvent): Promise<void> {
    await mkdir(this.params.logsDir, { recursive: true, mode: 0o700 });
    const summary = {
      at: new Date().toISOString(),
      requestId: event.requestId,
      modelAlias: event.modelAlias,
      upstreamModel: event.upstreamModel,
      statusCode: event.statusCode,
      durationMs: event.durationMs,
      errorCode: event.errorCode,
    };
    await appendFile(path.join(this.params.logsDir, "requests.jsonl"), `${JSON.stringify(summary)}\n`, {
      mode: 0o600,
    });
    if (this.params.debugCapture) {
      await appendFile(
        path.join(this.params.logsDir, "debug-capture.jsonl"),
        `${JSON.stringify({
          ...summary,
          requestBody: redactValue(event.requestBody),
          responseBody: redactValue(event.responseBody),
        })}\n`,
        { mode: 0o600 },
      );
    }
  }
}
