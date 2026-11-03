import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildBacklogItemData } from "@/lib/operate/process-observer-triage";
import { checkForSpike, triageIssueReports } from "@/lib/operate/issue-report-triage";
import { createTechDebtItem } from "@/lib/explore/decomposition";
import { toBacklogIngestInput } from "@/lib/ecosystem/inbound-issue-triage";
import { fileCapabilityReverification } from "@/lib/agent-toolchain/client-capability-drift";
import { sustainedBottleneckIntake } from "@/lib/work-management/flow-review-escalation";
import { efficiencyFindingOutcome } from "@/lib/operate/mcp-call-efficiency/aiops-handoff";
import { collaborationFindingOutcome } from "@/lib/operate/a2a-collaboration-health/aiops-handoff";
import { correctiveFailureOutcome } from "@/lib/backlog/capture-corrective-bi";

import {
  issueReportOutcome,
  outcomeUnlessStated,
  recurringFailureOutcome,
  statesOutcome,
  techDebtOutcome,
} from "./intake-outcome";

// BI-458CCA8D: every route that files backlog work records the outcome that
// defines done — not only the human intake forms PR #6637 covered, but the
// triage projections, decomposition and automated detectors too. Detectors
// derive their outcome deterministically from what they detected.

const report = {
  id: "r1",
  reportId: "PIR-ABC12",
  type: "runtime_error",
  severity: "medium",
  title: "Save button does nothing",
  description: "Clicking save on the invoice form has no effect.",
  routeContext: "/finance/invoices",
  errorStack: null,
  source: "manual",
};

describe("derived outcomes", () => {
  it("are deterministic text naming what stops happening", () => {
    expect(issueReportOutcome(report)).toBe('"Save button does nothing" no longer happens on /finance/invoices (PIR-ABC12).');
    expect(issueReportOutcome({ ...report, routeContext: null })).toBe('"Save button does nothing" no longer happens (PIR-ABC12).');
    expect(techDebtOutcome("Inline SQL in report export")).toContain('"Inline SQL in report export" is replaced');
    expect(recurringFailureOutcome("The self-upgrade failure \"x\"")).toMatch(/stops recurring/);
  });

  it("keep an outcome the filer already wrote", () => {
    expect(outcomeUnlessStated("## Outcome\nPeers can export.", "derived")).toBeNull();
    expect(outcomeUnlessStated("Just a request.", "derived")).toBe("derived");
  });
});

