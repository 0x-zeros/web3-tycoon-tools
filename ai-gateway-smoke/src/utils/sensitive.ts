export interface ScanResult {
  found: boolean;
  matches: string[];
}

export interface ScanOptions {
  extraPatterns?: RegExp[];
  knownStrings?: string[];
}

const JWT_PATTERN = /eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._\-=]{20,}/g;

export function scanSensitive(value: unknown, options: ScanOptions = {}): ScanResult {
  const matches: string[] = [];
  const knownStrings = (options.knownStrings ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const extraPatterns = options.extraPatterns ?? [];

  visit(value, (text) => {
    pushAll(matches, text.match(JWT_PATTERN));
    pushAll(matches, text.match(BEARER_PATTERN));
    for (const pattern of extraPatterns) {
      const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
      const re = new RegExp(pattern.source, flags);
      pushAll(matches, text.match(re));
    }
    for (const known of knownStrings) {
      if (text.includes(known)) {
        matches.push(known);
      }
    }
  });

  return { found: matches.length > 0, matches };
}

function visit(value: unknown, visitor: (text: string) => void): void {
  if (typeof value === "string") {
    visitor(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      visit(item, visitor);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      visit(item, visitor);
    }
  }
}

function pushAll(target: string[], items: RegExpMatchArray | null): void {
  if (!items) return;
  for (const item of items) {
    target.push(item);
  }
}
