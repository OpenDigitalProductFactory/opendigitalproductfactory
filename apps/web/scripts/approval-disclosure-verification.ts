/** Served approval scenarios in the existing exact-tree GitHub UX runtime.
 * The normal budget sweep runs first. Fixtures never submit a server decision.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { isDeepStrictEqual } from "node:util";
import { RATCHET_AXES, verdictForRoute, type RouteMeasurement } from "../lib/ux-budget/ratchet";
import frozenBudget from "../lib/ux-budget/route-budget-baseline.json";
import { measureUxBudget } from "../lib/ux-budget/measure";
import { waitForRouteDomToSettle, BROWSER_EVALUATION_RUNTIME, uxSweepAxeOptions } from "./ux-route-sweep";

import { approvalFixtureScope, prepareApprovalFixtures, cleanupApprovalFixtures, createApprovalFixtureEnvelope } from "./approval-disclosure-fixtures";
export { APPROVAL_FIXTURE_WORKROOM_SOURCE } from "./approval-disclosure-fixtures";

export function assertApprovalScenarioBudget(measurement: RouteMeasurement, cardAxeViolations: number) {
  const baseline = frozenBudget.routes["/workspace/inbox"];
  check(frozenBudget.bootstrapped && baseline, "Inbox has no frozen scenario budget");
  for (const axis of RATCHET_AXES) {
    const value = axis === "axeViolations" ? measurement.axeViolations : measurement.metrics[axis];
    check(Number.isFinite(value) && value >= 0, "Unavailable scenario measurement: " + axis);
  }
  check(cardAxeViolations === 0, "Approval card has serious or critical accessibility violations");
  const verdict = verdictForRoute(measurement, baseline);
  // Scenario content deliberately changes the hierarchy. The preceding ordinary
  // route sweep enforces its frozen structure; scenarios enforce every numeric
  // ratchet through the same evaluator, without fabricating a matching snapshot.
  check(verdict.regressions.length === 0, "Approval scenario exceeds the frozen Inbox budget: " + verdict.regressions.join("; "));
  return verdict;
}

export function assertApprovalVerificationRuntime(env: Readonly<Record<string, string | undefined>>) {
  const sourceSha = env.GITHUB_SHA ?? "";
  const runId = env.GITHUB_RUN_ID ?? "";
  const attempt = env.GITHUB_RUN_ATTEMPT ?? "1";
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" || env.DPF_APPROVAL_SCENARIO_CI !== "1"
    || !/^\d+$/.test(runId) || !/^\d+$/.test(attempt) || !/^[a-f0-9]{40}$/.test(sourceSha)) {
    throw new Error("Approval fixtures require the explicitly opted-in GitHub UX runtime");
  }
  const db = new URL(env.DATABASE_URL ?? "");
  const target = new URL(env.UX_SWEEP_BASE_URL ?? "");
  if (db.protocol !== "postgresql:" || db.hostname !== "localhost" || db.port !== "5432"
    || db.pathname !== "/dpf" || db.username !== "dpf" || db.password !== "ci_test_password"
    || db.search || db.hash
    || target.origin !== "http://localhost:3000" || target.pathname !== "/" || target.search
    || target.hash || target.username || target.password) {
    throw new Error("Approval fixtures refuse any target outside the declared isolated CI services");
  }
  return { origin: target.origin, sourceSha, runKey: "ux-approval-" + runId + "-" + attempt };
}

type Case = { key: string; tool: string; args: Record<string, unknown>; expired?: boolean; primaryTitle?: string };
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = resolve(ROOT, "apps/web/test-results/ux-route-sweep/approval-scenarios");
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }

export async function verifyApprovalDisclosure() {
  const runtime = assertApprovalVerificationRuntime(process.env);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  check(git("rev-parse", "HEAD") === runtime.sourceSha, "CI source identity differs from its declared build");
  // No database import, browser launch or fixture access before the boundary above.
  const { prisma } = await import("@dpf/db");
  const browser = await chromium.launch({ headless: true });
  const contexts: Array<{ context: BrowserContext; page: Page; layout: "desktop" | "mobile"; theme: "light" | "dark" }> = [];
  let unexpectedDecisionPosts = 0;
  const roomId = "WC-" + runtime.runKey.toUpperCase();
  const threadId = runtime.runKey + "-presentation-only";
  const prefix = runtime.runKey + "-";
  let userId = "";
  let principalId = "";
  let fixturesOwned = false;
  const captures: unknown[] = [];
  let execution: Record<string, unknown> | undefined;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, "execution.json"), JSON.stringify({ status: "running", sourceSha: runtime.sourceSha, runKey: runtime.runKey }));

  async function removeEnvelopes() {
    if (fixturesOwned) await prisma.coworkerActionEnvelope.deleteMany({
      where: { id: { startsWith: prefix }, threadId, delegatingUserId: userId },
    });
  }

  try {
    for (const layout of ["desktop", "mobile"] as const) for (const theme of ["light", "dark"] as const) {
      const context = await browser.newContext({
        storageState: resolve(ROOT, "e2e/.auth/state.json"),
        viewport: layout === "mobile" ? { width: 320, height: 900 } : { width: 1440, height: 1000 },
        colorScheme: theme,
      });
      const page = await context.newPage();
      await context.route(runtime.origin + "/api/agent/envelope/**", route => {
        if (route.request().method() === "POST") { unexpectedDecisionPosts++; return route.abort("failed"); }
        return route.continue();
      });
      contexts.push({ context, page, layout, theme });
    }
    const response = await contexts[0]!.context.request.get(runtime.origin + "/api/auth/session");
    const session = await response.json();
    check(response.ok() && typeof session?.user?.id === "string", "Existing authenticated CI session is unavailable");
    userId = session.user.id;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    check(user.email === session.user.email, "Authenticated CI user does not match fixture ownership");
    const alias = await prisma.principalAlias.findFirstOrThrow({
      where: { aliasType: "user", aliasValue: userId, issuer: "" }, select: { principalId: true },
    });
    principalId = alias.principalId;
    const scope = approvalFixtureScope(runtime.runKey, userId, principalId);
    await prepareApprovalFixtures(prisma, scope);
    fixturesOwned = true;
    const long = "The release candidate was not supplied. " + "Internal verification detail. ".repeat(40);
    const cases: Case[] = [
      { key: "app-update", tool: "request_self_upgrade", args: { reason: "Ready release batch" },
        primaryTitle: "Request an update for this app?" },
      { key: "merge-work", tool: "merge_backlog_items", args: { canonicalItemId: "BI-FIXTURE-KEEP", duplicateItemId: "BI-FIXTURE-DUP" },
        primaryTitle: "Combine these duplicate work requests?" },
      { key: "release-reservation", tool: "release_nonprod_environment_lease", args: { leaseId: "NPEL-FIXTURE" },
        primaryTitle: "Release this shared test reservation?" },
      { key: "report", tool: "record_workroom_evidence", args: { capsuleId: roomId, kind: "assurance-finding",
        outcome: "blocked", summary: long, stageKey: "report", commandId: "fixture-internal-command" } },
      { key: "handover", tool: "reassign_workroom_executor", args: { capsuleId: roomId,
        toExecutorKind: "codex-desktop", executorRef: "fixture-session",
        handoffManifest: { nextAction: "Review supplier commitments and report missing amounts." } } },
      { key: "grant", tool: "manage_coworker_tool_grant", args: { coworker: "Build Lead", grantKey: "admin_write", action: "grant" } },
      { key: "revoke", tool: "manage_coworker_tool_grant", args: { coworker: "Build Lead", grantKey: "admin_write", action: "revoke" } },
      { key: "unknown", tool: "unsupported_internal_operation", args: { routingId: "fixture-internal-routing",
        payment: { amount: 1250, currency: "USD", recurrence: "monthly", recipient: { email: "supplier@example.test" } },
        permission: { grant: "admin_write" }, deadline: "2026-11-01", emptyRecipients: [],
        body: "x".repeat(900) + "<script>unsafe()</script>" } },
      { key: "irreversible", tool: "apply_platform_update", args: { path: "/reports/closing.csv",
        action: "delete", routingId: "fixture-internal-routing" } },
      { key: "missing", tool: "record_workroom_evidence", args: {} },
      { key: "research", tool: "record_initiative_evidence",
        args: { itemId: "BI-038AA4BC", gate: "research", decision: "pass", findings: [] } },
      { key: "expired", tool: "record_workroom_evidence", expired: true,
        args: { capsuleId: roomId, kind: "assurance-finding", outcome: "blocked", summary: long, stageKey: "report" } },
    ];
    async function addEnvelope(value: Case, suffix = value.key) {
      return createApprovalFixtureEnvelope(prisma, scope, value, suffix);
    }

    for (const value of cases) {
      await removeEnvelopes();
      const id = await addEnvelope(value);
      for (const target of contexts) {
        const { page, layout, theme } = target;
        await page.bringToFront();
        await page.goto(runtime.origin + "/workspace/inbox?approval=" + encodeURIComponent(id),
          { waitUntil: "domcontentloaded", timeout: 60_000 });
        await waitForRouteDomToSettle(page);
        const card = page.locator('[id="owner-decision-coworker-envelope-' + id + '"]');
        await card.waitFor({ state: "visible" });
        check(await card.locator("details").evaluateAll(nodes => nodes.every(node => !(node as HTMLDetailsElement).open)),
          value.key + ": technical detail opened without a request");
        const complete = card.locator("pre");
        check(await complete.count() === 1 && isDeepStrictEqual(JSON.parse(await complete.textContent() ?? "null"), value.args),
          value.key + ": complete input differs from the original proposal");
        check(await card.locator("script").count() === 0, "Proposal content became executable markup");
        const text = await card.innerText();
        if (value.primaryTitle) {
          check(await card.getByRole("heading", { name: value.primaryTitle, exact: true }).count() === 1,
            value.key + ": operation missing from the initial question");
          check(text.includes("Keep this on hold until its effect is clear."), value.key + ": unresolved-effect recommendation lost");
          check(!text.includes("BI-FIXTURE-KEEP") && !text.includes("BI-FIXTURE-DUP") && !text.includes("NPEL-FIXTURE"),
            value.key + ": technical identity leaked into the initial question");
          if (value.key === "app-update") check(text.includes("This app") && text.includes("approval does not mean it is installed"),
            "Update request presented as installed");
        }
        if (value.key === "report") check(!text.includes("Internal verification detail.")
          && !text.includes(roomId) && !text.includes("fixture-internal-command"), "Internal evidence leaked into the default summary");
        if (value.key === "unknown") for (const fact of ["1250", "USD", "monthly", "supplier@example.test", "admin_write", "2026-11-01"]) {
          check(text.includes(fact), "Material fact hidden: " + fact);
        }
        if (value.key === "grant" || value.key === "revoke") check(text.includes("admin_write")
          && text.includes("Build Lead") && text.includes(value.key), "Permission scope or direction hidden");
        if (value.key === "missing") check(text.includes("Keep this on hold until its effect is clear."),
          "An empty request lost its unresolved-effect warning");
        if (value.key === "irreversible") check(text.includes("/reports/closing.csv") && text.includes("delete"), "Deletion target hidden");
        if (value.expired) check(await card.getByRole("button", { name: "Ask again", exact: true }).count() === 1
          && await card.getByRole("button", { name: "Authorize", exact: true }).count() === 0, "Expired request offers authorization");
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
        const geometry = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
          dark: matchMedia("(prefers-color-scheme: dark)").matches, visibility: document.visibilityState }));
        check(geometry.documentWidth <= geometry.width && geometry.dark === (theme === "dark")
          && geometry.visibility === "visible", "Viewport, theme or visibility does not match the declared capture");
        const axe = await new AxeBuilder({ page }).options(uxSweepAxeOptions()).analyze();
        const cardAxe = await new AxeBuilder({ page }).include('[id="owner-decision-coworker-envelope-' + id + '"]')
          .options(uxSweepAxeOptions()).analyze();
        const cardAxeViolations = cardAxe.violations.filter(v => v.impact === "critical" || v.impact === "serious").length;
        const ariaSnapshot = await page.locator("body").ariaSnapshot();
        const slug = value.key + "-" + layout + "-" + theme;
        await card.screenshot({ path: resolve(OUT, slug + ".png") });
        const result = { case: value.key, layout, theme, sourceSha: runtime.sourceSha,
          metrics: { ...measureUxBudget(html), axeViolations: axe.violations.filter(v => v.impact === "critical" || v.impact === "serious").length },
          cardAxeViolations,
          cardAxeFindings: cardAxe.violations.map(finding => ({ id: finding.id, impact: finding.impact,
            description: finding.description, helpUrl: finding.helpUrl,
            nodes: finding.nodes.map(node => ({ target: node.target, html: node.html, failureSummary: node.failureSummary })) })),
          ariaSnapshot,
          geometry, checks: { completeOriginalInput: true, materialFactsVisible: true, technicalInitiallyClosed: true },
          domSha256: createHash("sha256").update(html).digest("hex") };
        writeFileSync(resolve(OUT, slug + ".json"), JSON.stringify({ ...result, status: "measured" }, null, 2));
        const verdict = assertApprovalScenarioBudget({ routePath: "/workspace/inbox", shell: "detail", audience: "worker",
          exemptChecks: ["next-action-marker", "lead-band"], metrics: result.metrics,
          axeViolations: result.metrics.axeViolations, ariaSnapshot }, cardAxeViolations);
        const accepted = { ...result, status: "passed", numericBudgetVerdict: verdict };
        captures.push(accepted);
        writeFileSync(resolve(OUT, slug + ".json"), JSON.stringify(accepted, null, 2));
        if (layout === "mobile" && theme === "dark" && ["report", "unknown"].includes(value.key)) {
          const summary = card.getByText("Technical evidence", { exact: true });
          await summary.focus(); await page.keyboard.press("Enter");
          check(await summary.locator("..").evaluate(node => (node as HTMLDetailsElement).open), "Keyboard cannot open technical evidence");
          const full = complete.locator("..").locator(":scope > summary");
          await full.focus(); await page.keyboard.press("Enter");
          check(await complete.isVisible(), "Full input is not keyboard-readable");
          await card.screenshot({ path: resolve(OUT, slug + "-keyboard.png") });
        }
      }
    }

    // A real served fourth-card fault injection. No request reaches a server decision endpoint.
    await removeEnvelopes();
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(await addEnvelope(cases[0]!, "retained-" + i));
    const page: Page = contexts[0]!.page;
    await page.bringToFront();
    await page.goto(runtime.origin + "/workspace/inbox", { waitUntil: "domcontentloaded" });
    await waitForRouteDomToSettle(page);
    let hiddenId: string | undefined;
    for (const id of ids) if (!await page.locator('[id="owner-decision-coworker-envelope-' + id + '"]').isVisible()) { hiddenId = id; break; }
    check(hiddenId, "Four pending cards did not provide a deferred decision");
    const card = page.locator('[id="owner-decision-coworker-envelope-' + hiddenId + '"]');
    check(await card.count() === 1, "Deferred stateful card was unmounted");
    const list = card.locator("xpath=ancestor::div[@data-dpf-disclosure-trigger][1]");
    const expand = () => list.getByRole("button", { name: /^Show \d+ more$/ }).click();
    const fold = () => list.getByRole("button", { name: "Show fewer", exact: true }).click();
    await expand();
    let release!: () => void;
    const held = new Promise<void>(resolveHeld => { release = resolveHeld; });
    let interceptedPosts = 0;
    await page.route(runtime.origin + "/api/agent/envelope/" + hiddenId + "/approve", async route => {
      interceptedPosts++; await held; await route.abort("failed").catch(() => {});
    });
    await page.route(runtime.origin + "/api/agent/envelope/" + hiddenId, route => route.abort("failed").catch(() => {}));
    try {
    await card.getByRole("button", { name: "Authorize", exact: true }).click();
    await card.getByRole("status").waitFor({ state: "visible" });
    await fold(); await expand();
    check((await card.getByRole("status").textContent())?.includes("Saving your decision")
      && !await card.getByRole("button", { name: "Authorize", exact: true }).isEnabled(), "Pending lock reset on collapse");
    release();
    await card.getByRole("alert").filter({ hasText: "Do not approve again" }).waitFor({ state: "visible" });
    await fold(); await expand();
    check(await card.getByRole("button", { name: "Authorize", exact: true }).count() === 0
      && (await card.innerText()).includes("Do not approve again") && interceptedPosts === 1, "Unknown result lock reset or resubmitted");
    await card.screenshot({ path: resolve(OUT, "retained-unknown-result.png") });
    } finally { release(); }
    check(unexpectedDecisionPosts === 0, "An unexpected server decision was attempted during presentation checks");
    check(git("rev-parse", "HEAD") === runtime.sourceSha, "CI source changed during scenarios");
    check(captures.length === cases.length * contexts.length, "Scenario captures do not cover every case, viewport and theme");
    execution = { status: "passed", sourceSha: runtime.sourceSha, runKey: runtime.runKey,
      cases: cases.length, closedCaptures: captures.length, keyboardCaptures: 2, stateRetentionFaultInjection: "passed",
      interceptedDecisionPosts: interceptedPosts, serverAuthorizations: 0, fixtureCleanup: "completed", captures };
  } finally {
    try {
      await removeEnvelopes();
      if (fixturesOwned) {
        await cleanupApprovalFixtures(prisma, approvalFixtureScope(runtime.runKey, userId, principalId));
      }
    } finally {
      try { await browser.close(); } finally { await prisma.$disconnect(); }
    }
  }
  check(execution, "No complete scenario result was produced");
  // A cleanup failure cannot leave a passing receipt or success message.
  writeFileSync(resolve(OUT, "execution.json"), JSON.stringify(execution, null, 2));
  console.log(`Approval scenarios passed: ${execution.cases} cases, ${execution.closedCaptures} viewport/theme captures, keyboard and retained-state checks; no server authorization.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void verifyApprovalDisclosure().catch(error => {
    const message = String(error instanceof Error ? error.message : error)
      .replace(/postgres(?:ql)?:\/\/\S+/g, "[PRIVATE_DATABASE_URL]").replace(/https?:\/\/\S+/g, "[PRIVATE_URL]")
      .replace(/[\r\n]/g, " ").slice(0, 1000);
    console.error("Approval scenario verification failed: " + message);
    process.exitCode = 1;
  });
}
