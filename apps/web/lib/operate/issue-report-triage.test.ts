import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildIssueBacklogItem,
  triageIssueReports,
  llmTriageReport,
  checkForSpike,
  shouldSuppressIssueReportAsBacklog,
  _resetCache,
} from "./issue-report-triage";

// General-path fixture. NOTE: source is "manual" (not "crash_boundary") because
// crash_boundary reports take the dedicated honest-triage gate (BI-B4F401B3)
// that skips the LLM — see the "crash_boundary gate" suite below for that path.
const report = {
  id: "r1",
  reportId: "PIR-ABC12",
  type: "runtime_error",
  severity: "critical",
  title: "Page crash on /platform/ai/providers/ollama",
  description: "Server component render error",
  routeContext: "/platform/ai/providers/ollama",
  errorStack: "Error: Something went wrong\n  at render (file.tsx:42)",
  source: "manual",
};

beforeEach(() => _resetCache());

describe("shouldSuppressIssueReportAsBacklog (BI-PIR-76694be9)", () => {
  it("suppresses zero-result discovery cadence status notes", () => {
    expect(
      shouldSuppressIssueReportAsBacklog({
        title: "Filter out zero-result daily discovery triage notifications from backlog",
        description:
          "The cadence triage run found no taxonomy gaps. All metrics at zero: processed 0, decisions 0. The digital product estate is clean for this cycle.",
      }),
    ).toBe(true);
  });

  it("does not suppress a real defect report", () => {
    expect(
      shouldSuppressIssueReportAsBacklog({
        title: "Page crash on /ops",
        description: "ReferenceError: ActionResult is not defined",
      }),
    ).toBe(false);
  });
});

describe("buildIssueBacklogItem", () => {
  it("creates item with BI-PIR prefix, workType=bug, source=automated-detection", () => {
    const item = buildIssueBacklogItem(report, "prod-1", "tax-1");
    expect(item.itemId).toMatch(/^BI-PIR-/);
    // workType is the closed work-type axis; source is intake origin.
    // PIR rows are runtime evidence captured automatically, so:
    //   source       = automated-detection
    //   workType     = bug  (the bug discriminator that
    //                       governed-backlog-tee-up reads to derive
    //                       FeatureBuild.kind="fix")
    expect(item.source).toBe("automated-detection");
    expect(item.workType).toBe("bug");
    expect(item.type).toBe("product");
    expect(item.priority).toBe(1); // critical → 1
    expect(item.digitalProductId).toBe("prod-1");
    expect(item.taxonomyNodeId).toBe("tax-1");
  });

  it("includes report ID in body for traceability", () => {
    const item = buildIssueBacklogItem(report, null, null);
    expect(item.body).toContain("PIR-ABC12");
  });

  it("falls back to portfolio type when no product", () => {
    const item = buildIssueBacklogItem(report, null, null);
    expect(item.type).toBe("portfolio");
  });
});

const triageDeps = (overrides: Record<string, unknown> = {}) => ({
  getOpenReports: async () => [report],
  getExistingTitles: async () => [] as string[],
  createBacklogItem: vi.fn(),
  incrementOccurrence: vi.fn(),
  acknowledgeReport: vi.fn(),
  resolveProductId: async () => "prod-1",
  resolveTaxonomyNodeId: async () => "tax-1",
  ...overrides,
});

