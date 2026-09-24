import "server-only";
import { timingSafeEqual } from "node:crypto";

/** True when the request carries "Authorization: Bearer <secret>". */
export function hasBearer(request: Request, secret: string): boolean {
  const given = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
