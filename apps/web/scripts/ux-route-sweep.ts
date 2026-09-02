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
 *   pnpm --filter web ux:sweep -- --routes /customer/marketing,/platform/tools/integrations
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { measureUxBudget } from "../lib/ux-budget/measure";
import { confirmBlockingRoutes } from "./ux-sweep-reproducibility";
import {
  evaluateSweep,
  formatSweepReport,
  freezeBaseline,
  normaliseVolatileText,
  type BaselineFile,
  type RouteMeasurement,
} from "../lib/ux-budget/ratchet";
import type { UxShell } from "../lib/ux-budget/budgets";
import type { RouteAudience } from "../lib/navigation/route-audience";
import { loadRouteParams, resolveSweepPath } from "./ux-sweep-route-params";
import type {
  ExemptCheck,
  RouteSweepExclusionReason,
} from "../lib/ux-budget/route-shells";
import {
  parseSweepWorkerCount,
  runBoundedRouteWork,
  serialiseSemanticStructure,
  type SemanticStructureNode,
  type RouteWorkResult,
} from "./ux-route-sweep-runner";

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
const EXECUTION_REL =
  "apps/web/test-results/ux-route-sweep/route-sweep-execution.json";
const DIAGNOSTICS_REL = "apps/web/test-results/ux-route-sweep/screenshots";
const MAX_FAILURE_SCREENSHOTS = 12;
const GENERATOR = "apps/web/scripts/ux-route-sweep.ts";
let failureScreenshotCount = 0;

export function uxSweepAxeOptions() {
  return {
    runOnly: {
      type: "tag" as const,
      values: ["wcag2a", "wcag2aa", "wcag22aa"],
    },
    resultTypes: ["violations" as const],
  };
}

type ShellRow = {
  routePath: string;
  shell: UxShell;
  audience: RouteAudience;
  migrated: boolean;
  exemptChecks: ExemptCheck[];
  sweepEligible: boolean;
  sweepExclusionReason?: RouteSweepExclusionReason;
};

export type RoutePhaseTimings = {
  navigationAndSettleMs: number;
  visibleDomMs: number;
  semanticStructureMs: number;
  accessibilityScanMs: number;
  budgetMeasurementMs: number;
};

