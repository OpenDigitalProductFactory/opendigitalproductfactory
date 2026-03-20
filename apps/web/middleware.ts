import { NextResponse } from "next/server";
import type { NextFetchEvent } from "next/server";
import { auth } from "@/lib/auth";
import { classifyRoute, RouteClass } from "@/lib/storefront-middleware";
import { prisma } from "@dpf/db";
import type { NextAuthRequest } from "next-auth";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

async function getOrgSlug(): Promise<string> {
  try {
    const org = await prisma.organization.findFirst({ select: { slug: true } });
    return org?.slug ?? "store";
  } catch {
    return "store";
  }
}

export default auth(async function middleware(
  req: NextAuthRequest,
  _event: NextFetchEvent,
) {
  const { pathname } = req.nextUrl;
  const routeClass = classifyRoute(pathname);

  // Legacy customer auth routes → canonical storefront paths
  if (routeClass === RouteClass.LegacyCustomerAuth) {
    const slug = await getOrgSlug();
    const target = pathname.includes("signup")
      ? `/s/${slug}/sign-up`
      : `/s/${slug}/sign-in`;
    return NextResponse.redirect(new URL(target, req.url), 301);
  }

  // Portal requires customer session
  if (routeClass === RouteClass.Portal) {
    if (!req.auth?.user) {
      const slug = await getOrgSlug();
      return NextResponse.redirect(new URL(`/s/${slug}/sign-in`, req.url));
    }
  }

  // Public API — allow through
  if (routeClass === RouteClass.PublicApi) {
    return NextResponse.next();
  }

  // Storefront — always public
  if (routeClass === RouteClass.Storefront) {
    return NextResponse.next();
  }

  return NextResponse.next();
});
