import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { TWO_FACTOR_COOKIE, TWO_FACTOR_COOKIE_PATH } from "./session-cookies";

/**
 * Second sign-in step.
 *
 *   TWO_FACTOR_MODE=demo (the default)  Every code is DEMO_2FA_CODE, "123456"
 *                                       unless set. No authenticator app.
 *   TWO_FACTOR_MODE=totp                Real Supabase TOTP authenticators.
 *
 * DEMO MODE IS NOT SECURITY. Anyone who knows the code passes. It exists so
 * the flow can be shown before staff have authenticator apps; switch to totp
 * before real guest data is in the system.
 *
 * In demo mode, passing the step sets an httpOnly cookie signed with a server
 * secret, bound to the user and valid for 12 hours or until sign-out.
 */

export { TWO_FACTOR_COOKIE };
const VALID_MS = 12 * 60 * 60 * 1000;

export function isDemoTwoFactor() {
  return (process.env.TWO_FACTOR_MODE ?? "demo") !== "totp";
}

export function demoCode() {
  return process.env.DEMO_2FA_CODE || "123456";
}

function secret() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "pms-demo-2fa";
}

function sign(userId: string, expires: number) {
  return createHmac("sha256", secret()).update(`${userId}.${expires}`).digest("hex");
}

export function checkDemoCode(code: string) {
  const a = Buffer.from(code);
  const b = Buffer.from(demoCode());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Marks this browser as having passed the second step. Server actions only. */
export async function setDemoVerified(userId: string) {
  const expires = Date.now() + VALID_MS;
  (await cookies()).set(TWO_FACTOR_COOKIE, `${userId}.${expires}.${sign(userId, expires)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: TWO_FACTOR_COOKIE_PATH,
    maxAge: VALID_MS / 1000,
  });
}

export async function clearDemoVerified() {
  (await cookies()).delete({ name: TWO_FACTOR_COOKIE, path: TWO_FACTOR_COOKIE_PATH });
}

export async function isDemoVerified(userId: string) {
  const value = (await cookies()).get(TWO_FACTOR_COOKIE)?.value;
  if (!value) return false;
  const [id, expiresRaw, mac] = value.split(".");
  const expires = Number(expiresRaw);
  if (id !== userId || !Number.isFinite(expires) || expires < Date.now() || !mac) return false;
  const expected = Buffer.from(sign(id, expires));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
