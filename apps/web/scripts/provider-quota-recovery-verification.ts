/** Served controls and synthetic Responses integration in the existing UX runtime.
 * These fixtures never establish real subscription capacity or replay coworker work.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { chromium, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { SOURCE_CATALOG } from "@dpf/i18n";
import { measureUxBudget } from "../lib/ux-budget/measure";
import { RATCHET_AXES, verdictForRoute, type RouteMeasurement } from "../lib/ux-budget/ratchet";
import { classifyRoute } from "../lib/navigation/route-audience";
import { shellPolicyFor } from "../lib/ux-budget/route-shells";
import { getErrorMessage } from "../lib/shared/get-error-message";
import baseline from "../lib/ux-budget/route-budget-baseline.json";
import { waitForRouteDomToSettle, BROWSER_EVALUATION_RUNTIME, uxSweepAxeOptions } from "./ux-route-sweep";
import { assertProviderQuotaFixtureRuntime, startQuotaFixtureTransport, prepareProviderQuotaFixtures,
  resetProviderQuotaFixture, cleanupProviderQuotaFixtures, type ProviderQuotaFixture } from "./provider-quota-recovery-fixtures";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = resolve(ROOT, "apps/web/test-results/ux-route-sweep/provider-quota-recovery");
const PATH = "/platform/ai/providers", copy = SOURCE_CATALOG.providerAccounts;
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const safeError = (error: unknown) => getErrorMessage(error).replace(/postgres(?:ql)?:\/\/\S+/g, "[PRIVATE_DATABASE_URL]")
  .replace(/https?:\/\/\S+/g, "[PRIVATE_URL]").replace(/[\r\n]/g, " ").slice(0, 1000);
async function measure(page: Page) {
  await page.evaluate(BROWSER_EVALUATION_RUNTIME);
  const html = await page.evaluate(() => {
    const doc = document.cloneNode(true) as Document;
    const live = document.querySelectorAll("body *"), clone = doc.querySelectorAll("body *");
    const drop: Element[] = [];
    for (let i = 0; i < live.length; i++) {
      const style = getComputedStyle(live[i]);
      if ((style.display === "none" || style.visibility === "hidden") && clone[i]) drop.push(clone[i]);
    }
    for (const node of drop) node.remove();
    return doc.body.innerHTML;
  });
  const axe = await new AxeBuilder({ page }).options(uxSweepAxeOptions()).analyze();
  const axeViolations = axe.violations.filter(value => value.impact === "serious" || value.impact === "critical").length;
  return { html, metrics: { ...measureUxBudget(html), axeViolations }, axeViolations, ariaSnapshot: await page.locator("body").ariaSnapshot() };
}

export async function verifyProviderQuotaRecovery() {
  const runtime = assertProviderQuotaFixtureRuntime(process.env);
  check(execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() === runtime.sourceSha,
    "Declared UX source does not match the exact build checkout");
  // No database import, listener or browser launch before the explicit boundary.
  const { prisma } = await import("@dpf/db");
  const browser = await chromium.launch({ headless: true });
  const transport = await startQuotaFixtureTransport(runtime.runKey + "-model");
  let fixture: ProviderQuotaFixture | undefined;
  let completed: Record<string, unknown> | undefined;
  const captures: unknown[] = [], measurements: RouteMeasurement[] = [];
  mkdirSync(OUT, { recursive: true });
  const write = (name: string, value: unknown) => writeFileSync(resolve(OUT, name), JSON.stringify(value, null, 2));
  write("execution.json", { status: "running", ...runtime, syntheticTransport: true, realSubscriptionCapacity: "unrun" });
  try {
    // The ordinary populated-route budget is measured before scenario data alters it.
    const initial = await browser.newContext({ storageState: resolve(ROOT, "e2e/.auth/state.json"), viewport: { width: 1440, height: 1000 } });
    try {
      const page = await initial.newPage(); await page.goto(runtime.origin + PATH, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await waitForRouteDomToSettle(page);
      const observed = await measure(page);
      const policy = shellPolicyFor(PATH, classifyRoute({ routePath: PATH, segments: PATH.split("/").filter(Boolean), dynamicParams: [] }));
      const measurement: RouteMeasurement = { routePath: PATH, shell: policy.shell, audience: policy.audience, exemptChecks: policy.exemptChecks,
        metrics: observed.metrics, axeViolations: observed.axeViolations, ariaSnapshot: observed.ariaSnapshot };
      check(baseline.bootstrapped && baseline.routes[PATH], "Provider route has no frozen budget");
      for (const axis of RATCHET_AXES) check(Number.isFinite(observed.metrics[axis]) && observed.metrics[axis] >= 0, "Missing route measurement: " + axis);
      const verdict = verdictForRoute(measurement, baseline.routes[PATH]);
      check(verdict.regressions.length === 0, "Provider route budget regressed: " + verdict.regressions.join("; "));
      measurements.push(measurement); write("route-budget.json", { ...measurement, verdict, sourceSha: runtime.sourceSha });
    } finally { await initial.close(); }

    fixture = await prepareProviderQuotaFixtures(prisma, transport.baseUrl);
    const quotaBefore = await prisma.providerCapacityStatus.findUniqueOrThrow({ where: { id: fixture.quotaId } });
    const poolsBefore = await prisma.cliPoolStatus.findMany({ orderBy: { id: "asc" } });
    // One context at a time keeps scenario memory bounded independently of the sweep worker count.
    for (const layout of ["desktop", "mobile"] as const) for (const theme of ["light", "dark"] as const) {
      const context = await browser.newContext({ storageState: resolve(ROOT, "e2e/.auth/state.json"),
        viewport: layout === "mobile" ? { width: 320, height: 900 } : { width: 1440, height: 1000 }, colorScheme: theme });
      try {
        const page = await context.newPage(); await page.bringToFront();
        for (const scenario of ["limited", "recovered", "paused", "reauth_required"] as const) {
          await resetProviderQuotaFixture(prisma, fixture, scenario === "paused" || scenario === "reauth_required" ? scenario : "active");
          transport.succeed(scenario === "recovered");
          const countBefore = transport.counts().requests;
          await page.goto(runtime.origin + PATH, { waitUntil: "domcontentloaded", timeout: 60_000 });
          await waitForRouteDomToSettle(page);
          const section = page.getByRole("region", { name: copy.connection, exact: true });
          // The canonical record disclosure is closed and keyboard operable.
          const row = section.locator("tr, [data-testid='mobile-row']").filter({ has: page.getByRole("link", { name: "Recovery verification account", exact: true }) });
          check(!/needs credentials|no credentials are connected yet/i.test(await row.innerText()),
            "The synthetic default credential is unavailable to normal default routing");
          const card = row.locator("article[data-dpf-disclosure-trigger]");
          check(await card.count() === 1, "The fixture account does not have one recovery disclosure");
          const summary = card.getByRole("button", { name: copy.limitDetails, exact: true });
          check(await summary.getAttribute("aria-expanded") === "false", "Recovery opened without an operator request");
          await summary.focus(); await page.keyboard.press("Enter");
          const details = card.getByRole("region", { name: copy.limitDetails, exact: true });
          await details.waitFor({ state: "visible" });
          check(await summary.getAttribute("aria-expanded") === "true", "Keyboard cannot open recovery evidence");
          check((await details.innerText()).includes(copy.resetUnknown), "Unreported reset offers are not visible");
          check(await details.getByRole("link", { name: copy.providerUsage }).getAttribute("href") === "https://chatgpt.com/codex/settings/usage", "Provider usage target changed");
          check(transport.counts().requests === countBefore, "Viewing limits or reset guidance sent inference");
          if (scenario === "limited" || scenario === "recovered") {
            await details.getByLabel(copy.capacityModel, { exact: true }).click();
            await details.getByRole("textbox", { name: copy.capacityModelSearch, exact: true }).fill(fixture.modelId);
            await details.getByRole("option", { name: `Recovery verification model (${fixture.modelId})`, exact: true }).click();
            await details.getByRole("button", { name: copy.capacityCheck, exact: true }).click();
            await details.getByRole(scenario === "recovered" ? "status" : "alert").filter({ hasText: scenario === "recovered" ? "completed a Responses capacity check" : "did not confirm capacity" }).waitFor({ timeout: 45_000 });
            check(transport.counts().requests === countBefore + 1, "Check now did not send exactly one fixed synthetic request");
            await waitForRouteDomToSettle(page);
            const job = await prisma.scheduledJob.findUniqueOrThrow({ where: { jobId: fixture.jobId } });
            check(job.lastStatus === (scenario === "recovered" ? "recovered" : "unconfirmed"), "The served result differs from its durable check history");
            if (scenario === "recovered") check((await details.innerText()).includes(fixture.modelId), "Current proof hides its exact selected model");
          } else {
            check(await details.getByRole("button", { name: copy.capacityCheck, exact: true }).count() === 0, "A restricted account offers inference");
            const before = await prisma.providerCapacityStatus.findMany({ orderBy: { id: "asc" } });
            await details.getByRole("button", { name: copy.capacityStop, exact: true }).click();
            await details.getByRole("status").filter({ hasText: "No provider request was sent" }).waitFor({ timeout: 30_000 });
            check(transport.counts().requests === countBefore, "Stop sent a provider request");
            const job = await prisma.scheduledJob.findUniqueOrThrow({ where: { jobId: fixture.jobId } });
            check(isDeepStrictEqual(job.metadata, { kind: "subscription-quota-recovery", version: 1, modelId: fixture.modelId, hourly: false }), "Stop did not withdraw its existing hourly commission");
            check(isDeepStrictEqual(await prisma.providerCapacityStatus.findMany({ orderBy: { id: "asc" } }), before), "Stop changed capacity evidence");
          }
          check(isDeepStrictEqual(await prisma.providerCapacityStatus.findUnique({ where: { id: fixture.quotaId } }), quotaBefore), "A scenario changed the broad weekly forecast");
          check(isDeepStrictEqual(await prisma.cliPoolStatus.findMany({ orderBy: { id: "asc" } }), poolsBefore), "A scenario changed CLI capacity");
          await page.evaluate(BROWSER_EVALUATION_RUNTIME);
          const geometry = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
            dark: matchMedia("(prefers-color-scheme: dark)").matches, visibility: document.visibilityState }));
          check(geometry.documentWidth <= geometry.width && geometry.dark === (theme === "dark") && geometry.visibility === "visible", "Scenario viewport or theme is incorrect");
          const panelId = await summary.getAttribute("aria-controls");
          check(panelId, "Recovery disclosure has no associated panel");
          const axe = await new AxeBuilder({ page }).include('[id="' + panelId + '"]').options(uxSweepAxeOptions()).analyze();
          const serious = axe.violations.filter(value => value.impact === "serious" || value.impact === "critical");
          const slug = `${scenario}-${layout}-${theme}`, path = resolve(OUT, slug + ".png");
          const accessibility = { violationCount: axe.violations.length, seriousViolationCount: serious.length,
            violations: axe.violations.slice(0, 20).map(value => ({ id: value.id, impact: value.impact, help: value.help, helpUrl: value.helpUrl,
              nodes: value.nodes.slice(0, 20).map(node => ({ target: node.target, failureSummary: node.failureSummary?.slice(0, 2000) })) })) };
          // Known axe findings must survive a later screenshot or aria-capture failure.
          write(slug + ".json", { scenario, layout, theme, status: serious.length ? "failed" : "capture-pending",
            sourceSha: runtime.sourceSha, syntheticTransport: true, realSubscriptionCapacity: "unrun", geometry, accessibility });
          const bytes = await row.screenshot({ path });
          const evidence = { scenario, layout, theme, status: serious.length ? "failed" : "passed", sourceSha: runtime.sourceSha, syntheticTransport: true, realSubscriptionCapacity: "unrun",
            path: slug + ".png", sha256: createHash("sha256").update(bytes).digest("hex"), geometry, ariaSnapshot: await details.ariaSnapshot(),
            accessibility,
            checks: { initiallyClosed: true, keyboard: true, exactModel: true, resetGuidance: true, broadForecastPreserved: true, cliPreserved: true },
            requestCount: transport.counts().requests - countBefore };
          // Keep bounded fixture-only diagnostics even when accessibility fails.
          // A failed capture never enters the completed-case manifest.
          write(slug + ".json", evidence);
          check(serious.length === 0, "Recovery disclosure has serious accessibility findings: " + serious.map(value => value.id).join(", "));
          captures.push(evidence);
        }
      } finally { await context.close(); }
    }
    check(transport.counts().rejected === 0, "The synthetic provider received a request outside the fixed contract");
    completed = { status: "passed", ...runtime, captures, counts: transport.counts(), syntheticTransport: true, realSubscriptionCapacity: "unrun" };
  } catch (error) {
    write("execution.json", { status: "failed", ...runtime, completedCaptures: captures.length, error: safeError(error) });
    throw error;
  } finally {
    try { if (fixture) await cleanupProviderQuotaFixtures(prisma, fixture); }
    finally { await transport.close(); await browser.close(); await prisma.$disconnect(); }
  }
  check(completed, "No complete scenario result was produced");
  write("measured-ux-fit.json", { version: "1", decidedOption: "contextual-recovery-disclosure", scope: { files: ["apps/web/components/platform/ProviderQuotaDetails.tsx"] },
    evidence: { kind: "sweep-measurement", measured: { [PATH]: measurements[0]!.metrics } }, verification: { additionalReviewedFiles: ["apps/web/components/platform/ProviderAccountsOverview.tsx"], sourceSha: runtime.sourceSha, captures: captures.length, realSubscriptionCapacity: "unrun" } });
  write("execution.json", completed);
  console.log("Provider recovery scenarios passed: synthetic transport, preserved quota and CLI records, stop-only controls, keyboard, mobile and both themes. Real subscription capacity remains unrun.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void verifyProviderQuotaRecovery().catch(error => {
    console.error("Provider recovery verification failed: " + safeError(error));
    process.exitCode = 1;
  });
}
