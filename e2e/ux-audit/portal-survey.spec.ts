// First-mission portal-shell survey runner (EP-UX-AUDITOR Phase 2, BI-C3768478).
//
// Spec: docs/superpowers/specs/2026-05-16-ux-auditor-coworker-design.md (Goal 7)
// Plan: docs/superpowers/plans/2026-07-16-ux-auditor-portal-survey.md (P2)
//
// This is the seam where the Phase-1 orchestrator meets the live runtime:
//   page lens       -> the evaluate_page MCP tool (browser-use + axe + visual load)
//   behavioral lens -> a real coworker, driven with real keystrokes, judged by the
//                      pure button-decision lens
// and the aggregated UxAuditReport is attached as a run artifact with each finding
// filed through record_functional_failure_evidence.
//
// It runs ONLY under `--project=ux-audit` — a full survey drives live inference on
// every shell route, so it must never be swept up in an ordinary e2e run.
//
//   pnpm test:e2e -- --project=ux-audit
//   DPF_RECORD_FUNCTIONAL_FAILURES=1 pnpm test:e2e -- --project=ux-audit   # + file findings

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "../fixtures/dpf-test";
import { attachFunctionalFailureEvidence } from "../fixtures/evidence";
import {
  askCoworker,
  clearCoworker,
  observeCoworkerDecision,
  waitForCoworkerIdle,
} from "../helpers/coworker";
import {
  aggregateReport,
  planSurvey,
  runSurvey,
  type LensSpec,
  type RouteManifest,
  type RouteSurveyResult,
  type UxAuditReport,
  type UxFinding,
} from "../../apps/web/lib/ux-audit/portal-survey";
import {
  PORTAL_SHELL_LENSES,
  isPortalShellCoworkerRoute,
  portalShellRoutes,
  portalShellTargets,
} from "../../apps/web/lib/ux-audit/portal-shell";
import {
  evaluateButtonDecision,
  expectedCarrier,
} from "../../apps/web/lib/ux-audit/button-decision-lens";
import { createPageLensEvaluator } from "../../apps/web/lib/ux-audit/page-lens";
import { resolveDpfMcpConfig } from "../../apps/web/lib/ux-audit/dpf-mcp-client";
import rawRouteManifest from "../../apps/web/lib/ea/route-manifest.json";

const routeManifest = rawRouteManifest as unknown as RouteManifest;

// Two origins, deliberately. Playwright drives the portal from the HOST, so it
// uses localhost. `evaluate_page` runs inside the browser-use container, where
// localhost is the sidecar itself and the portal is reachable only by its compose
// service name — pointing the page lens at localhost yields a navigation failure,
// not a clean page. Verified on-machine: from dpf-browser-use-1, localhost:3000
// fails and portal:3000 answers.
const HOST_URL = process.env.DPF_PORTAL_URL ?? "http://localhost:3000";
const BROWSER_USE_PORTAL_URL =
  process.env.DPF_PORTAL_INTERNAL_URL ?? "http://portal:3000";

/** How long one route's coworker may take to finish its turn. */
const COWORKER_IDLE_TIMEOUT_MS = Number(process.env.DPF_UX_AUDIT_COWORKER_TIMEOUT_MS ?? 180_000);

/** Page-lens budget. Kept tight so a dead browser sidecar fails fast instead of
 *  consuming the whole survey window on retries. */
const PAGE_LENS_TIMEOUT_MS = Number(process.env.DPF_UX_AUDIT_PAGE_TIMEOUT_MS ?? 90_000);

/**
 * The prompt that drives a coworker to a next-step decision. It asks for a
 * recommendation and an explicit two-option closeout — the shape the interaction
 * contract (lib/tak/coworker-interaction-contract.ts) tells the coworker to carry
 * as a sentinel, and the shape the prose fallback recovers when it does not.
 * Deliberately route-agnostic so the same lens runs on every shell section.
 */
const DECISION_PROMPT =
  "Look at this page and tell me, in two sentences, the single highest-value next step I could take here. " +
  "Then close by asking whether I should start on your recommendation, or review the underlying detail first.";