type MeasuredRoute = {
  measurement: RouteMeasurement;
  phases: RoutePhaseTimings;
};

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function selectSweepRows(inventory: ShellRow[], rawSelector: string): ShellRow[] {
  const eligible = inventory.filter((row) => row.sweepEligible);
  const requested = [...new Set(rawSelector.split(",").map((route) => route.trim()).filter(Boolean))];
  if (requested.length === 0) return eligible;

  const eligiblePaths = new Set(eligible.map((row) => row.routePath));
  const unresolved = requested.filter((routePath) => !eligiblePaths.has(routePath)).sort();
  if (unresolved.length > 0) {
    throw new Error(`unknown or ineligible route selector(s): ${unresolved.join(", ")}`);
  }

  const selected = new Set(requested);
  return eligible.filter((row) => selected.has(row.routePath));
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

/**
 * Give one route exclusive ownership of one page.
 *
 * Authentication lives on the shared BrowserContext, so a fresh page is cheap but
 * cross-route client navigations cannot interrupt the next route's page.goto.
 */
export async function withIsolatedSweepPage<
  TPage extends { close(): Promise<void> },
  TResult,
>(
  context: { newPage(): Promise<TPage> },
  operation: (page: TPage) => Promise<TResult>,
): Promise<TResult> {
  const page = await context.newPage();
  try {
    return await operation(page);
  } finally {
    // Browser shutdown remains the final cleanup backstop. A close failure should
    // not replace the route's more useful measurement error.
    await page.close().catch(() => {});
  }
}

function captureSemanticStructureFromDom(): SemanticStructureNode[] {
  const named = (element: Element): boolean =>
    element.hasAttribute("aria-label") ||
    element.hasAttribute("aria-labelledby");

  const implicitRole = (element: Element): string | null => {
    const tag = element.tagName.toLowerCase();
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "main") return "main";
    if (tag === "nav") return "navigation";
    if (tag === "header") {
      return element.closest("article, aside, main, nav, section")
        ? null
        : "banner";
    }
    if (tag === "footer") {
      return element.closest("article, aside, main, nav, section")
        ? null
        : "contentinfo";
    }
    if (tag === "aside") return "complementary";
    if (tag === "form") return named(element) ? "form" : null;
    if (tag === "section") return named(element) ? "region" : null;
    if (tag === "dialog") return "dialog";
    if (tag === "details" || tag === "fieldset") return "group";
    if (tag === "table") return "table";
    if (tag === "thead" || tag === "tbody" || tag === "tfoot") return "rowgroup";
    if (tag === "tr") return "row";
    if (tag === "th") {
      return element.getAttribute("scope") === "row"
        ? "rowheader"
        : "columnheader";
    }
    if (tag === "td") return "cell";
    if (tag === "ul" || tag === "ol") return "list";
    if (tag === "li") return "listitem";
    if (tag === "select") {
      const select = element as HTMLSelectElement;
      return select.multiple || select.size > 1 ? "listbox" : "combobox";
    }
    if (tag === "option") return "option";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const input = element as HTMLInputElement;
      if (["button", "submit", "reset", "image"].includes(input.type)) return "button";
      if (input.type === "checkbox") return "checkbox";
      if (input.type === "radio") return "radio";
      if (input.type === "number") return "spinbutton";
      if (input.type === "range") return "slider";
      if (input.type === "search") return "searchbox";
      if (input.type === "hidden") return null;
      return "textbox";
    }
    if (tag === "img") {
      return element.getAttribute("alt") === "" ? null : "img";
    }
    if (tag === "hr") return "separator";
    if (tag === "progress") return "progressbar";
    if (tag === "meter") return "meter";
    if (tag === "p") return "paragraph";
    if (tag === "code") return "code";
    if (tag === "strong") return "strong";
    return null;
  };

  const structuralAttributes = (element: Element, role: string): string[] => {
    const attributes: string[] = [];
    if (role === "heading") {
      const level =
        element.getAttribute("aria-level") ??
        (/^h[1-6]$/i.test(element.tagName) ? element.tagName.slice(1) : null);
      if (level) attributes.push(`[level=${level}]`);
    }
    for (const state of ["pressed", "checked", "expanded", "selected", "disabled"]) {
      const value = element.getAttribute(`aria-${state}`);
      if (value === "true") attributes.push(`[${state}]`);
      else if (value && value !== "false") attributes.push(`[${state}=${value}]`);
    }
    const control = element as HTMLInputElement | HTMLSelectElement | HTMLOptionElement;
    if ("checked" in control && control.checked && !attributes.includes("[checked]")) {
      attributes.push("[checked]");
    }
    if ("selected" in control && control.selected && !attributes.includes("[selected]")) {
      attributes.push("[selected]");
    }
    if ("disabled" in control && control.disabled && !attributes.includes("[disabled]")) {
      attributes.push("[disabled]");
    }
    if (element instanceof HTMLDetailsElement && element.open) {
      attributes.push("[expanded]");
    }
    return attributes;
  };

  const nameFromContentRoles = new Set([
    "button",
    "checkbox",
    "columnheader",
    "heading",
    "link",
    "listitem",
    "option",
    "radio",
    "rowheader",
    "tab",
  ]);

  const walk = (node: Node, suppressText = false): SemanticStructureNode[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      return !suppressText && node.textContent?.trim()
        ? [{ role: "text" }]
        : [];
    }
    if (!(node instanceof Element)) return [];
    if (
      node.hasAttribute("hidden") ||
      node.getAttribute("aria-hidden") === "true"
    ) {
      return [];
    }
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return [];

    const explicitRole = node
      .getAttribute("role")
      ?.trim()
      .split(/\s+/)[0]
      ?.toLowerCase();
    const role =
      explicitRole === "none" || explicitRole === "presentation"
        ? null
        : explicitRole || implicitRole(node);
    const children = [...node.childNodes].flatMap((child) =>
      walk(child, role ? nameFromContentRoles.has(role) : false),
    );
    if (!role) return children;
    return [{
      role,
      attributes: structuralAttributes(node, role),
      children,
    }];
  }

  return walk(document.body);
}

/**
 * tsx/esbuild preserves nested function names by referencing its `__name` helper.
 * Playwright serialises only the callback passed to page.evaluate, so that helper is
 * outside the browser realm unless we install the matching runtime primitive there.
 *
 * Keep this as a string expression: compiling another callback to install the helper
 * would recreate the same cross-realm dependency we are repairing.
 */
export const BROWSER_EVALUATION_RUNTIME =
  "globalThis.__name = (target, value) => Object.defineProperty(target, 'name', { value, configurable: true })";

