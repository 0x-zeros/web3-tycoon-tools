export function ok(label: string, detail?: string): void {
  const line = detail ? `✓ ${label} — ${detail}` : `✓ ${label}`;
  process.stdout.write(`${line}\n`);
}

export function fail(label: string, detail?: string): never {
  const line = detail ? `✗ ${label} — ${detail}` : `✗ ${label}`;
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

export function info(label: string): void {
  process.stdout.write(`· ${label}\n`);
}

export function section(title: string): void {
  process.stdout.write(`\n=== ${title} ===\n`);
}

export function truncate(text: string, max = 200): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…(共 ${text.length} 字符)`;
}