// A whole survey drives live inference on every shell route.
test.describe.configure({ mode: "serial", timeout: 40 * 60_000 });

test("portal-shell UX survey — page lens + coworker button-decision lens", async ({
  page,
}, testInfo) => {
  const targets = portalShellTargets();
  const mcpConfig = await resolveDpfMcpConfig();

  test.skip(
    mcpConfig === null,
    "No DPF MCP config (set DPF_MCP_URL + DPF_MCP_BEARER_TOKEN, or provide .mcp.json) — the page lens calls evaluate_page over MCP.",
  );

  const lensById = new Map<string, LensSpec>(PORTAL_SHELL_LENSES.map((lens) => [lens.id, lens]));
  // Scope override: a full survey is long, and driving live inference on every
  // shell route is exactly the kind of job an outer process budget cuts short.
  // `DPF_UX_AUDIT_ROUTES=/workspace,/knowledge` runs a slice.
  // Accept `workspace` as well as `/workspace`: a POSIX-looking value passed
  // through Git Bash on Windows gets rewritten to a native path by MSYS path
  // conversion, so tolerate a missing leading slash rather than silently
  // planning zero routes.
  const routeFilter = (process.env.DPF_UX_AUDIT_ROUTES ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => (r.startsWith("/") ? r : `/${r}`));
  const surveyRoutes = routeFilter.length > 0 ? routeFilter : portalShellRoutes();

  const plan = planSurvey(routeManifest, {
    lenses: PORTAL_SHELL_LENSES,
    include: (entry) => surveyRoutes.includes(entry.routePath),
    coworkerRoute: isPortalShellCoworkerRoute,
  });

  // eslint-disable-next-line no-console
  console.log(
    `[ux-audit] planning ${plan.entries.length} route(s) from ${surveyRoutes.length} target(s): ` +
      `${surveyRoutes.join(",")} -> ${plan.entries.map((e) => e.route).join(",") || "(none)"}`,
  );

  // What the behavioral lens actually saw, kept alongside the report so a finding
  // can be read back to the transcript that produced it.
  const transcripts: Array<{
    route: string;
    reply: string;
    buttons: Array<{ label: string; recommended: boolean }>;
    expectedCarrier: string;
  }> = [];

  const evaluators = {
      page: createPageLensEvaluator({
        config: mcpConfig!,
        baseUrl: BROWSER_USE_PORTAL_URL,
        timeoutMs: PAGE_LENS_TIMEOUT_MS,
      }),
      behavioral: async (route: string, lens: LensSpec): Promise<UxFinding[]> => {
        if (lens.id !== "coworker-button-decision") return [];

        await page.goto(`${HOST_URL}${route}`);
        // A previous route's transcript would let a stale decision block satisfy
        // the lens — start every route from an empty conversation.
        await clearCoworker(page);
        await askCoworker(page, DECISION_PROMPT);

        // askCoworker gives up after 45s; a tool-using coworker routinely runs
        // longer. Without this the observation scrapes the "is still working"
        // placeholder and the lens judges a spinner.
        const settled = await waitForCoworkerIdle(page, COWORKER_IDLE_TIMEOUT_MS);
        if (!settled) {
          return [
            {
              severity: "critical",
              category: "semantic-html",
              element: '[data-agent-panel="true"]',
              issue: `The coworker had not finished its turn after ${Math.round(
                COWORKER_IDLE_TIMEOUT_MS / 1000,
              )}s, so the button-decision lens could not observe a closeout. This is a NOT-RUN, not a pass.`,
              recommendation:
                "Investigate this route's coworker latency (model routing, tool calls), or raise the lens budget if the wait is legitimate.",
            },
          ];
        }

        const observed = await observeCoworkerDecision(page);
        transcripts.push({
          route,
          reply: observed.reply,
          buttons: observed.buttons,
          expectedCarrier: expectedCarrier(observed.reply),
        });

        return evaluateButtonDecision({ route, ...observed });
      },
  };

  // Survey one route at a time and persist after EACH, rather than aggregating
  // only at the end. A full survey runs for tens of minutes on live inference;
  // when an outer budget cuts the process short, an all-at-the-end write loses
  // every route that DID complete. Partial evidence beats none.
  const reportPath = join(testInfo.outputDir, "ux-audit-report.json");
  await mkdir(dirname(reportPath), { recursive: true });

  const results: RouteSurveyResult[] = [];
  let report: UxAuditReport = aggregateReport(results);

  for (const entry of plan.entries) {
    const partial = await runSurvey({ entries: [entry], skipped: [] }, evaluators, lensById);
    results.push(...partial.routes);
    report = aggregateReport(results);

    await writeFile(
      reportPath,
      JSON.stringify(
        {
          epic: "EP-UX-AUDITOR",
          backlogItemId: "BI-C3768478",
          complete: results.length === plan.entries.length,
          surveyedSoFar: results.length,
          plannedRoutes: plan.entries.length,
          hostUrl: HOST_URL,
          browserUseUrl: BROWSER_USE_PORTAL_URL,
          sections: targets,
          plan,
          report,
          transcripts,
        },
        null,
        2,
      ),
      "utf8",
    );
    // eslint-disable-next-line no-console
    console.log(
      `[ux-audit] ${entry.route}: verdict=${results[results.length - 1]!.verdict} ` +
        `findings=${results[results.length - 1]!.findings.length} ` +
        `(${results.length}/${plan.entries.length})`,
    );
  }

  testInfo.attachments.push({
    name: "ux-audit-report",
    contentType: "application/json",
    path: reportPath,
  });

  // File every finding as functional-failure evidence. Grouped per route+category
  // (spec §5.8: group similar findings, never one item per element) so the backlog
  // gets improvement work, not noise.
  for (const routeResult of report.routes) {
    const byCategory = new Map<string, typeof routeResult.findings>();
    for (const finding of routeResult.findings) {
      const key = `${finding.lens ?? "page"}:${finding.category}`;
      const bucket = byCategory.get(key) ?? [];
      bucket.push(finding);
      byCategory.set(key, bucket);
    }

    for (const [key, findings] of byCategory) {
      const worst = findings.some((f) => f.severity === "critical")
        ? "critical"
        : findings.some((f) => f.severity === "important")
          ? "important"
          : "minor";

      await attachFunctionalFailureEvidence(testInfo, {
        testId: `ux-audit-${routeResult.route.replace(/\W+/g, "-")}-${key.replace(/\W+/g, "-")}`,
        suite: "ux-audit",
        route: routeResult.route,
        expected: `No ${key} findings on ${routeResult.route} (UX auditor portal-shell survey).`,
        actual: [
          `${findings.length} ${worst} finding(s):`,
          ...findings.map((f) => `- [${f.severity}] ${f.element}: ${f.issue} → ${f.recommendation}`),
        ].join("\n"),
        screenshotPath: null,
        tracePath: null,
        userRole: "admin",
        agentId: "AGT-903",
        routeContext: routeResult.route,
        reproCommand: "pnpm test:e2e -- --project=ux-audit",
        backlogItemId: "BI-C3768478",
      });
    }
  }

  // The survey itself is the deliverable — it reports, it does not gate. What
  // MUST hold is that it actually ran: a report with zero evaluated routes is a
  // NOT-RUN masquerading as a clean portal.
  test.expect(report.evaluatedRouteCount, "the survey must have evaluated at least one route")
    .toBeGreaterThan(0);
  test.expect(report.routes.length).toBe(targets.length);

  // eslint-disable-next-line no-console
  console.log(
    `[ux-audit] portal verdict=${report.portalVerdict} routes=${report.routeCount} ` +
      `evaluated=${report.evaluatedRouteCount} ` +
      `findings=${report.findingCounts.critical}c/${report.findingCounts.important}i/${report.findingCounts.minor}m ` +
      `report=${reportPath}`,
  );
});
