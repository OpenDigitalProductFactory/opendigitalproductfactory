/**
 * UX route budget sweep — EP-UX-SYSTEM spec §6 L4 / §7.1 (BI-BD81682A).
 *
 * Drives every static page route against a RUNNING portal, measures the SERVED DOM,
 * and applies the ratchet (lib/ux-budget/ratchet.ts). This is the mechanical answer to
 * "every iteration adds more wall of text": a changed route that exceeds its frozen
 * baseline fails a required check on every development surface.
 *
 * WHY THE SERVED DOM AND NOT AN SSR STRING: a string render has neither client
 * components nor honest visibility. The spec rules the shortcut out explicitly. Before
 * serialising, computed-invisible nodes are pruned IN THE PAGE, so a `hidden md:block`
 * utility is handled by the browser that actually resolved it — the pure module then
 * applies the structural disclosure semantics it can reason about.
 *
 * Usage:
 *   pnpm --filter web ux:sweep                     # measure + ratchet (exit 1 on regression)
 *   pnpm --filter web ux:sweep -- --update-baseline # freeze current as the new baseline
 *   pnpm --filter web ux:sweep -- --base-url http://localhost:3000
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { measureUxBudget } from "../lib/ux-budget/measure";
import {
  evaluateSweep,
  formatSweepReport,
  freezeBaseline,
  normaliseVolatileText,
  type BaselineFile,
  type RouteMeasurement,
} from "../lib/ux-budget/ratchet";
import type { UxShell } from "../lib/ux-budget/budgets";
import type { ExemptCheck } from "../lib/ux-budget/route-shells";

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== "/" && dir !== resolve(dir, "..")) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}

const ROOT = repoRoot();
const SHELLS_REL = "apps/web/lib/ux-budget/route-shells.generated.json";
const BASELINE_REL = "apps/web/lib/ux-budget/route-budget-baseline.json";
const REPORT_REL = "apps/web/lib/ux-budget/route-budget-report.json";
const GENERATOR = "apps/web/scripts/ux-route-sweep.ts";

type ShellRow = {
  routePath: string;
  shell: UxShell;
  migrated: boolean;
  exemptChecks: ExemptCheck[];
};

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * Prune what the reader genuinely cannot see, using the browser's own layout.
 * Runs in the page: only here is `display:none` from a utility class knowable.
 *
 * Passed to page.evaluate as a REAL FUNCTION, not a string. A string argument is
 * evaluated as an expression, so `"() => {...}"` yields a function object rather than
 * calling it, and the return value serialises to undefined — which then blew up in
 * scope.ts as "Cannot read properties of undefined (reading 'slice')" on 200 routes.
 */
function pruneInvisible(): string {
  const doc = document.cloneNode(true) as Document;
  // Walk the LIVE tree for computed styles, and drop the matching clone nodes.
  const live = document.querySelectorAll("body *");
  const clone = doc.querySelectorAll("body *");
  const drop: Element[] = [];
  for (let i = 0; i < live.length; i++) {
    const cs = getComputedStyle(live[i]);
    if (cs.display === "none" || cs.visibility === "hidden") {
      const node = clone[i];
      if (node) drop.push(node);
    }
  }
  for (const node of drop) node.remove();
  return doc.querySelector("body")?.innerHTML ?? "";
}

/** Why a route produced no measurement — reported, never silently dropped. */
export type SkipReason = { routePath: string; reason: string };

export async function resetSweepPage(
  page: {
    goto(
      url: string,
      options: { waitUntil: "load"; timeout: number },
    ): Promise<unknown>;
  },
): Promise<void> {
  await page
    .goto("about:blank", { waitUntil: "load", timeout: 10_000 })
    .catch(() => {});
}

