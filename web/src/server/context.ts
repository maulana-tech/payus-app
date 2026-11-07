import type { VerifyAccessTokenResponse } from "@privy-io/node";
import { demoMode, demoPrivyUserId, publicDemo } from "../lib/demo";
import { DEMO_COOKIE, demoNameFrom } from "./lib/demoCookie";
import { verifyPrivyAccessToken } from "./lib/privy";
import { ensureDemoAccount } from "./modules/demo/demo.service";

export type Context = {
  ip: string | null;
  authToken: string | null;
  privyUserId: string | null;
  privyClaim: VerifyAccessTokenResponse | null;
  authError: unknown | null;
  /**
   * True only for a development demo session, which has a user id but no
   * Privy claim to go with it. `protectedProcedure` names this explicitly
   * rather than loosening what it requires of a real session.
   */
  demo: boolean;
};

function cookie(req: Request, name: string): string | null {
  const value = req.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)
    ?.slice(1)
    .join("=");
  return value ? decodeURIComponent(value) : null;
}

function accessToken(req: Request): string | null {
  const authorization = req.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim() || null;
  }
  return cookie(req, "privy-token");
}

export async function createTRPCContext(opts?: {
  req: Request;
}): Promise<Context> {
  if (!opts) {
    return {
      ip: null,
      authToken: null,
      privyUserId: null,
      privyClaim: null,
      authError: null,
      demo: false,
    };
  }

  // Development only, and only when a demo username is set.
  if (demoMode()) {
    const privyUserId = await ensureDemoAccount();
    return {
      ip: clientIp(opts.req),
      authToken: null,
      privyUserId,
      privyClaim: null,
      authError: null,
      demo: true,
    };
  }

  // The public demo, which runs in production: a signed cookie naming one
  // sandbox. It is checked after the real token path below would have been
  // taken, so a signed-in person is never mistaken for a demo visitor — and
  // what a demo account may do is fenced by `isDemoOwner`, not by this.
  if (publicDemo()) {
    // A real token wins. Someone signed in who still carries a demo cookie
    // from before — the owner of the deployment, most likely — must reach
    // their own account and not a sandbox.
    const name = demoNameFrom(cookie(opts.req, DEMO_COOKIE) ?? undefined);
    if (name && !accessToken(opts.req)) {
      return {
        ip: clientIp(opts.req),
        authToken: null,
        privyUserId: demoPrivyUserId(name),
        privyClaim: null,
        authError: null,
        demo: true,
      };
    }
  }

  const token = accessToken(opts.req);
  if (!token) {
    return {
      ip: clientIp(opts.req),
      authToken: null,
      privyUserId: null,
      privyClaim: null,
      authError: null,
      demo: false,
    };
  }

  try {
    const claim = await verifyPrivyAccessToken(token);
    return {
      ip: clientIp(opts.req),
      authToken: token,
      privyUserId: claim.user_id,
      privyClaim: claim,
      authError: null,
      demo: false,
    };
  } catch (authError) {
    return {
      ip: clientIp(opts.req),
      authToken: token,
      privyUserId: null,
      privyClaim: null,
      authError,
      demo: false,
    };
  }
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip");
}
