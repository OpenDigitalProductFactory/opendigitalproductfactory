// apps/web/middleware.ts
// Injects x-pathname into request headers so Server Components can read the
// current path without needing a client-side hook.
import { type NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("x-pathname", request.nextUrl.pathname);
  return response;
}

export const config = {
  // Run on all routes except static assets and Next.js internals
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