async function measureRoute(
  page: Page,
  row: ShellRow,
  baseUrl: string,
  skipped: SkipReason[],
): Promise<RouteMeasurement | null> {
  // NOT networkidle: this portal holds long-lived connections (activity streams,
  // polling), so networkidle never settles and every route would time out.
  const response = await page.goto(`${baseUrl}${row.routePath}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  // Give client components a beat to hydrate; the whole point is the served DOM.
  await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});

  // A route that errors or redirects to auth is not a surface to budget; recording a
  // measurement for it would freeze a login page as the route's baseline.
  if (!response) {
    skipped.push({ routePath: row.routePath, reason: "no response" });
    return null;
  }
  if (response.status() >= 400) {
    skipped.push({ routePath: row.routePath, reason: `http ${response.status()}` });
    return null;
  }
  const landed = new URL(page.url()).pathname.replace(/\/$/, "") || "/";
  const wanted = row.routePath.replace(/\/$/, "") || "/";
  if (landed !== wanted) {
    skipped.push({ routePath: row.routePath, reason: `redirected to ${landed}` });
    return null;
  }

  const html = await page.evaluate(pruneInvisible);
  if (typeof html !== "string" || html.length === 0) {
    // Never hand an empty/undefined document to the measurer: it would score as a
    // perfectly compliant zero-word surface and freeze that as the route's baseline.
    skipped.push({ routePath: row.routePath, reason: "empty document after pruning" });
    return null;
  }
  const ariaSnapshot = await page.locator("body").ariaSnapshot({ timeout: 15_000 });

  // Necessary, never sufficient — axe green is not "accessible" (spec §5.4).
  // A failing SCAN must not cost us the whole route's budget measurement: axe threw
  // on nine public pages in the first run and took their measurements with it. Record
  // the axe count as unavailable (-1) rather than a fake 0, so the ratchet cannot read
  // a broken scan as an improvement.
  let axeViolations = -1;
  try {
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    axeViolations = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").length;
  } catch (err) {
    console.error(`[ux-sweep] axe scan failed on ${row.routePath}: ${(err as Error).message.split(/\r?\n/)[0]}`);
  }

  return {
    routePath: row.routePath,
    shell: row.shell,
    // Collapse wall-clock text first: seeded records render "updated <now>", so a
    // raw measurement moves with the clock (BI-EA221325).
    metrics: measureUxBudget(normaliseVolatileText(html)),
    ariaSnapshot,
    axeViolations,
    exemptChecks: row.exemptChecks,
  };
}

function loadBaseline(path: string): BaselineFile {
  if (!existsSync(path)) return { bootstrapped: false, generator: GENERATOR, routes: {} };
  return JSON.parse(readFileSync(path, "utf8")) as BaselineFile;
}

async function main(): Promise<void> {
  const baseUrl = arg("base-url", process.env.UX_SWEEP_BASE_URL ?? "http://localhost:3000");
  const storageState = arg("storage-state", "e2e/.auth/state.json");
  const updateBaseline = process.argv.includes("--update-baseline");

  const rows = (
    JSON.parse(readFileSync(join(ROOT, SHELLS_REL), "utf8")) as { routes: ShellRow[] }
  ).routes
    // Dynamic routes need per-route fixtures to be meaningful; they join when the
    // fixture org can supply real ids. Recorded as skipped rather than silently dropped.
    .filter((r) => !r.routePath.includes("["));

  const statePath = join(ROOT, storageState);
  let browser: Browser | undefined;
  const measurements: RouteMeasurement[] = [];
  const skipped: SkipReason[] = [];
  if (!existsSync(statePath)) {
    console.error(`[ux-sweep] WARNING: no storage state at ${storageState} — every authenticated route will redirect to login and be skipped.`);
  }

  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      ...(existsSync(statePath) ? { storageState: statePath } : {}),
    });
    const page = await context.newPage();

    for (const row of rows) {
      try {
        const m = await measureRoute(page, row, baseUrl, skipped);
        if (m) measurements.push(m);
      } catch (err) {
        // One unreachable route must not abort the sweep; it is reported as skipped.
        const first = (err as Error).message.split(/\r?\n/)[0];
        skipped.push({ routePath: row.routePath, reason: `error: ${first}` });
      } finally {
        // Isolate routes so the measured route cannot flake the NEXT one (BI-EA221325):
        // a route can trigger a client-side navigation after domcontentloaded, and if it
        // is still in flight when the next page.goto fires, Playwright throws
        // "Navigation to X is interrupted by another navigation to Y" — a route that is
        // then measured on one run and skipped on another, which reads as a false
        // regression. Resetting to about:blank between routes cancels any pending
        // navigation and gives every route the same clean starting state. Wait for
        // the full blank-page load: waiting only for "commit" lets that isolation
        // navigation race and interrupt the next real route. It is side-effect-free:
        // each real route re-navigates with its own page.goto.
        await resetSweepPage(page);
      }
    }
  } finally {
    await browser?.close();
  }

  console.error(`[ux-sweep] measured ${measurements.length} routes, skipped ${skipped.length}`);
  if (skipped.length) {
    const byReason = new Map<string, string[]>();
    for (const s of skipped) {
      const key = s.reason.replace(/\d+/g, "N");
      byReason.set(key, [...(byReason.get(key) ?? []), s.routePath]);
    }
    for (const [reason, routes] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
      console.error(`[ux-sweep]   ${routes.length}x ${reason} — e.g. ${routes.slice(0, 5).join(", ")}`);
    }
  }

  // CAPABILITY PROBE (spec §6 L5): a checker that measures nothing must be RED.
  // A sweep that skips every route and reports OK is the silent-empty failure this
  // epic exists to remove — it would sit green forever while measuring no UX at all.
  // The threshold is deliberately blunt: any run that cannot measure a majority of
  // the routes it was asked to measure has not done its job.
  const attempted = measurements.length + skipped.length;
  if (measurements.length === 0 || measurements.length * 2 < attempted) {
    console.error(
      [
        "",
        `[ux-sweep] FAILED CAPABILITY PROBE — measured ${measurements.length} of ${attempted} routes.`,
        "A sweep that cannot see the portal is not evidence of a healthy portal.",
        `Check the authenticated session (${storageState}) and that ${baseUrl} is serving.`,
      ].join("\n"),
    );
    process.exit(1);
  }

  if (updateBaseline) {
    writeFileSync(
      join(ROOT, BASELINE_REL),
      `${JSON.stringify(freezeBaseline(measurements, GENERATOR), null, 2)}\n`,
      "utf8",
    );
    console.error(`[ux-sweep] froze ${measurements.length} routes into ${BASELINE_REL}`);
    return;
  }

  const sweep = evaluateSweep(measurements, loadBaseline(join(ROOT, BASELINE_REL)));
  writeFileSync(join(ROOT, REPORT_REL), `${JSON.stringify(sweep, null, 2)}\n`, "utf8");
  console.error(formatSweepReport(sweep));

  if (sweep.blocked) {
    console.error(
      "\n[ux-sweep] BLOCKED — a route regressed against its frozen baseline, or a net-new route exceeded its shell budget.",
    );
    process.exit(1);
  }
  console.error("[ux-sweep] OK");
}

if (process.argv[1] && /ux-route-sweep\.[cm]?ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error("[ux-sweep] failed:", err);
    process.exit(1);
  });
}