describe("triageIssueReports", () => {
  it("creates backlog items for new reports", async () => {
    const created: unknown[] = [];
    const acknowledged: string[] = [];

    const result = await triageIssueReports(triageDeps({
      createBacklogItem: async (data: unknown) => { created.push(data); },
      acknowledgeReport: async (id: string) => { acknowledged.push(id); },
    }));

    expect(result.created).toBe(1);
    expect(result.llmEnhanced).toBe(0);
    expect(created).toHaveLength(1);
    expect(acknowledged).toEqual(["r1"]);
  });

  it("skips duplicates and increments occurrence", async () => {
    const incrementedTitles: string[] = [];
    const created: unknown[] = [];

    const result = await triageIssueReports(triageDeps({
      getExistingTitles: async () => ["Page crash on /platform/ai/providers/ollama"],
      createBacklogItem: async (data: unknown) => { created.push(data); },
      incrementOccurrence: async (title: string) => { incrementedTitles.push(title); },
    }));

    expect(result.created).toBe(0);
    expect(created).toHaveLength(0);
    expect(incrementedTitles).toEqual(["Page crash on /platform/ai/providers/ollama"]);
  });

  it("acknowledges zero-result discovery notes without creating a BI (BI-PIR-76694be9)", async () => {
    const zeroResult = {
      ...report,
      id: "zr1",
      reportId: "PIR-WTWQA",
      title: "Filter out zero-result daily discovery triage notifications from backlog",
      description:
        "The 2026-06-26 cadence triage run found no taxonomy gaps. All metrics at zero: processed 0, decisions 0. The digital product estate is clean for this cycle.",
      severity: "low",
    };
    const created: unknown[] = [];
    const acknowledged: string[] = [];
    const result = await triageIssueReports(
      triageDeps({
        getOpenReports: async () => [zeroResult],
        createBacklogItem: async (data: unknown) => {
          created.push(data);
        },
        acknowledgeReport: async (id: string) => {
          acknowledged.push(id);
        },
      }),
    );
    expect(result.created).toBe(0);
    expect(created).toHaveLength(0);
    expect(acknowledged).toEqual(["zr1"]);
  });

  it("prevents intra-batch duplicates", async () => {
    const report2 = { ...report, id: "r2", reportId: "PIR-DEF34" };
    const created: unknown[] = [];

    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [report, report2],
      createBacklogItem: async (data: unknown) => { created.push(data); },
    }));

    expect(result.created).toBe(1);
    expect(created).toHaveLength(1);
  });

  it("returns 0 for empty reports", async () => {
    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [],
    }));

    expect(result.created).toBe(0);
    expect(result.llmEnhanced).toBe(0);
  });

  it("uses LLM triage when callLlm is provided", async () => {
    const created: unknown[] = [];

    const mockLlm = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        severity: "high",
        taxonomyPath: "foundational/platform_services/ai_inference",
        duplicateOf: null,
        rootCause: "Ollama provider endpoint returns malformed JSON when model list is empty",
        suggestedTitle: "Ollama provider page crashes when no models are pulled",
      }),
    });

    const result = await triageIssueReports(triageDeps({
      createBacklogItem: async (data: unknown) => { created.push(data); },
      callLlm: mockLlm,
      resolveTaxonomyNodeByPath: async () => "tax-ai-inference",
    }));

    expect(result.created).toBe(1);
    expect(result.llmEnhanced).toBe(1);
    expect(mockLlm).toHaveBeenCalledOnce();

    const item = created[0] as { title: string; priority: number; body: string; taxonomyNodeId: string };
    expect(item.title).toBe("Ollama provider page crashes when no models are pulled");
    expect(item.priority).toBe(2); // high → 2 (LLM downgraded from critical)
    expect(item.body).toContain("Root cause:");
    expect(item.taxonomyNodeId).toBe("tax-ai-inference");
  });

  it("LLM semantic dedup identifies duplicates by exact title match", async () => {
    const created: unknown[] = [];
    const incremented: string[] = [];

    const mockLlm = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        severity: "critical",
        taxonomyPath: null,
        duplicateOf: "Ollama provider page failure",
        rootCause: null,
        suggestedTitle: "Ollama crash",
      }),
    });

    const result = await triageIssueReports(triageDeps({
      getExistingTitles: async () => ["Ollama provider page failure"],
      createBacklogItem: async (data: unknown) => { created.push(data); },
      incrementOccurrence: async (title: string) => { incremented.push(title); },
      callLlm: mockLlm,
    }));

    expect(result.created).toBe(0);
    expect(created).toHaveLength(0);
    expect(incremented).toEqual(["Ollama provider page failure"]);
  });

  it("falls back to deterministic triage when LLM fails", async () => {
    const created: unknown[] = [];
    const mockLlm = vi.fn().mockRejectedValue(new Error("No model available"));

    const result = await triageIssueReports(triageDeps({
      createBacklogItem: async (data: unknown) => { created.push(data); },
      callLlm: mockLlm,
    }));

    expect(result.created).toBe(1);
    expect(result.llmEnhanced).toBe(0);
    // Falls back to original title and severity
    const item = created[0] as { title: string; priority: number };
    expect(item.title).toBe("Page crash on /platform/ai/providers/ollama");
    expect(item.priority).toBe(1); // original critical → 1
  });
});

