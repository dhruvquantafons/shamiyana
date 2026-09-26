/**
 * Page maths for the admin lists, kept free of React so it can be tested on
 * its own. The <Pagination> bar that uses it lives in ui.tsx, which also
 * re-exports these helpers for the pages.
 */

/** Rows per page on every paginated admin list. */
export const PAGE_SIZE = 25;

/** The 1-based page number from a `?page=` param; anything invalid is page 1. */
export function pageParam(value?: string) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** The inclusive row offsets for Supabase's `.range(from, to)`. */
export function pageRange(page: number, size = PAGE_SIZE): [number, number] {
  return [(page - 1) * size, page * size - 1];
}

/**
 * True when PostgREST refused a `.range()` that starts past the last row
 * (a stale `?page=` after rows were removed). Pages redirect to page 1.
 */
export function outOfRange(error: { code?: string } | null | undefined) {
  return error?.code === "PGRST103";
}

export type PageParams = Record<string, string | null | undefined>;

/** Clamps a requested page to the last page of `total` rows (never below 1). */
export function clampPage(page: number, total: number, size = PAGE_SIZE) {
  return Math.min(page, Math.max(1, Math.ceil(total / size)));
}

/** A list URL with its filters kept and `page` set (omitted for page 1). */
export function pageHref(path: string, params: PageParams, page: number) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && k !== "page") q.set(k, v);
  if (page > 1) q.set("page", String(page));
  return q.size ? `${path}?${q}` : path;
}

/** 1 … 4 5 6 … 20: first, last, and the current page's neighbours. */
export function pageList(page: number, last: number): (number | "gap")[] {
  const keep = new Set([1, last, page - 1, page, page + 1].filter((n) => n >= 1 && n <= last));
  const out: (number | "gap")[] = [];
  let prev = 0;
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (n - prev === 2) out.push(n - 1);
    else if (n - prev > 2) out.push("gap");
    out.push(n);
    prev = n;
  }
  return out;
}
