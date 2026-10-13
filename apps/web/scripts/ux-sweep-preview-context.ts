import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRouteParams, resolveSweepPath, type SweepRouteParams } from "./ux-sweep-route-params";

export function assertFixtureRoutePath(routePath: string, path: string) {
  const url = new URL(path, "http://preview.invalid");
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("[")
      || url.pathname !== path || url.search || url.hash) throw new Error(`invalid fixture path for ${routePath}`);
  const expression = routePath.split("/").slice(1).map(segment => {
    if (/^\[\[\.\.\..+\]\]$/.test(segment)) return "(?:/.*)?";
    if (/^\[\.\.\..+\]$/.test(segment)) return "/.+";
    if (/^\[.+\]$/.test(segment)) return "/[^/]+";
    return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
  }).join("");
  if (!new RegExp(`^${expression || "/"}$`).test(path)) throw new Error(`fixture path does not match ${routePath}`);
}

export async function loadExhaustivePreviewFixtures(input: { root: string; sourceRoot?: string; fixturePath: string; baseUrl: string }, deps: {
  readJson?: (path: string) => Record<string, any>;
  sourceSha?: () => string;
  health?: () => Promise<{ ok: boolean; body: Record<string, any> }>;
} = {}): Promise<{ routes: SweepRouteParams; sourceSha: string; leaseId: string }> {
  if (!input.fixturePath) throw new Error("exhaustive sweep requires an admitted-preview fixture map");
  const readJson = deps.readJson ?? (path => JSON.parse(readFileSync(path, "utf8")));
  const fixture = readJson(resolve(input.root, input.fixturePath));
  const health = deps.health ? await deps.health() : await (async () => {
    const response = await fetch(new URL("/api/health", input.baseUrl));
    return { ok: response.ok, body: await response.json() };
  })();
  // A preserved feature can predate the optional health identity payload. In
  // that case use the canonical issuer identity from passwordless bootstrap.
  const preview = health.body.preview ?? readJson(resolve(input.root, "e2e/.auth/preview-identity.json"));
  if (!health.ok || !preview?.sourceSha || !preview?.leaseId
      || fixture.sourceSha !== preview.sourceSha || fixture.leaseId !== preview.leaseId
      || new URL(fixture.baseUrl).origin !== new URL(input.baseUrl).origin
      || new URL(preview.baseUrl ?? input.baseUrl).origin !== new URL(input.baseUrl).origin) {
    throw new Error("fixture map does not belong to the admitted served source");
  }
  const sourceSha = deps.sourceSha?.() ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: input.sourceRoot ?? input.root, encoding: "utf8" }).trim();
  if (sourceSha !== preview.sourceSha) throw new Error("sweep inventory source differs from admitted preview");
  if (!fixture.routes || typeof fixture.routes !== "object" || Array.isArray(fixture.routes)) throw new Error("fixture map has no routes");
  return { routes: fixture.routes, sourceSha: preview.sourceSha, leaseId: preview.leaseId };
}

export function assertResolvedSweepPaths(rows: Array<{ routePath: string }>, params: SweepRouteParams) {
  for (const row of rows) assertFixtureRoutePath(row.routePath, resolveSweepPath(row.routePath, params));
}

export function sweepContextOptions(arg: (name: string, fallback: string) => string, argv: string[]) {
  const viewportName = arg("viewport", "desktop");
  if (!["desktop", "mobile"].includes(viewportName)) throw new Error("viewport must be desktop or mobile");
  const viewport = viewportName === "mobile" ? { width: 390, height: 844 } : { width: 1280, height: 900 };
  const navMode = arg("nav-mode", "operator");
  if (!["operator", "worker"].includes(navMode)) throw new Error("nav-mode must be operator or worker (Simple)");
  const colorScheme = arg("color-scheme", "light");
  if (colorScheme !== "light" && colorScheme !== "dark") throw new Error("color-scheme must be light or dark");
  return { exhaustive: argv.includes("--exhaustive"), viewport, navMode, colorScheme };
}

export async function prepareSweepInventory<T extends { routePath: string; sweepEligible: boolean }>(input: {
  root: string; sourceRoot: string; fixturePath: string; baseUrl: string; exhaustive: boolean; inventory: T[];
}) {
  const fixture = input.exhaustive ? await loadExhaustivePreviewFixtures(input) : undefined;
  return {
    routeParams: fixture?.routes ?? loadRouteParams(input.root),
    servedSourceSha: fixture?.sourceSha, servedLeaseId: fixture?.leaseId,
    selectedInventory: input.exhaustive ? input.inventory.map(row => ({ ...row, sweepEligible: true })) : input.inventory,
  };
}

export function excludedSweepRoutes<T extends { routePath: string; sweepEligible: boolean; sweepExclusionReason?: string }>(inventory: T[]) {
  return inventory.filter(row => !row.sweepEligible).map(row => ({ routePath: row.routePath, reason: row.sweepExclusionReason ?? "missing-generated-exclusion-reason" }));
}