describe("triageIssueReports — self-fix escalation projection guard (BI-0ACD9AB2)", () => {
  const escalationReport = {
    id: "r-esc",
    reportId: "PIR-ESC01",
    type: "build-stall-escalation",
    severity: "high",
    title: 'Build Studio needs you: "X" stuck at plan review',
    description: "blocked",
    routeContext: null,
    errorStack: null,
    source: "build-studio",
    selfFixClass: "needs-human",
  };

  it("does NOT generic-project a self-fix escalation — holds it for the responder", async () => {
    const created: unknown[] = [];
    const acknowledged: string[] = [];
    const held: string[] = [];

    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [escalationReport],
      createBacklogItem: async (d: unknown) => { created.push(d); },
      acknowledgeReport: async (id: string) => { acknowledged.push(id); },
      holdForResponder: async (id: string) => { held.push(id); },
    }));

    expect(result.created).toBe(0);
    expect(created).toHaveLength(0);   // no BI-PIR-* created
    expect(acknowledged).toEqual([]);  // not marked triaged_local
    expect(held).toEqual(["r-esc"]);   // held for the responder instead
  });

  it("classifies by selfFixClass even when the type is not build-stall-escalation", async () => {
    const created: unknown[] = [];
    const held: string[] = [];

    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [
        { ...escalationReport, id: "r-esc2", reportId: "PIR-ESC02", type: "runtime_error" },
      ],
      createBacklogItem: async (d: unknown) => { created.push(d); },
      holdForResponder: async (id: string) => { held.push(id); },
    }));

    expect(result.created).toBe(0);
    expect(held).toEqual(["r-esc2"]);
  });

  it("is per-report — a normal runtime report in the same batch still projects", async () => {
    const created: unknown[] = [];
    const held: string[] = [];

    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [escalationReport, report],
      createBacklogItem: async (d: unknown) => { created.push(d); },
      holdForResponder: async (id: string) => { held.push(id); },
    }));

    expect(result.created).toBe(1);    // the runtime report still projects
    expect(created).toHaveLength(1);
    expect(held).toEqual(["r-esc"]);   // only the escalation is held
  });
});

describe("triageIssueReports — crash_boundary gate (BI-B4F401B3)", () => {
  const crashReport = {
    id: "rc1",
    reportId: "PIR-CR001",
    type: "runtime_error",
    severity: "critical",
    title: "Page crash",
    description: "An error occurred in the Server Components render.",
    routeContext: "/ops/self-upgrade",
    errorStack: null,
    source: "crash_boundary",
    errorDigest: "1234567890",
  };

  it("skips the LLM and files an honest deterministic item (no guessed root cause)", async () => {
    const created: unknown[] = [];
    const mockLlm = vi.fn();

    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [crashReport],
      createBacklogItem: async (d: unknown) => { created.push(d); },
      callLlm: mockLlm,
    }));

    expect(mockLlm).not.toHaveBeenCalled(); // never feeds the sanitized message to the LLM
    expect(result.llmEnhanced).toBe(0);
    expect(result.created).toBe(1);
    const item = created[0] as { title: string; body: string; workType: string };
    expect(item.title).toBe("Crash: /ops/self-upgrade (PIR-CR001) — investigate via diagnostic prompt");
    expect(item.body).toContain("Error digest: 1234567890");
    expect(item.body).toContain("NOT a diagnosed root cause");
    expect(item.workType).toBe("bug");
  });

  it("folds repeat crashes with the same digest into one item (cross-route incident dedup)", async () => {
    const created: unknown[] = [];
    const incremented: string[] = [];

    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [crashReport],
      findCrashItemTitleByDigest: async (digest: string) =>
        digest === "1234567890" ? "Crash: /build (PIR-CR000) — investigate via diagnostic prompt" : null,
      createBacklogItem: async (d: unknown) => { created.push(d); },
      incrementOccurrence: async (t: string) => { incremented.push(t); },
    }));

    expect(result.created).toBe(0);
    expect(created).toHaveLength(0);
    expect(incremented).toEqual(["Crash: /build (PIR-CR000) — investigate via diagnostic prompt"]);
  });

  it("creates a fresh item when no prior crash shares the digest", async () => {
    const created: unknown[] = [];
    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [crashReport],
      findCrashItemTitleByDigest: async () => null,
      createBacklogItem: async (d: unknown) => { created.push(d); },
    }));
    expect(result.created).toBe(1);
    expect(created).toHaveLength(1);
  });

  it("never title-dedups crash reports — only the digest folds them", async () => {
    // Distinct real errors can share a sanitized title; title-matching must not
    // fold them. A digest-less crash always files its own item.
    const created: unknown[] = [];
    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [{ ...crashReport, errorDigest: null }],
      getExistingTitles: async () => ["Page crash"], // would match by title under the old path
      createBacklogItem: async (d: unknown) => { created.push(d); },
    }));
    expect(result.created).toBe(1);
  });
});

