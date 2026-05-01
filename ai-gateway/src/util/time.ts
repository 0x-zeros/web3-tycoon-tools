export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

export function isUsableUntil(expiresAt: string, now: Date, refreshMarginMs: number): boolean {
  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) && expires - now.getTime() > refreshMarginMs;
}
