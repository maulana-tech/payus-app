import "server-only";
import { getServerEnv } from "../../../env.server";
import { rateLimit } from "../../lib/rateLimit";
import { authenticateApiKey } from "./developer.service";

// Shared plumbing for the merchant REST API (/api/v1/*).

export const apiError = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

export function publicOrigin(request: Request): string {
  return (getServerEnv().APP_URL || new URL(request.url).origin).replace(
    /\/$/,
    "",
  );
}

/** The calling merchant, or an error Response to return as is. */
export async function authorize(
  request: Request,
): Promise<{ owner: string } | Response> {
  const auth = await authenticateApiKey(request.headers.get("authorization"));
  if (!auth)
    return apiError(
      401,
      "unauthorized",
      "Send `Authorization: Bearer payus_sk_…`.",
    );
  if (!rateLimit(`api:${auth.keyId}`, 120, 60_000).ok)
    return apiError(429, "rate_limited", "Too many requests; slow down.");
  return { owner: auth.owner };
}