/**
 * Resolve after the hydrated DOM has been mutation-free for a short interval.
 *
 * `networkidle` is invalid for this portal because event streams and polling are
 * intentionally long-lived. Capturing immediately after `load` is also invalid:
 * client-populated cards then race the measurement and move word counts by a row or
 * status label between identical runs. The hard deadline keeps a genuinely live DOM
 * from hanging the sweep.
 *
 * This remains a string expression for the same cross-realm reason as the transpiler
 * runtime above: nested callbacks compiled by tsx would otherwise depend on `__name`.
 */
export const DOM_SETTLE_EXPRESSION = `(() => new Promise((resolve, reject) => {
  const quietMs = 300;
  const deadlineMs = 10000;
  const pendingSelector = '[data-dpf-ux-settle="pending"]';
  let quietTimer;
  let deadlineTimer;
  const observer = new MutationObserver(() => armQuietTimer());
  const cleanup = () => {
    clearTimeout(quietTimer);
    clearTimeout(deadlineTimer);
    observer.disconnect();
  };
  const finish = () => {
    cleanup();
    resolve(undefined);
  };
  const fail = () => {
    cleanup();
    reject(new Error('UX settle boundary remained pending after ' + deadlineMs + 'ms'));
  };
  const armQuietTimer = () => {
    clearTimeout(quietTimer);
    if (document.querySelector(pendingSelector)) return;
    quietTimer = setTimeout(finish, quietMs);
  };
  observer.observe(document.body, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true
  });
  deadlineTimer = setTimeout(fail, deadlineMs);
  armQuietTimer();
}))()`;

export async function waitForRouteDomToSettle(page: Page): Promise<void> {
  await page.evaluate(DOM_SETTLE_EXPRESSION);
}

export async function captureAccessibilityStructure(page: Page): Promise<string> {
  await page.evaluate(BROWSER_EVALUATION_RUNTIME);
  const structure = await page.evaluate(captureSemanticStructureFromDom);
  return serialiseSemanticStructure(structure);
}

