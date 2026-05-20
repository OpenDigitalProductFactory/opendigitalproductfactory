// Next.js Edge Middleware — canonical-URL enforcement.
//
// Why: the portal can be reached via multiple origins (localhost, LAN IP,
// public hostname). Browsers scope localStorage / sessionStorage /
// IndexedDB / cookies per (scheme, host, port), so user-visible chat UI
// state diverges across origins even though the DB (source of truth) is
// shared. This middleware 301-redirects non-canonical origins to the
// operator's PUBLIC_URL and emits `Clear-Site-Data: "storage"` on that
// redirect to flush stale per-origin caches deterministically.
//
// Pattern follows Discourse (DISCOURSE_HOSTNAME 301), Mattermost
// (SiteURL), Gitea (ROOT_URL + PUBLIC_URL_DETECTION=auto for the
// bootstrap-before-DNS case), and Home Assistant (internal_url alias
// bypass). See docs/superpowers/plans/2026-05-19-portal-canonical-url-middleware.md.
//
// When PUBLIC_URL is unset, every host passes through unchanged — required
// for local dev and pre-deployment configuration. The `config.matcher`
// below excludes Next internals and health-probe paths so load balancers
// hitting /api/health on the LAN IP are not bounced (which would fail the
// probe and take the deploy down).

import { type NextRequest, NextResponse } from "next/server";
import { decideHostMatch } from "@/lib/canonical-host";

export function middleware(req: NextRequest): NextResponse {
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? null;

  const decision = decideHostMatch({
    host,
    path: req.nextUrl.pathname,
    search: req.nextUrl.search,
    config: {
      canonicalUrl: process.env.PUBLIC_URL,
      aliases: process.env.PUBLIC_URL_ALIASES ?? "",
    },
  });

  if (decision.kind === "passthrough") {
    return NextResponse.next();
  }

  // Construct redirect then mutate headers: setting Clear-Site-Data via init
  // options can be stripped during Next's redirect normalization. The value
  // MUST be the quoted string `"storage"` per W3C Clear-Site-Data — directives
  // are quoted-string values, not bare tokens.
  const response = NextResponse.redirect(decision.targetUrl, 301);
  response.headers.set("Clear-Site-Data", '"storage"');
  return response;
}

export const config = {
  matcher: [
    // Run on every request EXCEPT Next internals, common static assets, and
    // health probes. Health-probe exclusion is critical: load balancers hit
    // /api/health on the LAN IP; redirecting them would fail the probe.
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/healthz|api/ready).*)",
  ],
};
