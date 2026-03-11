// apps/web/proxy.ts
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Session } from "next-auth";

const PUBLIC_PATHS = ["/login", "/api/auth"];

export default auth(function proxy(req: NextRequest & { auth: Session | null }) {
  const isPublic = PUBLIC_PATHS.some((p) => req.nextUrl.pathname.startsWith(p));
  if (isPublic) return NextResponse.next();
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", req.url));
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
