import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getServerEnv } from "../../env.server";

/** True when the request carries `Authorization: Bearer $CRON_SECRET`. */
export function cronAuthorized(request: Request): boolean {
  const secret = getServerEnv().CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
