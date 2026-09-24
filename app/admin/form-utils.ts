/**
 * Helpers for reading FormData in server actions. Everything from a form is
 * untrusted: these trim, coerce and bound values, and never throw.
 */

export type ActionState = {
  error?: string;
  success?: string;
  /** Set when the database refused a booking for lack of rooms. */
  overbooked?: boolean;
};

export const str = (fd: FormData, key: string, max = 2000) =>
  String(fd.get(key) ?? "").trim().slice(0, max);

export const num = (fd: FormData, key: string) => {
  const raw = str(fd, key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

export const int = (fd: FormData, key: string, fallback: number, min = 0, max = 1000) => {
  const n = num(fd, key);
  if (n === null || !Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

export const bool = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
};

/** A value that must be one of a fixed list, else the fallback. */
export function oneOf<T extends string>(fd: FormData, key: string, allowed: readonly T[], fallback: T): T {
  const v = str(fd, key) as T;
  return allowed.includes(v) ? v : fallback;
}

export function oneOfOrNull<T extends string>(fd: FormData, key: string, allowed: readonly T[]): T | null {
  const v = str(fd, key) as T;
  return allowed.includes(v) ? v : null;
}

/** A yyyy-mm-dd date, or "". */
export const dateStr = (fd: FormData, key: string) => {
  const v = str(fd, key, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
};

export const uuidOrNull = (fd: FormData, key: string) => {
  const v = str(fd, key, 36);
  return /^[0-9a-f-]{36}$/i.test(v) ? v : null;
};

/** One entry per line, trimmed and de-duplicated. */
export const lines = (fd: FormData, key: string, maxItems = 20) =>
  [...new Set(str(fd, key, 5000).split("\n").map((l) => l.trim()).filter(Boolean))].slice(0, maxItems);
