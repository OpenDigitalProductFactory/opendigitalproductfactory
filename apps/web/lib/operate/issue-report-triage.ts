// ─── Issue Report Triage — PlatformIssueReport → BacklogItem ────────────────
// Converts open issue reports into backlog items with dedup and occurrence tracking.
// Mirrors the process-observer-triage pattern.
//
// LLM-enhanced mode: uses the cheapest available model (local preferred) for
// semantic dedup, severity assessment, and taxonomy routing. Falls back to
// deterministic logic when no model is available.

import type { Severity } from "./process-observer";
import {
  severityToPriority,
  isDuplicate,
  type BacklogItemData,
} from "./process-observer-triage";

// ─── Types ──────────────────────────────────────────────────────────────────

interface IssueReport {
  id: string;
  reportId: string;
  type: string;
  severity: string;
  title: string;
  description: string | null;
  routeContext: string | null;
  errorStack: string | null;
  source: string;
}

// ─── Pure Functions ─────────────────────────────────────────────────────────

export function buildIssueBacklogItem(
  report: IssueReport,
  digitalProductId: string | null,
  taxonomyNodeId: string | null,
): BacklogItemData {
  const suffix = crypto.randomUUID().slice(0, 8);
  const bodyParts = [
    report.description,
    report.routeContext ? `Route: ${report.routeContext}` : null,
    report.errorStack ? `Stack (excerpt):\n${report.errorStack.slice(0, 2000)}` : null,
    `Source report: ${report.reportId} (${report.source})`,
  ];

  return {
    itemId: `BI-PIR-${suffix}`,
    title: report.title,
    body: bodyParts.filter(Boolean).join("\n\n"),
    status: "open",
    type: digitalProductId ? "product" : "portfolio",
    priority: severityToPriority((report.severity || "medium") as Severity),
    source: "issue_report",
    digitalProductId,
    taxonomyNodeId,
  };
}

// ─── LLM-Enhanced Triage ────────────────────────────────────────────────────
// Uses routeAndCall with budgetClass:"minimize_cost" to prefer local models.
// Falls back to deterministic logic on any LLM failure.

export interface LlmTriageResult {
  /** Refined severity based on actual impact analysis */
  severity: Severity;
  /** Best-fit taxonomy node path (e.g., "foundational/platform_services/ai_inference") */
  taxonomyPath: string | null;
  /** Semantic duplicate of an existing backlog item title, or null */
  duplicateOf: string | null;
  /** One-line root cause hypothesis */
  rootCause: string | null;
  /** Improved title for the backlog item */
  suggestedTitle: string;
}

const TRIAGE_SYSTEM_PROMPT = `You are a platform issue triage agent. Given an error report, analyze it and return a JSON object with these fields:

- severity: "critical" | "high" | "medium" | "low" — assess actual user impact:
  - critical: data loss, security issue, or entire feature unusable
  - high: major feature broken but workarounds exist
  - medium: minor feature broken or degraded experience
  - low: cosmetic issue or edge case
- taxonomyPath: best-fit taxonomy path from the platform's hierarchy, or null if unclear. Common paths:
  - "foundational/platform_services" (portal infrastructure)
  - "foundational/platform_services/ai_inference" (AI/model issues)
  - "foundational/platform_services/authentication" (auth issues)
  - "foundational/database" (data/persistence issues)
  - "foundational/observability_platform" (monitoring/logging issues)
- duplicateOf: if this looks like a duplicate of one of the existing backlog items listed, return that item's exact title. Otherwise null.
- rootCause: one-line hypothesis of the root cause based on the error and stack trace. null if unclear.
- suggestedTitle: a clear, actionable title for the backlog item (max 120 chars).

Return ONLY valid JSON. No markdown, no explanation.`;

