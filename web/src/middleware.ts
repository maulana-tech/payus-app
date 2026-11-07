import { type NextRequest, NextResponse } from "next/server";
import {
  DASHBOARD_PATH,
  isAuthOnlyPublicRoute,
  isProtectedRoute,
  PRIVY_ACCESS_TOKEN_COOKIE,
  PRIVY_SESSION_COOKIE,
  REFRESH_PATH,
  SIGN_IN_PATH,
} from "./lib/auth-routes";
import { demoMode } from "./lib/demo";

const OAUTH_QUERY_KEYS = [
  "privy_oauth_code",
  "privy_oauth_state",
  "privy_oauth_provider",
] as const;

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  // Demo mode has no cookies to check; `demoMode()` is false outside
  // development, so this cannot open a deployed dashboard.
  if (demoMode()) return NextResponse.next();
  if (
    pathname === REFRESH_PATH ||
    OAUTH_QUERY_KEYS.some((key) => searchParams.has(key))
  ) {
    return NextResponse.next();
  }

  const hasAccessToken = Boolean(
    request.cookies.get(PRIVY_ACCESS_TOKEN_COOKIE)?.value,
  );
  const hasSession = Boolean(request.cookies.get(PRIVY_SESSION_COOKIE)?.value);

  if (isProtectedRoute(pathname) && !hasAccessToken) {
    if (hasSession) {
      const target = `${pathname}${request.nextUrl.search}`;
      const refresh = new URL(REFRESH_PATH, request.url);
      refresh.searchParams.set("redirect_uri", target);
      return NextResponse.redirect(refresh);
    }
    return NextResponse.redirect(new URL(SIGN_IN_PATH, request.url));
  }

  if (isAuthOnlyPublicRoute(pathname) && (hasAccessToken || hasSession)) {
    if (!hasAccessToken && hasSession) {
      const refresh = new URL(REFRESH_PATH, request.url);
      refresh.searchParams.set("redirect_uri", DASHBOARD_PATH);
      return NextResponse.redirect(refresh);
    }
    return NextResponse.redirect(new URL(DASHBOARD_PATH, request.url));
  }

  return NextResponse.next();
}

// Next requires a literal here, so it cannot be derived from
// DASHBOARD_PATHS — `test/middleware.test.ts` checks the two agree.
export const config = {
  matcher: [
    "/",
    "/refresh",
    "/dashboard/:path*",
    "/links/:path*",
    "/invoices/:path*",
    "/transactions/:path*",
    "/storefront/:path*",
    "/requests/:path*",
    "/agents/:path*",
    "/developers/:path*",
    "/settings/:path*",
  ],
};
