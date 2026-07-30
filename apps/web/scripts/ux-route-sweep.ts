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
import type {
  ExemptCheck,
  RouteSweepExclusionReason,
} from "../lib/ux-budget/route-shells";
import purposeRegistryJson from "../lib/ux-budget/route-purpose.generated.json";
import { parsePagePurposeRegistry } from "../lib/ux-budget/page-purpose";
import {
  evaluateRoutePurpose,
  type PurposeDomEvidence,
} from "../lib/ux-budget/purpose-evaluator";
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

export function capturePurposeEvidenceFromDom(): PurposeDomEvidence | null {
  const root = document.querySelector<HTMLElement>("[data-dpf-purpose-route]");
  if (!root) return null;

  const visible = (element: Element): boolean => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  };
  const actions = [
    ...root.querySelectorAll<HTMLElement>("[data-dpf-purpose-action-key]"),
  ].map((element) => {
    const rect = element.getBoundingClientRect();
    const href =
      element instanceof HTMLAnchorElement
        ? new URL(element.href, location.href).pathname
        : undefined;
    return {
      key: element.dataset.dpfPurposeActionKey ?? "",
      primary: element.hasAttribute("data-dpf-primary-action"),
      visible: visible(element),
      geometry: {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      },
      ...(href ? { href } : {}),
    };
  });
  const recoveryAction = actions.find(
    (action) => action.key === "open-recovery-guidance",
  );
  const disclosures = [
    ...root.querySelectorAll<HTMLElement>(
      "[data-dpf-purpose-disclosure-key]",
    ),
  ].map((container) => {
    const key = container.dataset.dpfPurposeDisclosureKey ?? "";
    const trigger = container.querySelector<HTMLElement>(
      "[data-dpf-purpose-disclosure-trigger]",
    );
    const region = container.querySelector<HTMLElement>(
      "[data-dpf-purpose-disclosure-region]",
    );
    const controlledId = trigger?.getAttribute("aria-controls");
    return {
      key,
      triggerPresent: Boolean(trigger),
      controlledRegionPresent: Boolean(region),
      relationshipValid:
        Boolean(trigger && region) &&
        (container instanceof HTMLDetailsElement ||
          (Boolean(controlledId) && region?.id === controlledId)),
      expanded:
        container instanceof HTMLDetailsElement
          ? container.open
          : trigger?.getAttribute("aria-expanded") === "true",
    };
  });

  return {
    routePath: root.dataset.dpfPurposeRoute ?? null,
    stateKey: root.dataset.dpfPurposeState ?? null,
    h1Count: root.querySelectorAll("h1").length,
    purposeKeys: [
      ...root.querySelectorAll<HTMLElement>("[data-dpf-purpose-key]"),
    ]
      .map((element) => element.dataset.dpfPurposeKey ?? "")
      .filter(Boolean),
    actions,
    messages: [
      ...root.querySelectorAll<HTMLElement>(
        "[data-dpf-purpose-message-key]",
      ),
    ]
      .map((element) => element.dataset.dpfPurposeMessageKey ?? "")
      .filter(Boolean),
    prohibitedActionKeysPresent: [],
    completionSignalPresent: Boolean(
      root.querySelector("[data-dpf-purpose-completion-signal]"),
    ),
    correctionSignalPresent: Boolean(
      root.querySelector("[data-dpf-purpose-correction-signal]"),
    ),
    recoverySignal: {
      present: Boolean(
        root.querySelector("[data-dpf-purpose-recovery-signal]") &&
          recoveryAction,
      ),
      actionKey: recoveryAction?.key ?? null,
      routePath: recoveryAction?.href ?? null,
    },
    disclosures,
    consequentialAction: {
      consequenceVisible: Boolean(
        root.querySelector("[data-dpf-purpose-consequence]"),
      ),
      reversibilityVisible: Boolean(
        root.querySelector("[data-dpf-purpose-reversibility]"),
      ),
      confirmationAvailable: Boolean(
        root.querySelector("[data-dpf-purpose-confirmation]"),
      ),
      authorityVisible: Boolean(
        root.querySelector("[data-dpf-purpose-authority]"),
      ),
      recoveryVisible: Boolean(
        root.querySelector("[data-dpf-purpose-recovery-context]"),
      ),
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

export async function capturePurposeEvidence(
  page: Page,
): Promise<PurposeDomEvidence | null> {
  await page.evaluate(BROWSER_EVALUATION_RUNTIME);
  return page.evaluate(capturePurposeEvidenceFromDom);
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
): Promise<MeasuredRoute> {
  const phases = {} as RoutePhaseTimings;
  let phaseStartedAt = performance.now();

  // NOT networkidle: this portal holds long-lived connections (activity streams,
  // polling), so networkidle never settles and every route would time out.
  const response = await page.goto(`${baseUrl}${row.routePath}`, {
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
  const wanted = row.routePath.replace(/\/$/, "") || "/";
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
    purposeEvidence: await capturePurposeEvidence(page),
  };
  phases.budgetMeasurementMs = Math.round(performance.now() - phaseStartedAt);

  return { measurement, phases };
}

function loadBaseline(path: string): BaselineFile {
  if (!existsSync(path)) return { bootstrapped: false, generator: GENERATOR, routes: {} };
  return JSON.parse(readFileSync(path, "utf8")) as BaselineFile;
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
  reason?: string;
} {
  return outcome.status === "measured"
    ? {
        routePath: outcome.routePath,
        status: outcome.status,
        durationMs: outcome.durationMs,
        phases: outcome.value.phases,
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
  const updateBaseline = process.argv.includes("--update-baseline");

  const inventory = (
    JSON.parse(readFileSync(join(ROOT, SHELLS_REL), "utf8")) as { routes: ShellRow[] }
  ).routes;
  const rows = inventory.filter((row) => row.sweepEligible);
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
            return await measureRoute(page, row, baseUrl);
          } catch (error) {
            await captureFailureScreenshot(page, row.routePath);
            throw error;
          }
        }),
    );
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
    writeFileSync(
      join(ROOT, BASELINE_REL),
      `${JSON.stringify(freezeBaseline(measurements, GENERATOR), null, 2)}\n`,
      "utf8",
    );
    console.error(`[ux-sweep] froze ${measurements.length} routes into ${BASELINE_REL}`);
    return;
  }

  const purposeRegistry = parsePagePurposeRegistry(purposeRegistryJson);
  const evidenceByRoute = new Map(
    measurements.map((measurement) => [
      measurement.routePath,
      measurement.purposeEvidence ?? null,
    ]),
  );
  const purposeEvaluations = purposeRegistry.routes.map((contract) =>
    evaluateRoutePurpose({
      contract,
      evidence: evidenceByRoute.get(contract.routePath) ?? null,
      oracle: null,
      enforcement: "advisory",
    }),
  );
  const sweep = evaluateSweep(
    measurements,
    loadBaseline(join(ROOT, BASELINE_REL)),
    purposeEvaluations,
  );
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