export async function llmTriageReport(
  report: IssueReport,
  existingTitles: string[],
  callLlm: (messages: Array<{ role: string; content: string }>, systemPrompt: string) => Promise<{ content: string }>,
): Promise<LlmTriageResult | null> {
  const userPrompt = [
    `Error Report ${report.reportId}:`,
    `Title: ${report.title}`,
    `Route: ${report.routeContext ?? "(unknown)"}`,
    `Type: ${report.type}`,
    `Current severity: ${report.severity}`,
    report.description ? `Description: ${report.description.slice(0, 1000)}` : null,
    report.errorStack ? `Stack trace (first 1500 chars):\n${report.errorStack.slice(0, 1500)}` : null,
    existingTitles.length > 0
      ? `\nExisting backlog items to check for duplicates:\n${existingTitles.slice(0, 30).map((t) => `- ${t}`).join("\n")}`
      : null,
  ].filter(Boolean).join("\n");

  try {
    const result = await callLlm(
      [{ role: "user", content: userPrompt }],
      TRIAGE_SYSTEM_PROMPT,
    );

    const parsed = JSON.parse(result.content.replace(/```json\n?|\n?```/g, "").trim());

    // Validate the response shape
    const validSeverities = ["critical", "high", "medium", "low"];
    if (!validSeverities.includes(parsed.severity)) {
      parsed.severity = report.severity || "medium";
    }

    return {
      severity: parsed.severity as Severity,
      taxonomyPath: typeof parsed.taxonomyPath === "string" ? parsed.taxonomyPath : null,
      duplicateOf: typeof parsed.duplicateOf === "string" ? parsed.duplicateOf : null,
      rootCause: typeof parsed.rootCause === "string" ? parsed.rootCause : null,
      suggestedTitle: typeof parsed.suggestedTitle === "string"
        ? parsed.suggestedTitle.slice(0, 200)
        : report.title,
    };
  } catch {
    // LLM unavailable or returned invalid JSON — caller falls back to deterministic
    return null;
  }
}

// ─── Async Triage ───────────────────────────────────────────────────────────

export async function triageIssueReports(deps: {
  getOpenReports: () => Promise<IssueReport[]>;
  getExistingTitles: () => Promise<string[]>;
  createBacklogItem: (data: BacklogItemData) => Promise<void>;
  incrementOccurrence: (title: string) => Promise<void>;
  acknowledgeReport: (id: string) => Promise<void>;
  resolveProductId?: () => Promise<string | null>;
  resolveTaxonomyNodeId?: () => Promise<string | null>;
  resolveTaxonomyNodeByPath?: (path: string) => Promise<string | null>;
  /** Optional LLM caller — when provided, enables semantic dedup, severity
   *  reassessment, taxonomy routing, and root cause analysis. Uses the
   *  cheapest available model via routeAndCall(budgetClass:"minimize_cost"). */
  callLlm?: (messages: Array<{ role: string; content: string }>, systemPrompt: string) => Promise<{ content: string }>;
}): Promise<{ created: number; llmEnhanced: number }> {
  const reports = await deps.getOpenReports();
  if (reports.length === 0) return { created: 0, llmEnhanced: 0 };

  const existingTitles = await deps.getExistingTitles();
  const dpfProductId = deps.resolveProductId
    ? await deps.resolveProductId()
    : await getDpfPortalProductId();
  const defaultTaxonomyNodeId = deps.resolveTaxonomyNodeId
    ? await deps.resolveTaxonomyNodeId()
    : await getDpfTaxonomyNodeId();
  let created = 0;
  let llmEnhanced = 0;

  for (const report of reports) {
    // ── Step 1: Try LLM-enhanced triage ──────────────────────────────────
    let llmResult: LlmTriageResult | null = null;
    if (deps.callLlm) {
      llmResult = await llmTriageReport(report, existingTitles, deps.callLlm);
    }

    // ── Step 2: Dedup — semantic (LLM) then deterministic fallback ───────
    const isDupe = llmResult?.duplicateOf
      ? existingTitles.some((t) => t.toLowerCase() === llmResult!.duplicateOf!.toLowerCase())
      : isDuplicate(report.title, existingTitles);

    if (isDupe) {
      await deps.incrementOccurrence(llmResult?.duplicateOf ?? report.title);
      await deps.acknowledgeReport(report.id);
      continue;
    }

    // ── Step 3: Resolve taxonomy node — LLM path or default ─────────────
    let taxonomyNodeId = defaultTaxonomyNodeId;
    if (llmResult?.taxonomyPath && deps.resolveTaxonomyNodeByPath) {
      const resolved = await deps.resolveTaxonomyNodeByPath(llmResult.taxonomyPath);
      if (resolved) taxonomyNodeId = resolved;
    }

    // ── Step 4: Build backlog item — enhanced or basic ───────────────────
    const data = buildIssueBacklogItem(report, dpfProductId, taxonomyNodeId);

    // Apply LLM enhancements
    if (llmResult) {
      data.title = llmResult.suggestedTitle;
      data.priority = severityToPriority(llmResult.severity);
      if (llmResult.rootCause) {
        data.body = `Root cause: ${llmResult.rootCause}\n\n${data.body}`;
      }
      llmEnhanced++;
    }

    await deps.createBacklogItem(data);
    existingTitles.push(data.title); // prevent intra-batch dupes
    await deps.acknowledgeReport(report.id);
    created++;
  }

  return { created, llmEnhanced };
}

