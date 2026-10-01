import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

// BI-454FF60F: a page that only redirects is a compatibility alias for old
// bookmarks. In-app links must target the canonical page instead, or every
// click pays a redirect (sometimes two) and the alias can never be retired.
// The redirect-only set is derived from app/**/page.tsx, so it cannot drift.

const WEB_ROOT = join(__dirname, "..", "..");
const APP_DIR = join(WEB_ROOT, "app");
const SCAN_DIRS = ["components", "lib"].map((d) => join(WEB_ROOT, d));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// A page is redirect-only when it calls redirect()/permanentRedirect() and
// renders nothing: no JSX and no return statement.
function isRedirectOnly(source: string): boolean {
  const body = source.replace(/^\s*import .*$/gm, "");
  return /\b(permanentRedirect|redirect)\(/.test(body) && !/<[A-Za-z]/.test(body) && !/\breturn\b/.test(body);
}

function routeOf(pageFile: string): string {
  const segments = relative(APP_DIR, pageFile).split(sep).slice(0, -1);
  const kept = segments.filter((s) => !(s.startsWith("(") && s.endsWith(")")));
  return "/" + kept.join("/");
}

// Resolver pages compute their destination from data, so there is no single
// canonical link to use instead. They are dispatch steps, not aliases.
const RESOLVERS = new Set([
  "/s/[slug]/checkout", // picks the result page for the submission type
  "/ops/health", // resolves the portal product id
]);

function redirectOnlyRoutes(): string[] {
  return walk(APP_DIR)
    .filter((f) => f.endsWith(`${sep}page.tsx`))
    .filter((f) => isRedirectOnly(readFileSync(f, "utf8")))
    .map(routeOf)
    .filter((route) => route !== "/" && !RESOLVERS.has(route));
}

// The literal an href would carry for the whole route: static segments as
// written, each dynamic segment as a template slot, then a closing quote, a
// query string or a fragment.
function hrefPattern(route: string): RegExp {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = route
    .split("/")
    .map((seg) => (seg.startsWith("[") ? "\\$\\{[^}]+\\}" : escape(seg)))
    .join("/");
  const open = route.includes("[") ? "`" : "[\"'`]";
  return new RegExp(`${open}${body}(?=["'\`?#])`);
}

describe("in-app links to redirect-only pages", () => {
  const routes = redirectOnlyRoutes();

  it("finds the known compatibility aliases (derivation sanity check)", () => {
    expect(routes).toContain("/platform/ai/authority");
    expect(routes).toContain("/platform/ai/history");
  });

  it("no href in components/ or lib/ targets a redirect-only page", () => {
    const offenders: string[] = [];
    for (const file of SCAN_DIRS.flatMap((d) => walk(d))) {
      if (!/\.(ts|tsx)$/.test(file) || /\.test\.(ts|tsx)$/.test(file)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/href|deepLink|router\.push/i.test(line)) return;
        for (const route of routes) {
          if (hrefPattern(route).test(line)) {
            offenders.push(`${relative(WEB_ROOT, file)}:${i + 1} -> ${route}`);
          }
        }
      });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