describe("triageIssueReports — reach-threshold + staging gate (BI-51F6A428)", () => {
  // A reach-gated "noise-digest" signal (log-signature scanner output).
  const logSig = {
    id: "ls1",
    reportId: "PIR-LS001",
    type: "log_signature",
    severity: "low",
    title: "New error signature in portal: transient blip",
    description: "Occurrences (last 20m): 1",
    routeContext: "/platform",
    errorStack: null,
    source: "log-signature-scanner",
    occurrenceCount: 1,
    firstSeenAt: new Date("2026-07-16T11:00:00.000Z"),
    lastSeenAt: new Date("2026-07-16T11:00:00.000Z"),
  };

  it("holds a below-bar reach-gated report staged — no BI, no acknowledge", async () => {
    const created: unknown[] = [];
    const acknowledged: string[] = [];
    const stagedIds: string[] = [];

    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [logSig],
      createBacklogItem: async (d: unknown) => { created.push(d); },
      acknowledgeReport: async (id: string) => { acknowledged.push(id); },
      shouldPromote: () => false,
      stageReport: async (id: string) => { stagedIds.push(id); },
    }));

    expect(result.created).toBe(0);
    expect(result.staged).toBe(1);
    expect(created).toHaveLength(0);
    expect(acknowledged).toEqual([]);
    expect(stagedIds).toEqual(["ls1"]);
  });

  it("ages out a staged report that stopped recurring — expire, never a BI", async () => {
    const created: unknown[] = [];
    const expiredIds: string[] = [];
    const stagedIds: string[] = [];

    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [logSig],
      createBacklogItem: async (d: unknown) => { created.push(d); },
      shouldPromote: () => false,
      shouldExpire: () => true,
      expireStagedReport: async (id: string) => { expiredIds.push(id); },
      stageReport: async (id: string) => { stagedIds.push(id); },
    }));

    expect(result.created).toBe(0);
    expect(result.expired).toBe(1);
    expect(expiredIds).toEqual(["ls1"]);
    expect(stagedIds).toEqual([]); // expired, not re-staged
    expect(created).toHaveLength(0);
  });

  it("promotes a reach-gated report once it clears the bar (shouldPromote true)", async () => {
    const created: unknown[] = [];
    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [logSig],
      createBacklogItem: async (d: unknown) => { created.push(d); },
      shouldPromote: () => true,
    }));
    expect(result.created).toBe(1);
    expect(created).toHaveLength(1);
  });

  it("caps NEW reach-gated promotions per window — extra low signals defer to staging", async () => {
    const created: unknown[] = [];
    const stagedIds: string[] = [];
    // `report` (source manual → runtime-fault) promotes and consumes the cap of 1;
    // the reach-gated low log signal is then deferred (staged) this window.
    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [report, logSig],
      createBacklogItem: async (d: unknown) => { created.push(d); },
      shouldPromote: () => true,
      stageReport: async (id: string) => { stagedIds.push(id); },
      maxNewPromotions: 1,
    }));
    expect(result.created).toBe(1);
    expect(result.staged).toBe(1);
    expect(stagedIds).toEqual(["ls1"]);
  });

  it("high-severity reach-gated signals bypass the per-window cap (never held)", async () => {
    const created: unknown[] = [];
    const stagedIds: string[] = [];
    const highLogSig = { ...logSig, id: "ls2", reportId: "PIR-LS002", severity: "high" };
    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [report, highLogSig],
      createBacklogItem: async (d: unknown) => { created.push(d); },
      shouldPromote: () => true,
      stageReport: async (id: string) => { stagedIds.push(id); },
      maxNewPromotions: 1,
    }));
    expect(result.created).toBe(2); // high bypasses the cap
    expect(stagedIds).toEqual([]);
  });

  it("without gate deps, behaviour is unchanged — reports always project", async () => {
    const created: unknown[] = [];
    const result = await triageIssueReports(triageDeps({
      getOpenReports: async () => [logSig],
      createBacklogItem: async (d: unknown) => { created.push(d); },
    }));
    expect(result.created).toBe(1); // no shouldPromote → today's always-project path
    expect(created).toHaveLength(1);
  });
});