async function measureRoute(
  page: Page,
  row: ShellRow,
  baseUrl: string,
  routeParams: Readonly<Record<string, string>> = {},
): Promise<MeasuredRoute> {
  const targetPath = resolveSweepPath(row.routePath, routeParams);
  const phases = {} as RoutePhaseTimings;
  let phaseStartedAt = performance.now();

  // NOT networkidle: this portal holds long-lived connections (activity streams,
  // polling), so networkidle never settles and every route would time out.
  const response = await page.goto(`${baseUrl}${targetPath}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  // Give client components a beat to hydrate; the whole point is the served DOM.
  await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
  await waitForRouteDomToSettle(page);

  // A route that errors or redirects to auth is not a surface to budget; recording a
  // measurement for it would freeze a login page as the route's baseline.
  if (!response) {
    throw new Error("no response");
  }
  if (response.status() >= 400) {
    throw new Error(`http ${response.status()}`);
  }
  const landed = new URL(page.url()).pathname.replace(/\/$/, "") || "/";
  const wanted = targetPath.replace(/\/$/, "") || "/";
  if (landed !== wanted) {
    throw new Error(`redirected to ${landed}`);
  }
  phases.navigationAndSettleMs = Math.round(performance.now() - phaseStartedAt);

  phaseStartedAt = performance.now();
  const html = await page.evaluate(pruneInvisible);
  if (typeof html !== "string" || html.length === 0) {
    // Never hand an empty/undefined document to the measurer: it would score as a
    // perfectly compliant zero-word surface and freeze that as the route's baseline.
    throw new Error("empty document after pruning");
  }
  phases.visibleDomMs = Math.round(performance.now() - phaseStartedAt);

  // Project the browser-resolved semantic DOM to role/nesting/state only. The
  // ratchet deliberately ignores accessible names, so asking Playwright or CDP to
  // serialise the full named AX tree first is both wasted work and unbounded on
  // large data-owner pages such as /admin/reference-data.
  phaseStartedAt = performance.now();
  const ariaSnapshot = await captureAccessibilityStructure(page);
  phases.semanticStructureMs = Math.round(performance.now() - phaseStartedAt);

  // Necessary, never sufficient — axe green is not "accessible" (spec §5.4).
  // A failing SCAN must not cost us the whole route's budget measurement: axe threw
  // on nine public pages in the first run and took their measurements with it. Record
  // the axe count as unavailable (-1) rather than a fake 0, so the ratchet cannot read
  // a broken scan as an improvement.
  let axeViolations = -1;
  phaseStartedAt = performance.now();
  try {
    const axe = await new AxeBuilder({ page })
      // axe still evaluates the same rules against the same document. Restricting
      // returned result groups avoids generating selectors and payloads for passes,
      // incomplete, and inapplicable nodes that this gate never consumes.
      // Keep rule tags in the same options object: AxeBuilder.options replaces
      // prior withTags configuration rather than merging it.
      .options(uxSweepAxeOptions())
      .analyze();
    axeViolations = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").length;
  } catch (err) {
    console.error(`[ux-sweep] axe scan failed on ${row.routePath}: ${(err as Error).message.split(/\r?\n/)[0]}`);
  } finally {
    phases.accessibilityScanMs = Math.round(performance.now() - phaseStartedAt);
  }

  phaseStartedAt = performance.now();
  const measurement = {
    routePath: row.routePath,
    shell: row.shell,
    audience: row.audience,
    // Collapse wall-clock text first: seeded records render "updated <now>", so a
    // raw measurement moves with the clock (BI-EA221325).
    metrics: measureUxBudget(normaliseVolatileText(html)),
    ariaSnapshot,
    axeViolations,
    exemptChecks: row.exemptChecks,
  };
  phases.budgetMeasurementMs = Math.round(performance.now() - phaseStartedAt);

  return { measurement, phases };
}

function loadBaseline(path: string): BaselineFile {
  if (!existsSync(path)) return { bootstrapped: false, generator: GENERATOR, routes: {} };
  return JSON.parse(readFileSync(path, "utf8")) as BaselineFile;
}

/**
 * BI-EE6E0CFC — routes present in the committed baseline but missing from a
 * freshly frozen measurement. A non-empty result means the refresh would
 * silently delete ratchets and must be refused.
 */
export function findDroppedBaselineRoutes(
  committed: BaselineFile | null | undefined,
  frozen: BaselineFile,
): string[] {
  if (!committed?.routes) return [];
  const frozenRoutes = new Set(Object.keys(frozen.routes ?? {}));
  return Object.keys(committed.routes)
    .filter((routePath) => !frozenRoutes.has(routePath))
    .sort();
}

function routeArtifactSlug(routePath: string): string {
  return (
    routePath
      .replace(/^\/+/, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "root"
  );
}

async function captureFailureScreenshot(page: Page, routePath: string): Promise<void> {
  if (failureScreenshotCount >= MAX_FAILURE_SCREENSHOTS) return;
  failureScreenshotCount += 1;
  const diagnosticsDir = join(ROOT, DIAGNOSTICS_REL);
  mkdirSync(diagnosticsDir, { recursive: true });
  await page
    .screenshot({
      path: join(diagnosticsDir, `${routeArtifactSlug(routePath)}.png`),
      fullPage: true,
      animations: "disabled",
      timeout: 10_000,
    })
    .catch(() => {});
}

export function executionOutcome(
  outcome: RouteWorkResult<MeasuredRoute>["outcomes"][number],
): {
  routePath: string;
  status: "measured" | "failed";
  durationMs: number;
  phases?: RoutePhaseTimings;
  axeViolations?: number;
  reason?: string;
} {
  return outcome.status === "measured"
    ? {
        routePath: outcome.routePath,
        status: outcome.status,
        durationMs: outcome.durationMs,
        phases: outcome.value.phases,
        axeViolations: outcome.value.measurement.axeViolations,
      }
    : {
        routePath: outcome.routePath,
        status: outcome.status,
        durationMs: outcome.durationMs,
        reason: outcome.reason,
      };
}

async function main(): Promise<void> {
  const baseUrl = arg("base-url", process.env.UX_SWEEP_BASE_URL ?? "http://localhost:3000");
  const storageState = arg("storage-state", "e2e/.auth/state.json");
  const workerCount = parseSweepWorkerCount(
    arg("workers", process.env.UX_SWEEP_WORKERS ?? "2"),
  );
  const routeSelector = arg("routes", process.env.UX_SWEEP_ROUTES ?? "");
  const updateBaseline = process.argv.includes("--update-baseline");

  const inventory = (
    JSON.parse(readFileSync(join(ROOT, SHELLS_REL), "utf8")) as { routes: ShellRow[] }
  ).routes;
  const rows = selectSweepRows(inventory, routeSelector);
  const routeParams = loadRouteParams(ROOT);
  const excluded = inventory
    .filter((row) => !row.sweepEligible)
    .map((row) => ({
      routePath: row.routePath,
      reason: row.sweepExclusionReason ?? "missing-generated-exclusion-reason",
    }));

  const statePath = join(ROOT, storageState);
  let browser: Browser | undefined;
  let contexts: BrowserContext[] = [];
  let routeRun: RouteWorkResult<MeasuredRoute> | undefined;
  /** Routes whose blocking verdict did not reproduce on a second measurement (BI-69FE5504). */
  let notReproducible: string[] = [];
  if (!existsSync(statePath)) {
    console.error(
      `[ux-sweep] WARNING: no storage state at ${storageState} — authenticated route measurement will fail.`,
    );
  }

  try {
    browser = await chromium.launch();
    contexts = await Promise.all(
      Array.from({ length: workerCount }, () =>
        browser!.newContext({
          viewport: { width: 1280, height: 900 },
          ...(existsSync(statePath) ? { storageState: statePath } : {}),
        }),
      ),
    );

    routeRun = await runBoundedRouteWork(
      rows,
      workerCount,
      async (row, workerIndex) =>
        withIsolatedSweepPage(contexts[workerIndex], async (page) => {
          try {
            return await measureRoute(page, row, baseUrl, routeParams);
          } catch (error) {
            await captureFailureScreenshot(page, row.routePath);
            throw error;
          }
        }),
    );
    // A blocking verdict must be attributable to a real defect: some routes
    // render from state the sweep does not pin, so a delta can be noise. Only
    // block if it reproduces (BI-69FE5504 — see findNotReproducibleBlocking).
    if (!updateBaseline && routeRun) {
      const firstPass = routeRun.outcomes.flatMap((o) => (o.status === "measured" ? [o.value.measurement] : []));
      const provisional = evaluateSweep(firstPass, loadBaseline(join(ROOT, BASELINE_REL)));
      notReproducible = await confirmBlockingRoutes({
        rows,
        firstPassBlocking: provisional.blocked ? provisional.verdicts.filter((v) => !v.ok).map((v) => v.routePath) : [],
        onConfirmStart: (count) =>
          console.error(`[ux-sweep] confirming ${count} blocking route(s) with a second measurement (BI-69FE5504)`),
        remeasure: async (confirmRows) => {
          const run = await runBoundedRouteWork(
            [...confirmRows],
            Math.min(workerCount, confirmRows.length),
            async (row, workerIndex) =>
              withIsolatedSweepPage(contexts[workerIndex], async (page) => measureRoute(page, row, baseUrl, routeParams)),
          );
          const measured = run.outcomes.flatMap((o) => (o.status === "measured" ? [o.value.measurement] : []));
          return {
            blocking: evaluateSweep(measured, loadBaseline(join(ROOT, BASELINE_REL))).verdicts.filter((v) => !v.ok).map((v) => v.routePath),
            unmeasured: run.outcomes.filter((o) => o.status !== "measured").map((o) => o.routePath),
          };
        },
      });
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await browser?.close();
  }

  if (!routeRun) throw new Error("route worker orchestration did not produce a result");
  const measurements = routeRun.outcomes.flatMap((outcome) =>
    outcome.status === "measured" ? [outcome.value.measurement] : [],
  );
  const executionReport = {
    schemaVersion: 2,
    sourceSha: process.env.GITHUB_SHA ?? process.env.UX_SWEEP_SOURCE_SHA ?? "unknown",
    workerCount,
    durationMs: routeRun.durationMs,
    inventory: {
      totalRouteCount: inventory.length,
      eligibleRouteCount: rows.length,
      excludedRouteCount: excluded.length,
      excluded,
    },
    accounting: routeRun.accounting,
    // Recorded so an unreliable gate cannot hide: these routes produced a
    // blocking verdict that did not survive a second measurement (BI-69FE5504).
    notReproducibleBlockingRoutes: notReproducible,
    routes: routeRun.outcomes.map(executionOutcome),
  };
  const executionPath = join(ROOT, EXECUTION_REL);
  mkdirSync(dirname(executionPath), { recursive: true });
  writeFileSync(
    executionPath,
    `${JSON.stringify(executionReport, null, 2)}\n`,
    "utf8",
  );

  console.error(
    `[ux-sweep] measured ${measurements.length}/${rows.length} eligible routes with ${workerCount} worker(s); ${excluded.length} explicitly excluded from this fixture context`,
  );
  if (!routeRun.accounting.complete) {
    for (const outcome of routeRun.outcomes) {
      if (outcome.status === "failed") {
        console.error(`[ux-sweep] FAILED ${outcome.routePath}: ${outcome.reason}`);
      }
    }
    if (routeRun.accounting.missingRoutes.length > 0) {
      console.error(
        `[ux-sweep] missing results: ${routeRun.accounting.missingRoutes.join(", ")}`,
      );
    }
    if (routeRun.accounting.duplicateRoutes.length > 0) {
      console.error(
        `[ux-sweep] duplicate results: ${routeRun.accounting.duplicateRoutes.join(", ")}`,
      );
    }
    if (routeRun.accounting.unexpectedRoutes.length > 0) {
      console.error(
        `[ux-sweep] unexpected results: ${routeRun.accounting.unexpectedRoutes.join(", ")}`,
      );
    }
    console.error(
      `[ux-sweep] FAILED COMPLETENESS CONTRACT — see ${EXECUTION_REL} and failure-only screenshots.`,
    );
    process.exit(1);
  }

  if (updateBaseline) {
    // BI-EE6E0CFC: never emit a baseline that silently drops routes the
    // committed file already watches. A refresh that shrinks coverage is not
    // publishable — the documented "commit the artifact" path would delete
    // ratchets for routes the sweep failed to measure (timeout, error, auth).
    // Read once (no existsSync→write TOCTOU; CodeQL js/file-system-race).
    const baselinePath = join(ROOT, BASELINE_REL);
    const frozen = freezeBaseline(measurements, GENERATOR);
    let committed: BaselineFile | null = null;
    try {
      committed = JSON.parse(readFileSync(baselinePath, "utf8")) as BaselineFile;
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
      if (code !== "ENOENT") throw err;
    }
    if (committed) {
      const dropped = findDroppedBaselineRoutes(committed, frozen);
      if (dropped.length > 0) {
        console.error(
          `[ux-sweep] REFUSE TO SHRINK BASELINE — ${dropped.length} committed route(s) missing from this measurement run (BI-EE6E0CFC).`,
        );
        for (const routePath of dropped) {
          console.error(`  - ${routePath}`);
        }
        console.error(
          "Either fix the sweep so these routes measure, declare a sweepExclusionReason in the route-shell registry, or splice only the deliberately re-frozen route(s) rather than replacing the whole file.",
        );
        process.exit(1);
      }
    }
    writeFileSync(
      baselinePath,
      `${JSON.stringify(frozen, null, 2)}\n`,
      "utf8",
    );
    console.error(`[ux-sweep] froze ${measurements.length} routes into ${BASELINE_REL}`);
    return;
  }

  const sweep = evaluateSweep(measurements, loadBaseline(join(ROOT, BASELINE_REL)));
  writeFileSync(join(ROOT, REPORT_REL), `${JSON.stringify(sweep, null, 2)}\n`, "utf8");
  console.error(formatSweepReport(sweep));

  if (notReproducible.length > 0) {
    console.error(
      `\n[ux-sweep] NOT REPRODUCIBLE — ${notReproducible.length} route(s) produced a blocking verdict that did not survive a second measurement:`,
    );
    for (const routePath of notReproducible) console.error(`  - ${routePath}`);
    console.error(
      "These are NOT blocking this run, because a gate must attribute its refusal to a real defect (BI-69FE5504).\n" +
        "They ARE a defect in their own right: the route renders from state the sweep does not pin, so its measurement\n" +
        "is not a measurement. Fix the route's fixture determinism rather than re-running until it passes.",
    );
  }
  const blockedRoutes = sweep.verdicts.filter((v) => !v.ok && !notReproducible.includes(v.routePath));

  if (sweep.blocked && blockedRoutes.length > 0) {
    console.error(
      "\n[ux-sweep] BLOCKED — a route regressed against its frozen baseline, or a net-new route exceeded its shell budget.",
    );
    // BI-26DA1AEB residual: structureChanged failures used to strand authors who
    // did not know the sanctioned re-freeze path exists (workflow_dispatch +
    // update_baseline artifact, not a silent CI commit).
    if (blockedRoutes.some((v) => v.structureChanged)) {
      console.error(
        "\n[ux-sweep] structureChanged recovery (BI-26DA1AEB):\n" +
          "  1. gh workflow run ux-route-sweep.yml --ref <branch> -f update_baseline=true\n" +
          "  2. Download artifact ux-route-budget-baseline\n" +
          "  3. Splice ONLY the deliberately re-frozen route(s) into the committed baseline (do not replace the whole file if routes are missing — BI-EE6E0CFC)\n" +
          "  4. Commit under review. The baseline is a reviewed engineering act, not a CI auto-write.",
      );
    }
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
