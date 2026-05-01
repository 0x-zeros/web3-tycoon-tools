export class SseChunkSplitter {
  private buffer = "";

  push(chunk: string | Buffer): string[] {
    if (chunk.length === 0) return [];
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

    const events: string[] = [];
    while (true) {
      const idx = findBoundary(this.buffer);
      if (idx === null) break;
      events.push(this.buffer.slice(0, idx.start));
      this.buffer = this.buffer.slice(idx.end);
    }
    return events;
  }

  flush(): string | null {
    if (this.buffer.length === 0) return null;
    const remainder = this.buffer;
    this.buffer = "";
    return remainder;
  }
}

interface Boundary {
  start: number;
  end: number;
}

function findBoundary(buffer: string): Boundary | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");

  if (lf === -1 && crlf === -1) return null;
  if (lf === -1) return { start: crlf, end: crlf + 4 };
  if (crlf === -1) return { start: lf, end: lf + 2 };
  return crlf < lf
    ? { start: crlf, end: crlf + 4 }
    : { start: lf, end: lf + 2 };
}
