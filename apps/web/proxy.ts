// apps/web/proxy.ts
import { auth } from "@/lib/auth";
import { isPublicPath } from "@/lib/public-paths";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Session } from "next-auth";

export default auth(function proxy(req: NextRequest & { auth: Session | null }) {
  if (isPublicPath(req.nextUrl.pathname)) return NextResponse.next();
  if (!req.auth) {
    const isPortalRoute = req.nextUrl.pathname.startsWith("/portal");
    const redirectUrl = isPortalRoute ? "/customer-login" : "/welcome";
    return NextResponse.redirect(new URL(redirectUrl, req.url));
  }
  // Forward the current pathname as a request header so server components
  // (e.g. shell layout) can read it for active-nav highlighting.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
