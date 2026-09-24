/**
 * The cookies that together make up a signed-in staff session.
 *
 * These names live on their own, with no imports and no side effects, because
 * both `proxy.ts` and the server-only two-factor module need them. The proxy
 * runs before any page does and must be able to expire a dead session without
 * pulling in `node:crypto` and `next/headers` to learn a cookie's name.
 */

/** Supabase writes sb-<project-ref>-auth-token, chunked as .0, .1 when large. */
export const SUPABASE_COOKIE_PREFIX = "sb-";

/** Set once the second sign-in step has been passed. See lib/two-factor.ts. */
export const TWO_FACTOR_COOKIE = "pms_2fa";

/** The 2FA cookie is scoped to the admin panel, so it must be cleared with
 *  the same path it was set with or the browser keeps it. */
export const TWO_FACTOR_COOKIE_PATH = "/admin";