describe("llmTriageReport", () => {
  it("parses valid LLM JSON response", async () => {
    const mockLlm = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        severity: "medium",
        taxonomyPath: "foundational/database",
        duplicateOf: null,
        rootCause: "Database connection pool exhausted",
        suggestedTitle: "DB pool exhaustion causes page timeout",
      }),
    });

    const result = await llmTriageReport(report, [], mockLlm);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("medium");
    expect(result!.taxonomyPath).toBe("foundational/database");
    expect(result!.rootCause).toBe("Database connection pool exhausted");
    expect(result!.suggestedTitle).toBe("DB pool exhaustion causes page timeout");
  });

  it("handles markdown-wrapped JSON", async () => {
    const mockLlm = vi.fn().mockResolvedValue({
      content: '```json\n{"severity":"low","taxonomyPath":null,"duplicateOf":null,"rootCause":null,"suggestedTitle":"Minor CSS glitch"}\n```',
    });

    const result = await llmTriageReport(report, [], mockLlm);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("low");
  });

  it("returns null on invalid JSON", async () => {
    const mockLlm = vi.fn().mockResolvedValue({ content: "I can't parse this error" });
    const result = await llmTriageReport(report, [], mockLlm);
    expect(result).toBeNull();
  });

  it("returns null when LLM throws", async () => {
    const mockLlm = vi.fn().mockRejectedValue(new Error("timeout"));
    const result = await llmTriageReport(report, [], mockLlm);
    expect(result).toBeNull();
  });

  it("sanitizes invalid severity to original", async () => {
    const mockLlm = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        severity: "catastrophic",
        taxonomyPath: null,
        duplicateOf: null,
        rootCause: null,
        suggestedTitle: "test",
      }),
    });

    const result = await llmTriageReport(report, [], mockLlm);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("critical"); // falls back to report.severity
  });
});

describe("checkForSpike", () => {
  it("creates spike alert when threshold exceeded", async () => {
    const created: unknown[] = [];

    const spiked = await checkForSpike({
      countReportsInWindow: async () => 15,
      countReportsInRange: async () => 24,
      getExistingTitles: async () => [],
      createBacklogItem: async (data) => { created.push(data); },
    });

    expect(spiked).toBe(true);
    expect(created).toHaveLength(1);
    expect((created[0] as { priority: number }).priority).toBe(1);
    expect((created[0] as { itemId: string }).itemId).toMatch(/^BI-PIR-SPIKE-/);
  });

  it("does not trigger on low volume", async () => {
    const created: unknown[] = [];

    const spiked = await checkForSpike({
      countReportsInWindow: async () => 2,
      countReportsInRange: async () => 100,
      getExistingTitles: async () => [],
      createBacklogItem: async (data) => { created.push(data); },
    });

    expect(spiked).toBe(false);
    expect(created).toHaveLength(0);
  });

  it("deduplicates spike alerts", async () => {
    const created: unknown[] = [];

    const spiked = await checkForSpike({
      countReportsInWindow: async () => 15,
      countReportsInRange: async () => 24,
      getExistingTitles: async () => ["Issue report spike detected — 12 reports in last hour (avg: 0.5/hr)"],
      createBacklogItem: async (data) => { created.push(data); },
    });

    expect(spiked).toBe(false);
    expect(created).toHaveLength(0);
  });
});

describe("triage cron filter excludes support-flow statuses", () => {
  it("ISSUE_REPORT_STATUS.OPEN is the cron's only target status", async () => {
    // Contract test for the queue function's filter shape.
    // It guards against accidentally widening the filter to include
    // support_triage, awaiting_escalation_ack, upstream_pending, or upstream_filed.
    const { ISSUE_REPORT_STATUS, SUPPORT_FLOW_STATUSES } = await import(
      "@/lib/quality/issue-report-status"
    );

    expect(ISSUE_REPORT_STATUS.OPEN).toBe("open");
    expect(SUPPORT_FLOW_STATUSES).not.toContain("open");
    expect(SUPPORT_FLOW_STATUSES).toContain("support_triage");
    expect(SUPPORT_FLOW_STATUSES).toContain("awaiting_escalation_ack");
    expect(SUPPORT_FLOW_STATUSES).toContain("upstream_pending");
    expect(SUPPORT_FLOW_STATUSES).toContain("upstream_filed");
  });

  it("triageIssueReports trusts its input; the cron query is the gate", async () => {
    // Defensive: if the cron ever receives a support_triage row (e.g. via a
    // changed query), buildIssueBacklogItem still runs — so the protection
    // must live at the query layer, not the pure-function layer. This test
    // documents the boundary: triageIssueReports trusts its input, the cron
    // filter is the gate. See queue/functions/issue-report-triage.ts.
    const supportReport = {
      ...report,
      id: "r-support",
      reportId: "PIR-SUP01",
    };
    const created: unknown[] = [];
    await triageIssueReports({
      getOpenReports: async () => [supportReport],
      getExistingTitles: async () => [] as string[],
      createBacklogItem: async (data: unknown) => { created.push(data); },
      incrementOccurrence: vi.fn(),
      acknowledgeReport: vi.fn(),
      resolveProductId: async () => "prod-1",
      resolveTaxonomyNodeId: async () => "tax-1",
    });
    // Pure function still processes whatever is handed in — gate is in queue layer.
    expect(created).toHaveLength(1);
  });
});