describe("issue-report triage", () => {
  const deps = (created: Array<{ body: string | null }>, overrides: Record<string, unknown> = {}) => ({
    getOpenReports: async () => [report],
    getExistingTitles: async () => [] as string[],
    createBacklogItem: async (data: { body: string | null }) => { created.push(data); },
    incrementOccurrence: vi.fn(),
    acknowledgeReport: vi.fn(),
    resolveProductId: async () => "prod-1",
    resolveTaxonomyNodeId: async () => "tax-1",
    ...overrides,
  });

  it("files the projected report with its outcome first", async () => {
    const created: Array<{ body: string | null }> = [];
    await triageIssueReports(deps(created));
    expect(created).toHaveLength(1);
    expect(created[0]!.body).toMatch(/^## Outcome\n"Save button does nothing" no longer happens on \/finance\/invoices \(PIR-ABC12\)\./);
    expect(created[0]!.body).toContain("Source report: PIR-ABC12");
  });

  it("keeps the outcome first when the triage model adds a root cause", async () => {
    const created: Array<{ body: string | null }> = [];
    const callLlm = vi.fn(async () => ({
      content: JSON.stringify({ severity: "high", suggestedTitle: "Invoice save is a no-op", rootCause: "Handler not bound", duplicateOf: null, taxonomyPath: null }),
    }));
    await triageIssueReports(deps(created, { callLlm }));
    expect(created[0]!.body).toMatch(/^## Outcome\n/);
    expect(created[0]!.body).toContain("Root cause: Handler not bound");
  });

  it("files a crash-boundary item with an outcome", async () => {
    const created: Array<{ body: string | null }> = [];
    await triageIssueReports(deps(created, {
      getOpenReports: async () => [{ ...report, source: "crash_boundary", errorDigest: "123" }],
    }));
    expect(statesOutcome(created[0]!.body)).toBe(true);
  });

  it("files a report spike with an outcome", async () => {
    const created: Array<{ body: string | null }> = [];
    await checkForSpike({
      countReportsInWindow: async () => 15,
      countReportsInRange: async () => 24,
      getExistingTitles: async () => [],
      createBacklogItem: async (data) => { created.push(data); },
    });
    expect(created[0]!.body).toMatch(/^## Outcome\nIssue reports fall back to their usual rate/);
  });
});

describe("process observer", () => {
  it("files a finding with an outcome", () => {
    const data = buildBacklogItemData(
      { title: "Agent loops on save", description: "d", severity: "medium", category: "tool_failure", sourceMessageIds: ["m1"] } as never,
      null,
      null,
    );
    expect(data.body).toMatch(/^## Outcome\n"Agent loops on save" stops happening/);
  });
});

describe("register_tech_debt", () => {
  it("records the filer's outcome, and how we'll know when given", () => {
    const item = createTechDebtItem({ title: "T", description: "D", severity: "low", outcome: "Exports use the query builder.", howWeKnow: "No raw SQL in exports." });
    expect(item.body).toBe("## Outcome\nExports use the query builder.\n\n## How we'll know\nNo raw SQL in exports.\n\n[Tech Debt] D\nSeverity: low");
  });

  it("derives one when the filer states none", () => {
    const item = createTechDebtItem({ title: "Inline SQL", description: "D", severity: "low" });
    expect(item.body).toMatch(/^## Outcome\nThe shortcut "Inline SQL" is replaced/);
  });
});

describe("ecosystem inbound triage", () => {
  const item = { sourceKind: "peer-demand" as const, sourceId: "M-1", title: "Bulk export", summary: "Peers want bulk export." };

  it("derives the requester's outcome when they stated none", () => {
    expect(statesOutcome(toBacklogIngestInput(item as never).body)).toBe(false);
    expect(toBacklogIngestInput(item as never).outcome).toMatch(/Bulk export/);
  });

  it("keeps the requester's own outcome", () => {
    const input = toBacklogIngestInput({ ...item, summary: "## Outcome\nPeers export in bulk." } as never);
    expect(input.outcome ?? null).toBeNull();
  });
});

describe("client capability drift", () => {
  it("files the re-verification with an outcome", async () => {
    const ingest = vi.fn(async () => ({ id: "x", itemId: "BI-X", created: true }) as never);
    await fileCapabilityReverification({ clientKind: "claude-code", clientVersion: "3.1.0", verifiedVersion: "3.0.0" }, { ingest });
    expect((ingest.mock.calls[0] as unknown as [{ outcome: string }])[0].outcome).toMatch(/claude-code 3\.1\.0/);
  });
});

describe("automated detectors", () => {
  it("name the waste that stops for each MCP efficiency finding kind", () => {
    expect(efficiencyFindingOutcome({ kind: "retry_storm", toolName: "create_x" })).toMatch(/^create_x calls stop retry-storming/);
    expect(efficiencyFindingOutcome({ kind: "high_failure", toolName: "get_y" })).toMatch(/^get_y calls stop failing/);
    expect(efficiencyFindingOutcome({ kind: "thrash", toolName: "z" })).toMatch(/stop thrashing/);
    expect(efficiencyFindingOutcome({ kind: "high_volume", toolName: "z" })).toMatch(/volume drops/);
  });

  it("name what stops happening for each A2A health finding kind", () => {
    for (const kind of ["failed_edge", "blocked_edge", "stuck_active", "orphan_lineage", "pair_failure_rate"] as const) {
      expect(collaborationFindingOutcome({ kind, edgeKind: "a2a-handoff" })).toContain("a2a-handoff");
    }
  });

  it("state that a captured build or upgrade failure stops recurring", () => {
    expect(correctiveFailureOutcome("build-failure", "tsc fails")).toMatch(/^The Build Studio build failure "tsc fails" stops recurring/);
    expect(correctiveFailureOutcome("self-upgrade-failure", "x")).toMatch(/^The self-upgrade failure/);
    expect(correctiveFailureOutcome("data-growth", "AuditLog grows")).toMatch(/back within its expected bounds/);
  });
});

describe("flow-review escalation", () => {
  it("files a sustained bottleneck with an outcome", () => {
    const intake = sustainedBottleneckIntake(
      { shapeRef: "s@1.0.0", stageKey: "repair", cause: "awaiting-person", queueKey: "wr:s@1.0.0:repair", reviews: ["2026-10-19", "2026-10-26"], roomsHeld: 4, waitMs: null } as never,
      { shapeTitle: "Break-fix", stageTitle: "Repair", accountablePrincipalRef: "p" },
    );
    expect(intake.outcome).toMatch(/Work stops piling up at "Repair" in Break-fix/);
  });
});

// ─── Guard: a new filing route must state an outcome ─────────────────────────
// Every non-test source file in apps/web that files a backlog item — through
// the shared front door or a direct create — must pass an outcome (or compose
// one). A file that legitimately does not is listed here with the reason.

const WEB_ROOT = resolve(__dirname, "../..");
const FILING_CALL = /\b(?:ingestBacklogItem|[bB]acklogItem\.(?:create|upsert|createMany))\s*\(/;
const STATES_OUTCOME = /\boutcome\s*[:}]|composeIntakeBody\s*\(/;

const EXEMPT: Record<string, string> = {
  // The front door itself composes the body from the caller's outcome.
  "lib/operate/backlog-ingest.ts": "the shared front door; composes the caller's outcome",
  // Mirrors a peer installation's item verbatim — its outcome travels in its body.
  "lib/federation/work-sync.ts": "replicates an existing item from a peer, not new intake",
  // These pass a fully built input through; the builder states the outcome.
  "lib/actions/federated-demand.ts": "passes ingest through to adoptIncomingDemand (federation/demand-exchange.ts)",
  "lib/ecosystem/inbound-triage-runner.ts": "passes ingest through to toBacklogIngestInput (ecosystem/inbound-issue-triage.ts)",
  "lib/queue/functions/local-only-knowledge-sweep.ts": "passes ingest through to runLocalOnlyKnowledgeSweep (process-spine/local-only-knowledge-sweep.ts)",
  "lib/work-management/flow-review-escalation.server.ts": "passes ingest through; sustainedBottleneckIntake states the outcome",
  "lib/operate/issue-report-triage-runner.ts": "writes data built by triageIssueReports, which states the outcome",
  "lib/queue/functions/issue-report-triage.ts": "writes data built by checkForSpike, which states the outcome",
  "lib/operate/process-observer-hook.ts": "writes data built by buildBacklogItemData, which states the outcome",
  "lib/gpp/efficacy/guard-outcome-jobs.ts": "passes ingest through; fileRetirementReviews (gpp/efficacy/guard-retirement-filing.ts) states the outcome",
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "__tests__") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec|pg\.test)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

describe("every backlog filing route states an outcome (guard)", () => {
  const filers = ["lib", "app"].flatMap((d) => sourceFiles(join(WEB_ROOT, d)))
    .filter((path) => FILING_CALL.test(readFileSync(path, "utf8")))
    .map((path) => relative(WEB_ROOT, path).split("\\").join("/"));

  it("finds the filing routes", () => {
    expect(filers.length).toBeGreaterThan(15);
  });

  it.each(filers)("%s states an outcome or is exempt with a reason", (file) => {
    if (file in EXEMPT) return;
    const source = readFileSync(join(WEB_ROOT, file), "utf8");
    expect(STATES_OUTCOME.test(source), `${file} files backlog items without an outcome (BI-458CCA8D)`).toBe(true);
  });
});
