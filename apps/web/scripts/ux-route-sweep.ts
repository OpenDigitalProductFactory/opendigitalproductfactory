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
 */
const PRUNE_INVISIBLE = `() => {
  const doc = document.cloneNode(true);
  // Walk the LIVE tree for computed styles, and mark the corresponding clone nodes.
  const live = document.querySelectorAll('body *');
  const clone = doc.querySelectorAll('body *');
  const drop = [];
  for (let i = 0; i < live.length; i++) {
    const cs = getComputedStyle(live[i]);
    if (cs.display === 'none' || cs.visibility === 'hidden') drop.push(clone[i]);
  }
  for (const node of drop) node.remove();
  const body = doc.querySelector('body');
  return body ? body.innerHTML : '';
}`;

async function measureRoute(page: Page, row: ShellRow, baseUrl: string): Promise<RouteMeasurement | null> {
  const response = await page.goto(`${baseUrl}${row.routePath}`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  // A route that errors or redirects to auth is not a surface to budget; recording a
  // measurement for it would freeze a login page as the route's baseline.
  if (!response || response.status() >= 400) return null;
  if (new URL(page.url()).pathname !== row.routePath) return null;

  const html = await page.evaluate(PRUNE_INVISIBLE);
  const ariaSnapshot = await page.locator("body").ariaSnapshot();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();

  return {
    routePath: row.routePath,
    shell: row.shell,
    metrics: measureUxBudget(html),
    ariaSnapshot,
    // Necessary, never sufficient — axe green is not "accessible" (spec §5.4).
    axeViolations: axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").length,
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
  const skipped: string[] = [];

  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      ...(existsSync(statePath) ? { storageState: statePath } : {}),
    });
    const page = await context.newPage();

    for (const row of rows) {
      try {
        const m = await measureRoute(page, row, baseUrl);
        if (m) measurements.push(m);
        else skipped.push(row.routePath);
      } catch {
        // One unreachable route must not abort the sweep; it is reported as skipped.
        skipped.push(row.routePath);
      }
    }
  } finally {
    await browser?.close();
  }

  console.error(`[ux-sweep] measured ${measurements.length} routes, skipped ${skipped.length}`);
  if (skipped.length) console.error(`[ux-sweep] skipped: ${skipped.slice(0, 20).join(", ")}`);

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
