// Self-test for scripts/check-endpoint-classification.mjs (W17, BI-810BEC9C).
// Pure-core tests — no filesystem, no manifest regeneration.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  checkEndpointClassification,
  extractPublicApiPrefixes,
  parseBaseline,
  EXPOSURE_CLASSES,
  GOVERNED_COHORT_PREFIXES,
} from "./check-endpoint-classification.mjs";

const PROXY_FIXTURE = `
export function classifyRoute(pathname: string): RouteClass {
  if (pathname.startsWith("/.well-known/")) return RouteClass.PublicApi;
  if (pathname.startsWith("/s/")) return RouteClass.Storefront;
  if (pathname.startsWith("/api/storefront/")) return RouteClass.PublicApi;
  if (pathname.startsWith("/api/auth/")) return RouteClass.PublicApi;
  if (pathname.startsWith("/api/health")) return RouteClass.PublicApi;
  if (pathname.startsWith("/api/")) return RouteClass.ProtectedApi;
  return RouteClass.Other;
}
`;

function route(file, routePath, exposure) {
  return { routePath, kind: "route", segments: [], dynamicParams: [], file, ...(exposure ? { exposure } : {}) };
}

const PUBLIC_PREFIXES = extractPublicApiPrefixes(PROXY_FIXTURE);

describe("extractPublicApiPrefixes", () => {
  it("extracts exactly the prefixes tested on RouteClass.PublicApi lines", () => {
    assert.deepEqual(PUBLIC_PREFIXES, ["/.well-known/", "/api/storefront/", "/api/auth/", "/api/health"]);
  });

  it("returns [] when the classifier shape is unrecognizable (guard then fails loudly)", () => {
    assert.deepEqual(extractPublicApiPrefixes("export const x = 1;"), []);
    const { failures } = checkEndpointClassification({ manifestRoutes: [], baselineFiles: [], publicPrefixes: [] });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /could not extract any RouteClass\.PublicApi/);
  });
});

describe("parseBaseline", () => {
  it("skips the budget header and blank lines", () => {
    const text = "# owner: platform-architecture\n# expiry: 2026-11-16\n\napps/web/app/api/x/route.ts\n";
    assert.deepEqual(parseBaseline(text), ["apps/web/app/api/x/route.ts"]);
  });
});

describe("checkEndpointClassification", () => {
  it("passes classified routes and budget-grandfathered routes; page rows and non-api handlers are out of scope", () => {
    const result = checkEndpointClassification({
      manifestRoutes: [
        route("apps/web/app/api/a2a/tasks/[taskId]/route.ts", "/api/a2a/tasks/[taskId]", "authenticated"),
        route("apps/web/app/api/legacy/route.ts", "/api/legacy"),
        { routePath: "/admin", kind: "page", segments: ["admin"], dynamicParams: [], file: "apps/web/app/admin/page.tsx" },
        route("apps/web/app/r/[token]/route.ts", "/r/[token]"), // handler outside app/api — ungoverned
      ],
      baselineFiles: ["apps/web/app/api/legacy/route.ts"],
      publicPrefixes: PUBLIC_PREFIXES,
    });
    assert.deepEqual(result.failures, []);
    assert.equal(result.governed, 2);
    assert.equal(result.classified, 1);
    assert.equal(result.unclassified, 1);
  });

  it("fails a NEW unclassified route that is not in the baseline (born classified)", () => {
    const { failures } = checkEndpointClassification({
      manifestRoutes: [route("apps/web/app/api/new-thing/route.ts", "/api/new-thing")],
      baselineFiles: [],
      publicPrefixes: PUBLIC_PREFIXES,
    });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /NEW route handler has no exposure class/);
  });

  it("fails an unclassified OR baselined governed-cohort (a2a) route — the cohort may never be grandfathered", () => {
    assert.ok(GOVERNED_COHORT_PREFIXES.includes("apps/web/app/api/a2a/"));
    const unclassified = checkEndpointClassification({
      manifestRoutes: [route("apps/web/app/api/a2a/coworkers/[agentId]/route.ts", "/api/a2a/coworkers/[agentId]")],
      baselineFiles: [],
      publicPrefixes: PUBLIC_PREFIXES,
    });
    assert.equal(unclassified.failures.length, 1);
    assert.match(unclassified.failures[0], /governed cohort .* has no exposure class/);

    const baselined = checkEndpointClassification({
      manifestRoutes: [route("apps/web/app/api/a2a/coworkers/[agentId]/route.ts", "/api/a2a/coworkers/[agentId]")],
      baselineFiles: ["apps/web/app/api/a2a/coworkers/[agentId]/route.ts"],
      publicPrefixes: PUBLIC_PREFIXES,
    });
    assert.ok(baselined.failures.some((f) => f.includes("may NEVER be grandfathered")));
  });

  it("fails stale baseline entries (route gone, or route now classified) — shrink-only", () => {
    const { failures } = checkEndpointClassification({
      manifestRoutes: [route("apps/web/app/api/done/route.ts", "/api/done", "authenticated")],
      baselineFiles: ["apps/web/app/api/done/route.ts", "apps/web/app/api/gone/route.ts"],
      publicPrefixes: PUBLIC_PREFIXES,
    });
    assert.equal(failures.length, 2);
    assert.ok(failures.some((f) => f.includes("now classified")));
    assert.ok(failures.some((f) => f.includes("no longer exists")));
  });

  it("cross-checks 'public' against the proxy path-segmentation allowlist, both directions", () => {
    const publicOutside = checkEndpointClassification({
      manifestRoutes: [route("apps/web/app/api/leak/route.ts", "/api/leak", "public")],
      baselineFiles: [],
      publicPrefixes: PUBLIC_PREFIXES,
    });
    assert.equal(publicOutside.failures.length, 1);
    assert.match(publicOutside.failures[0], /outside the proxy public path-segmentation allowlist/);

    const privateInside = checkEndpointClassification({
      manifestRoutes: [route("apps/web/app/api/auth/session/route.ts", "/api/auth/session", "authenticated")],
      baselineFiles: [],
      publicPrefixes: PUBLIC_PREFIXES,
    });
    assert.equal(privateInside.failures.length, 1);
    assert.match(privateInside.failures[0], /must not live under a publicly-segmented path prefix/);

    const publicInside = checkEndpointClassification({
      manifestRoutes: [route("apps/web/app/api/health/route.ts", "/api/health", "public")],
      baselineFiles: [],
      publicPrefixes: PUBLIC_PREFIXES,
    });
    assert.deepEqual(publicInside.failures, []);
  });

  it("rejects an unknown exposure class carried by the manifest (defense in depth)", () => {
    assert.deepEqual(EXPOSURE_CLASSES, ["public", "authenticated", "private-mesh"]);
    const { failures } = checkEndpointClassification({
      manifestRoutes: [route("apps/web/app/api/x/route.ts", "/api/x", "internal")],
      baselineFiles: [],
      publicPrefixes: PUBLIC_PREFIXES,
    });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /unknown exposure class "internal"/);
  });

  it("extracts the real proxy classifier's prefixes (live-source smoke check)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const live = extractPublicApiPrefixes(
      readFileSync(join(root, "apps/web/lib/storefront/storefront-middleware.ts"), "utf8"),
    );
    assert.ok(live.length > 0, "live proxy classifier must yield at least one PublicApi prefix");
    assert.ok(live.includes("/api/auth/"), "the /api/auth/ prefix is a stable expectation");
  });
});
