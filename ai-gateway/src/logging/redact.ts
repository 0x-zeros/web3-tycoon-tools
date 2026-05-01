const SECRET_KEY_PATTERN = /authorization|access[_-]?token|refresh[_-]?token|id[_-]?token/i;

export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(item);
    }
    return result;
  }
  if (typeof value === "string" && value.startsWith("Bearer ")) {
    return "Bearer [REDACTED]";
  }
  return value;
}