// ─── Spike Detection ────────────────────────────────────────────────────────

export async function checkForSpike(deps: {
  countReportsInWindow: (since: Date) => Promise<number>;
  countReportsInRange: (from: Date, to: Date) => Promise<number>;
  getExistingTitles: () => Promise<string[]>;
  createBacklogItem: (data: BacklogItemData) => Promise<void>;
}): Promise<boolean> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const lastHourCount = await deps.countReportsInWindow(oneHourAgo);
  if (lastHourCount < 3) return false; // not enough to be a spike

  const sevenDayTotal = await deps.countReportsInRange(sevenDaysAgo, oneHourAgo);
  const hoursInRange = Math.max(1, (oneHourAgo.getTime() - sevenDaysAgo.getTime()) / (60 * 60 * 1000));
  const avgHourly = sevenDayTotal / hoursInRange;

  if (lastHourCount < avgHourly * 3) return false;

  const spikeTitle = `Issue report spike detected — ${lastHourCount} reports in last hour (avg: ${avgHourly.toFixed(1)}/hr)`;
  const existingTitles = await deps.getExistingTitles();

  // Use stable prefix for dedup — different counts should still match as "already alerted"
  const hasExistingSpike = existingTitles.some((t) =>
    t.toLowerCase().startsWith("issue report spike detected"),
  );
  if (hasExistingSpike) return false;

  await deps.createBacklogItem({
    itemId: `BI-PIR-SPIKE-${crypto.randomUUID().slice(0, 8)}`,
    title: spikeTitle,
    body: `Automated spike detection triggered. ${lastHourCount} issue reports filed in the last hour, compared to a 7-day average of ${avgHourly.toFixed(1)} per hour. Review Admin > Issue Reports for details.`,
    status: "open",
    type: "product",
    priority: 1,
    source: "issue_report",
    digitalProductId: null,
    taxonomyNodeId: null,
  });

  return true;
}

// ─── Helpers (lazy-cached product/taxonomy resolution) ──────────────────────

let _dpfProductId: string | null | undefined;
let _dpfTaxonomyNodeId: string | null | undefined;

async function getDpfPortalProductId(): Promise<string | null> {
  if (_dpfProductId !== undefined) return _dpfProductId;
  const { prisma } = await import("@dpf/db");
  const product = await prisma.digitalProduct.findUnique({
    where: { productId: "dpf-portal" },
    select: { id: true },
  });
  _dpfProductId = product?.id ?? null;
  return _dpfProductId;
}

async function getDpfTaxonomyNodeId(): Promise<string | null> {
  if (_dpfTaxonomyNodeId !== undefined) return _dpfTaxonomyNodeId;
  const { prisma } = await import("@dpf/db");
  const node = await prisma.taxonomyNode.findFirst({
    where: { nodeId: { endsWith: "/platform_services" } },
    select: { id: true },
  });
  _dpfTaxonomyNodeId = node?.id ?? null;
  return _dpfTaxonomyNodeId;
}

// Reset cache (for testing)
export function _resetCache() {
  _dpfProductId = undefined;
  _dpfTaxonomyNodeId = undefined;
}
