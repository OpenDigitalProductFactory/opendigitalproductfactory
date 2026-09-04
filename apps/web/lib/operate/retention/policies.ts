// EP-DATA-RETENTION — Declarative data-retention policy registry.
//
// Spec: docs/superpowers/specs/2026-06-14-data-retention-lifecycle-governance-design.md
//
// This file is the SINGLE SOURCE OF TRUTH for what the platform purges and what
// it must retain. It is code, not seed data, on purpose (kernel:
// single-source-of-truth + fix-the-seed-not-the-runtime): the registry that
// DEFINES a policy is the same artifact the engine ENFORCES, so the two can
// never drift. Per-org tuning happens through industry floors
// (industry-floors.ts) and the operator kill switch (ScheduledJob.enabled),
// not by editing rows that could disagree with this code.
//
// Two closed axes:
//   • PURGE_POLICIES   — accumulating operational / telemetry / log / chat
//                        datasets that are safe to delete past a retention
//                        window.
//   • RETAINED_DATASETS — regulated records the platform must NOT auto-purge
//                        (financial, tax, compliance, licensing, HR, consent).
//                        Listed explicitly so the guard test
//                        (retention.test.ts) fails the build if any regulated
//                        model is ever enrolled for deletion.

import {
  DAYS_90,
  DAYS_180,
  DAYS_365,
  DAYS_545,
} from "./constants";

/** Closed set of retention categories. Industry floors key off these, so the
 *  union is shared with industry-floors.ts. Add a value here before using it. */
export type RetentionCategory =
  | "ai-telemetry"
  | "audit-log"
  | "security-audit"
  | "routing-log"
  | "build-log"
  | "coworker-chat"
  | "coworker-metrics"
  | "skill-telemetry"
  | "knowledge-audit"
  | "eval-history"
  | "inbox"
  | "self-upgrade-log"
  | "coordination-log"
  // BI-873F3C48: external integration / channel / sync telemetry (webhook
  // receipts, delivery attempts, connector tool-call logs).
  | "integration-log"
  // BI-873F3C48: per-install edge estate event streams (EdgeEvent/ChangeEvent,
  // EP-8B03CB06 makes these a first-class growth axis).
  | "edge-telemetry";

export const RETENTION_CATEGORIES: readonly RetentionCategory[] = [
  "ai-telemetry",
  "audit-log",
  "security-audit",
  "routing-log",
  "build-log",
  "coworker-chat",
  "coworker-metrics",
  "skill-telemetry",
  "knowledge-audit",
  "eval-history",
  "inbox",
  "self-upgrade-log",
  "coordination-log",
  "integration-log",
  "edge-telemetry",
] as const;

/** Minimal structural view of a Prisma model delegate the engine needs. Keeping
 *  it structural (rather than importing PrismaClient) decouples the engine and
 *  makes it trivially testable with an in-memory fake. */
export interface RetentionModelDelegate {
  findMany(args: {
    where: Record<string, unknown>;
    select: { id: true };
    take: number;
  }): Promise<Array<{ id: string }>>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

/** Structural Prisma surface the engine + custom handlers rely on. */
export type RetentionPrismaClient = Record<string, RetentionModelDelegate> & {
  $transaction(operations: unknown[]): Promise<unknown[]>;
};

/** Custom purge handler for models whose children RESTRICT a plain delete (e.g.
 *  AgentThread, whose AgentActionProposal children block a naive deleteMany).
 *  Returns rows (or parent records) removed. */
export type RetentionCustomPurge = (args: {
  prisma: RetentionPrismaClient;
  cutoff: Date;
  batchSize: number;
  cap: number;
}) => Promise<{ deleted: number; capped: boolean }>;

export interface PurgePolicy {
  /** Prisma model accessor on PrismaClient, e.g. "toolExecution". */
  model: string;
  /** Human label for reports + the admin surface. */
  label: string;
  category: RetentionCategory;
  /** Timestamp column the cutoff is applied to (varies: createdAt / startedAt /
   *  updatedAt / detectedAt). MUST be a real column with an index — see the
   *  purge-index migration. */
  timestampField: string;
  /** Base retention in days. Industry floors may LENGTHEN this, never shorten. */
  baseRetentionDays: number;
  /** Extra where-clause AND-ed with the cutoff (e.g. only purge READ
   *  notifications). Optional. */
  extraWhere?: Record<string, unknown>;
  /** Custom cascade-correct handler; when present the generic path is bypassed. */
  customPurge?: RetentionCustomPurge;
  /** What it stores + why it is safe to purge past the window. */
  rationale: string;
}

export interface RetainedDataset {
  /** Prisma model accessor. */
  model: string;
  label: string;
  /** Statutory / regulatory basis for retention (cited, not invented). */
  regulatoryBasis: string;
  /** Minimum the business is typically obligated to keep. */
  minRetentionYears: number;
}

// ── Custom handlers ─────────────────────────────────────────────────────────

/**
 * Coworker chat purge. AgentThread has three child relations:
 *   • AgentMessage   — onDelete: Cascade  (DB removes with the thread)
 *   • AgentAttachment — onDelete: Cascade (DB removes with the thread)
 *   • AgentActionProposal — onDelete: RESTRICT on BOTH thread + message FKs
 * so a plain deleteMany on AgentThread throws whenever a thread ever produced a
 * proposal. We therefore delete the proposals for the selected threads first
 * (inside one transaction), then delete the threads — which cascades messages +
 * attachments. Selection is by `updatedAt` (last activity), so an actively-used
 * thread is never swept just because it is old.
 */
export const purgeStaleAgentThreads: RetentionCustomPurge = async ({
  prisma,
  cutoff,
  batchSize,
  cap,
}) => {
  let deleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (deleted < cap) {
    const take = Math.min(batchSize, cap - deleted);
    const threads = await prisma.agentThread.findMany({
      where: { updatedAt: { lt: cutoff } },
      select: { id: true },
      take,
    });
    if (threads.length === 0) break;
    const ids = threads.map((t) => t.id);
    await prisma.$transaction([
      // Remove the RESTRICT-ing children first so the thread delete is legal.
      prisma.agentActionProposal.deleteMany({ where: { threadId: { in: ids } } }),
      // Cascades AgentMessage + AgentAttachment via their onDelete: Cascade FKs.
      prisma.agentThread.deleteMany({ where: { id: { in: ids } } }),
    ]);
    // BI-DG-001: propagate the source deletion to the derived semantic-memory
    // vectors. Best-effort — the nightly reconcile sweep is the safety net for any
    // miss — and never aborts the purge (the source rows are already gone).
    try {
      const { purgeConversationVectorsBySource } = await import(
        "@/lib/inference/semantic-memory-cleanup"
      );
      await purgeConversationVectorsBySource({ threadIds: ids });
    } catch (err) {
      console.warn("[retention] semantic-memory vector cleanup failed:", err);
    }
    deleted += threads.length;
    if (threads.length < take) break;
  }
  return { deleted, capped: deleted >= cap };
};

// ── Purge policies (enrolled accumulation surfaces) ─────────────────────────
// Ordered roughly by growth rate. Windows are conservative; see spec §6.

export const PURGE_POLICIES: readonly PurgePolicy[] = [
  {
    model: "oAuthAuthorizationCode",
    label: "OAuth authorization codes",
    category: "audit-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_90,
    rationale:
      "Single-use OAuth codes that expire in minutes (BI-E4DFDCB0). A row is dead the moment it is exchanged or expires; the exchange itself is recorded in AuthorizationDecisionLog, so nothing of record is lost. Purged on the shortest available window purely to stop the table growing.",
  },
  {
    model: "oAuthRefreshToken",
    label: "OAuth refresh tokens",
    category: "audit-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_365,
    rationale:
      "Rotating refresh tokens for MCP clients (BI-E4DFDCB0). Retained past their own expiry on purpose: the rotation chain is what makes a replayed token detectable, so a purge window shorter than the refresh TTL would erase the evidence of a stolen token. One year comfortably exceeds the 30-day default TTL.",
  },
  {
    model: "toolExecution",
    label: "Tool execution audit log",
    category: "audit-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_365,
    rationale:
      "Every tool/capability invocation (the #1 growth driver, /platform/ai/authority audit trail). One year of operational audit; regulated industries lengthen via floors.",
  },
  {
    model: "adapterRunTelemetry",
    label: "AI adapter run telemetry",
    category: "ai-telemetry",
    timestampField: "startedAt",
    baseRetentionDays: DAYS_180,
    rationale:
      "One row per LLM inference (probes, evals, coworker reasoning, builds). Cost/quality telemetry; running aggregates live elsewhere, so raw rows are disposable past 6 months.",
  },
  {
    model: "tokenUsage",
    label: "Token usage accounting",
    category: "ai-telemetry",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_180,
    rationale:
      "Per-inference token/cost rows. Kept long enough for billing reconciliation; superseded by aggregates afterwards.",
  },
  {
    model: "routeDecisionLog",
    label: "AI routing decision log",
    category: "routing-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_90,
    rationale:
      "Endpoint-selection reasoning per coworker/task call. Debugging value decays fast; 90 days is ample.",
  },
  {
    model: "authorizationDecisionLog",
    label: "Authorization decision log",
    category: "security-audit",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_365,
    rationale:
      "Every authorization decision (actor, grant, outcome). Security-audit trail; one year baseline, longer for regulated industries.",
  },
  {
    model: "securityEvent",
    label: "Security telemetry (OCSF)",
    category: "security-audit",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_365,
    rationale:
      "OCSF-normalized security telemetry (EP-SOVEREIGN-SOC P0). One-year security-audit baseline; regulated industries lengthen via floors. Detections derive from this stream; SecurityCase (the regulated incident record) is retained separately and never auto-purged.",
  },
  {
    model: "detection",
    label: "Security detections",
    category: "security-audit",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_365,
    rationale:
      "Fired detections (EP-SOVEREIGN-SOC P1). One-year security-audit window; a notable detection that opens a SecurityCase is preserved via the retained case record, so purging the raw detection past the window is safe.",
  },
  {
    model: "coworkerTurnMetric",
    label: "Coworker turn metrics",
    category: "coworker-metrics",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_180,
    rationale:
      "Per-turn latency/dispatch/tool counts. Quality telemetry; disposable past 6 months.",
  },
  {
    model: "skillUsageEvent",
    label: "Skill usage events",
    category: "skill-telemetry",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_180,
    rationale:
      "Per skill invocation. Feeds the daily skill-metrics aggregator; raw rows disposable afterwards.",
  },
  {
    model: "buildActivity",
    label: "Build Studio activity log",
    category: "build-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_90,
    rationale:
      "Tool runs during a build. Operational build trail; 90 days covers post-build investigation.",
  },
  {
    model: "buildDispatchAttempt",
    label: "Build dispatch attempts",
    category: "build-log",
    timestampField: "startedAt",
    baseRetentionDays: DAYS_90,
    rationale:
      "One row per AI specialist dispatch attempt/retry. Build telemetry; 90 days.",
  },
  {
    model: "stallEvent",
    label: "Build watchdog stall events",
    category: "build-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_90,
    rationale:
      "Build Studio stall detections + operator outcomes. Operational; 90 days.",
  },
  {
    model: "taskEvaluation",
    label: "Endpoint task evaluations",
    category: "eval-history",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_90,
    rationale:
      "Per-eval rows. Spec 2026-03-16 confirms EndpointTaskPerformance running averages are the source of truth; raw rows >90d are archivable.",
  },
  {
    model: "endpointTestRun",
    label: "Endpoint test runs",
    category: "eval-history",
    timestampField: "startedAt",
    baseRetentionDays: DAYS_90,
    rationale:
      "Probe/scenario test-run summaries. Trending value is short-lived; 90 days.",
  },
  {
    model: "wikiIngestEvent",
    label: "Wiki ingest events",
    category: "knowledge-audit",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_90,
    rationale:
      "Knowledge-base ingest audit. Operational; 90 days.",
  },
  {
    model: "notification",
    label: "Read in-app notifications",
    category: "inbox",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_90,
    // Only purge notifications the user has already read. Unread ones are never
    // swept regardless of age — they are still pending work.
    extraWhere: { read: true },
    rationale:
      "Read inbox items past 90 days. Unread notifications are preserved at any age.",
  },
  {
    model: "selfUpgradeRun",
    label: "Self-upgrade run log",
    category: "self-upgrade-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_365,
    rationale:
      "Platform self-upgrade orchestration history. Low volume but operationally valuable; one year of deployment history.",
  },
  {
    model: "quiescenceRun",
    label: "Quiescence orchestration runs",
    category: "coordination-log",
    timestampField: "startedAt",
    baseRetentionDays: DAYS_90,
    rationale:
      "Activity-quiescence drain orchestration records. Coordination audit; 90 days.",
  },
  {
    model: "agentThread",
    label: "AI coworker chat threads",
    category: "coworker-chat",
    timestampField: "updatedAt",
    baseRetentionDays: DAYS_545,
    customPurge: purgeStaleAgentThreads,
    rationale:
      "Coworker conversations with no activity for ~18 months, cascading their messages + attachments. Conservative default; regulated industries lengthen via floors. Selection by last activity so active threads are never swept.",
  },

  // ── BI-873F3C48 (Simplify & Strengthen W3): full growth-table coverage ─────
  // Append-only event/log/telemetry tables found unenrolled by the 2026-08-16
  // architecture pass (§3.2-e). Each enrollment below pairs with a leading
  // time-column index (migration 20260816101000_retention_enrollment_time_indexes)
  // so the sweep never seq-scans. Growth-shaped models deliberately NOT enrolled
  // (business records / aggregates) live on the check-retention-enrollment.mjs
  // allowlist with owner + expiry.
  {
    model: "workEngagementActivity",
    label: "Work engagement activity ledger",
    category: "coordination-log",
    timestampField: "recordedAt",
    baseRetentionDays: DAYS_180,
    rationale:
      "Per-engagement activity rows (kind/summary/payload). Operational coordination trail; 6 months covers post-hoc investigation.",
  },
  {
    model: "backlogItemActivity",
    label: "Backlog item activity ledger",
    category: "audit-log",
    timestampField: "recordedAt",
    baseRetentionDays: DAYS_365,
    rationale:
      "Per-BI activity/gate trail. One year of work-history audit; the BacklogItem row itself (status, links) is the durable record.",
  },
  {
    model: "workroomActivity",
    label: "Workroom activity ledger",
    category: "coordination-log",
    timestampField: "recordedAt",
    baseRetentionDays: DAYS_180,
    rationale:
      "Per-workroom activity rows. Workrooms are reaped when idle; their activity trail is operational, 6 months.",
  },
  {
    model: "runtimeCapabilityTransitionEvent",
    label: "Runtime capability transition events",
    category: "coordination-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_90,
    rationale:
      "Per-transition outcome events for runtime capability orchestration. Debugging value decays fast; 90 days.",
  },
  {
    model: "integrationCallbackReceipt",
    label: "Integration callback receipts",
    category: "integration-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_90,
    rationale:
      "Webhook/callback dedup receipts. Only needed within a provider's replay window; 90 days is generous.",
  },
  {
    model: "agentBudgetEvent",
    label: "Agent budget events",
    category: "ai-telemetry",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_180,
    rationale:
      "Per-inference/tool-call cost rows (mirrors tokenUsage). Kept 6 months for cost reconciliation; aggregates live elsewhere.",
  },
  {
    model: "transcriptCleanupAudit",
    label: "Transcript cleanup audit",
    category: "security-audit",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_365,
    rationale:
      "Raw-vs-cleaned transcript records incl. injection-suspicion indicators. One-year security-audit window (holds raw text — purging is also data-minimization).",
  },
  {
    model: "identityResolutionLog",
    label: "Discovery identity resolution log",
    category: "audit-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_180,
    rationale:
      "Per-resolution evidence rows from discovery sweeps. The resolved inventory entities are the durable record; 6 months.",
  },
  {
    model: "discoveryFingerprintObservation",
    label: "Discovery fingerprint observations",
    category: "audit-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_180,
    rationale:
      "Raw fingerprint evidence feeding rule approval. Approved rules are the durable output; observations disposable after 6 months.",
  },
  {
    model: "adminActivity",
    label: "Admin tool activity log",
    category: "security-audit",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_365,
    rationale:
      "Admin tool invocations (tiered, incl. blocked/denied). One-year security-audit baseline; regulated industries lengthen via floors.",
  },
  {
    model: "toolExecutionReceipt",
    label: "Tool execution receipts",
    category: "audit-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_365,
    rationale:
      "Verification receipts for tool executions. Matches the parent toolExecution window (365d); receipts also cascade when the parent purges.",
  },
  {
    model: "documentLifecycleEvent",
    label: "Document lifecycle events",
    category: "audit-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_365,
    rationale:
      "Document state-transition audit trail. One year; the Document row carries the current state and cascades its events on delete.",
  },
  {
    model: "communicationDeliveryAttempt",
    label: "Communication delivery attempts",
    category: "integration-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_90,
    rationale:
      "Per-channel delivery attempt rows. Delivery troubleshooting value decays in days; 90 days.",
  },
  // LifecycleEvent and HospitalityServiceTurnEvent are deliberately NOT
  // enrolled: both hold standing domain-lifecycle-managed stewardship
  // exemptions (scripts/stewardship-exemptions.txt) — their rows follow the
  // lifecycle of the thing they evidence, and age-based deletion would break
  // accountability history. Listed on the retention-enrollment guard allowlist
  // with that reason.
  {
    model: "appointmentSyncEvent",
    label: "Appointment sync events",
    category: "integration-log",
    timestampField: "occurredAt",
    baseRetentionDays: DAYS_90,
    rationale:
      "Cross-channel appointment sync/correlation telemetry. The appointment records are durable; sync events disposable after 90 days.",
  },
  {
    model: "queueTelemetryEvent",
    label: "Queue telemetry events",
    category: "coordination-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_90,
    rationale:
      "Queue transition telemetry feeding flow metrics. Aggregated dashboards are the durable output; 90 days of raw rows.",
  },
  {
    model: "edgeEvent",
    label: "Edge estate events",
    category: "edge-telemetry",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_180,
    // Never sweep an alert that is still open (triggered/acknowledged) — mirror
    // of the notification read:true rule. Only settled events age out.
    extraWhere: { status: { in: ["resolved", "suppressed"] } },
    rationale:
      "Per-node edge telemetry events (SNMP/syslog/probe detections). Settled events past 6 months are disposable; open alerts are never swept regardless of age.",
  },
  {
    model: "changeEvent",
    label: "Edge change-detection events",
    category: "edge-telemetry",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_365,
    rationale:
      "Configuration/state change detections from edge nodes. One year of change history for estate forensics.",
  },
  {
    model: "staffingAssignmentEvent",
    label: "Staffing assignment events",
    category: "audit-log",
    timestampField: "createdAt",
    baseRetentionDays: DAYS_365,
    rationale:
      "Assignment lifecycle transitions (proposed/confirmed/declined/…). Scheduling audit — NOT a wage/payroll record (those are retained); one year.",
  },
  {
    model: "integrationToolCallLog",
    label: "Integration tool call log",
    category: "integration-log",
    timestampField: "calledAt",
    baseRetentionDays: DAYS_180,
    rationale:
      "Per-call connector telemetry (durations, error codes, arg hashes). Efficiency analysis uses recent windows; 6 months.",
  },
] as const;

// ── Retained datasets (regulated — NEVER auto-purged) ───────────────────────
// The engine never touches these. They are catalogued here so the regulatory
// posture is explicit and the guard test can assert no overlap with
// PURGE_POLICIES. Deletion of these, when ever needed, is a deliberate,
// separately-governed action (legal hold release), not a scheduled sweep.
//
// Row-level legal hold (distinct from these table-level retained datasets) is
// now honoured by the engine: a purge over any model carrying a `legalHold`
// column excludes held rows (see ./legal-hold.ts + execute.ts, BI-90A8D153
// GAP 2). A full hold substrate (scope / custodian / matter / release) and the
// jurisdiction axis + per-run disposition evidence are the remaining, separable
// parts of that BI.

export const RETAINED_DATASETS: readonly RetainedDataset[] = [
  { model: "initiativeArtifactRetentionPin", label: "Initiative artifact retention pins", regulatoryBasis: "Approved initiative-governance baseline evidence is permanent until a separately governed, hold-aware exceptional disposition", minRetentionYears: Number.POSITIVE_INFINITY },
  // Financial records — IRS/SOX-style 7-year floor.
  { model: "invoice", label: "Invoices", regulatoryBasis: "Financial record retention (IRS / SOX-style statutory)", minRetentionYears: 7 },
  { model: "invoiceLineItem", label: "Invoice line items", regulatoryBasis: "Financial record retention", minRetentionYears: 7 },
  // The document the customer actually received. Retained at least as long as the
  // invoice itself: it is the evidence of what was billed, and it is the artifact a
  // dispute turns on when the invoice has since been edited.
  { model: "invoiceDocument", label: "Sent invoice documents", regulatoryBasis: "Financial record retention (evidence of what was billed)", minRetentionYears: 7 },
  { model: "payment", label: "Payments", regulatoryBasis: "Financial record retention", minRetentionYears: 7 },
  { model: "paymentAllocation", label: "Payment allocations", regulatoryBasis: "Financial record retention", minRetentionYears: 7 },
  { model: "bill", label: "Bills (AP)", regulatoryBasis: "Financial record retention", minRetentionYears: 7 },
  { model: "billLineItem", label: "Bill line items", regulatoryBasis: "Financial record retention", minRetentionYears: 7 },
  { model: "billApproval", label: "Bill approvals", regulatoryBasis: "Financial controls audit (SOX)", minRetentionYears: 7 },
  { model: "purchaseOrder", label: "Purchase orders", regulatoryBasis: "Financial record retention", minRetentionYears: 7 },
  { model: "purchaseOrderLineItem", label: "PO line items", regulatoryBasis: "Financial record retention", minRetentionYears: 7 },
  { model: "expenseClaim", label: "Expense claims", regulatoryBasis: "Financial record retention", minRetentionYears: 7 },
  { model: "expenseItem", label: "Expense items", regulatoryBasis: "Financial record retention", minRetentionYears: 7 },
  { model: "fixedAsset", label: "Fixed assets", regulatoryBasis: "Depreciation / financial record retention", minRetentionYears: 7 },
  { model: "exchangeRate", label: "Exchange rates", regulatoryBasis: "Financial record reproducibility", minRetentionYears: 7 },
  { model: "dunningLog", label: "Dunning log", regulatoryBasis: "Collections / financial audit", minRetentionYears: 7 },
  { model: "storefrontOrder", label: "Storefront orders", regulatoryBasis: "Sales/financial record retention", minRetentionYears: 7 },
  { model: "storefrontDonation", label: "Storefront donations", regulatoryBasis: "Nonprofit financial record retention", minRetentionYears: 7 },
  { model: "rentalAgreement", label: "Rental agreements", regulatoryBasis: "Contract / financial record retention", minRetentionYears: 7 },

  // Payroll records (recruiting→hiring→paying seam).
  { model: "payRun", label: "Pay runs", regulatoryBasis: "Payroll/wage record retention (IRS employment-tax + FLSA payroll recordkeeping)", minRetentionYears: 7 },
  { model: "payslip", label: "Payslips", regulatoryBasis: "Payroll/wage record retention (IRS employment-tax + FLSA payroll recordkeeping)", minRetentionYears: 7 },

  // Worker classification evidence (BI-C61CEEA9). A classification decides
  // whether the organisation may direct a worker and whether they accrue
  // entitlements, so the determination and the engagement term behind it are
  // the record a misclassification challenge turns on. Same statutory footing
  // as the payroll records above.
  { model: "workerClassificationDetermination", label: "Worker classification determinations", regulatoryBasis: "Worker-classification evidence (IRS worker-classification + FLSA employment recordkeeping)", minRetentionYears: 7 },
  { model: "workerEngagementTerm", label: "Worker engagement terms", regulatoryBasis: "Engagement-term evidence for worker classification (IRS + FLSA employment recordkeeping)", minRetentionYears: 7 },

  // Tax records.
  { model: "taxRemittanceRun", label: "Tax remittance runs", regulatoryBasis: "Tax record retention", minRetentionYears: 7 },
  { model: "taxDecisionSnapshot", label: "Tax decision snapshots", regulatoryBasis: "Tax record retention", minRetentionYears: 7 },
  { model: "taxLiabilityEntry", label: "Tax liability entries", regulatoryBasis: "Tax record retention", minRetentionYears: 7 },
  { model: "taxFilingArtifact", label: "Tax filing artifacts", regulatoryBasis: "Tax filing retention", minRetentionYears: 7 },

  // Compliance / regulatory evidence.
  { model: "complianceEvidence", label: "Compliance evidence", regulatoryBasis: "GRC evidence (per-record retentionUntil)", minRetentionYears: 7 },
  { model: "dataProcessingActivity", label: "Data processing activities", regulatoryBasis: "Processing authority and accountability evidence", minRetentionYears: 7 },
  { model: "dataPolicyException", label: "Data policy exceptions", regulatoryBasis: "Policy exception approval and compensating-control evidence", minRetentionYears: 7 },
  { model: "dataControlOperation", label: "Data control operations", regulatoryBasis: "Consequential mutation intent, authorization, and reconciliation evidence", minRetentionYears: 7 },
  { model: "dataControlOperationStep", label: "Data control operation checkpoints", regulatoryBasis: "Target effect, verification, and compensation evidence", minRetentionYears: 7 },
  // Security incident records (EP-SOVEREIGN-SOC) — a SecurityCase is the SOC's
  // regulated incident record; breach-notification, forensic, and legal-hold
  // obligations forbid auto-purge. Raw SecurityEvent/Detection telemetry purges
  // on the security-audit window above; the CASE is retained.
  { model: "securityCase", label: "Security cases", regulatoryBasis: "Security incident record (breach-notification / forensic / legal-hold)", minRetentionYears: 7 },
  // Break-glass risk-acceptance records (BI-4512E7D2). An operator's informed
  // decision to let a provider serve data its account is not verified-safe for —
  // and its revocation — are the record a security or data-protection review
  // turns on. Retained (never auto-purged) so an expired/revoked override remains
  // provable after the fact; low volume (rare operator actions), so no growth risk.
  { model: "providerClearanceOverride", label: "Provider clearance overrides", regulatoryBasis: "Security decision audit — informed risk-acceptance of provider data exposure", minRetentionYears: 7 },
  { model: "complianceAuditLog", label: "Compliance audit log", regulatoryBasis: "Compliance change audit", minRetentionYears: 7 },
  { model: "complianceAudit", label: "Compliance audits", regulatoryBasis: "Audit record retention", minRetentionYears: 7 },
  { model: "auditFinding", label: "Audit findings", regulatoryBasis: "Audit record retention", minRetentionYears: 7 },
  { model: "regulatorySubmission", label: "Regulatory submissions", regulatoryBasis: "Regulatory filing retention", minRetentionYears: 7 },
  { model: "requirementCompletion", label: "Requirement completions", regulatoryBasis: "Training/compliance evidence", minRetentionYears: 6 },
  { model: "policyAcknowledgment", label: "Policy acknowledgments", regulatoryBasis: "Policy compliance evidence", minRetentionYears: 6 },

  // Licensing / credentials.
  { model: "organizationLicenseRecord", label: "Org license records", regulatoryBasis: "Licensing compliance", minRetentionYears: 7 },
  { model: "personLicenseRecord", label: "Person license records", regulatoryBasis: "Credential / licensing compliance", minRetentionYears: 7 },

  // HR lifecycle.
  { model: "employmentEvent", label: "Employment events", regulatoryBasis: "Employment record retention (varies; conservative 7y)", minRetentionYears: 7 },
  { model: "terminationRecord", label: "Termination records", regulatoryBasis: "Employment record retention", minRetentionYears: 7 },

  // Consent.
  { model: "voiceConsentRecord", label: "Voice consent records", regulatoryBasis: "Consent provenance (GDPR/biometric)", minRetentionYears: 7 },

  // Recruiting / ATS applicant records (BI-F3AEBF68). Federal-contractor
  // applicant-flow recordkeeping — the platform must not auto-purge within the
  // statutory window (OFCCP 2y floor; EEOC 1y).
  { model: "candidate", label: "Candidates", regulatoryBasis: "EEOC/OFCCP applicant recordkeeping (41 CFR 60-1.12 / 29 CFR 1602)", minRetentionYears: 2 },
  { model: "application", label: "Applications", regulatoryBasis: "EEOC/OFCCP applicant-flow recordkeeping (41 CFR 60-1.12 / 29 CFR 1602)", minRetentionYears: 2 },
  { model: "scheduledInterview", label: "Scheduled interviews", regulatoryBasis: "EEOC/OFCCP selection-procedure recordkeeping", minRetentionYears: 2 },
  { model: "scorecard", label: "Interview scorecards", regulatoryBasis: "EEOC/OFCCP selection-procedure recordkeeping (adverse-impact basis)", minRetentionYears: 2 },
  { model: "offer", label: "Offers", regulatoryBasis: "EEOC/OFCCP applicant-flow recordkeeping", minRetentionYears: 2 },
  { model: "demographicResponse", label: "EEO demographic responses", regulatoryBasis: "EEOC/OFCCP demographic recordkeeping (kept separate from selection)", minRetentionYears: 2 },
  // Trust-envelope bias-audit evidence (BI-A59CB2EA). Monitoring-only demographic
  // observations are the substrate for NYC LL144 bias audits + EEOC/Title VII
  // adverse-impact records, so they must NOT be auto-purged within the audit
  // window. (A privacy-minimization purge BEYOND the statutory floor is an
  // operator policy decision — see spec §10; not a fabricated window here.)
  { model: "protectedMonitoringObservation", label: "Protected-class monitoring observations", regulatoryBasis: "NYC LL144 bias-audit / EEOC Title VII adverse-impact record retention", minRetentionYears: 1 },

  // Care coordination audit trails (BI-873F3C48). Patient appointment/intake
  // status histories are part of the clinical scheduling record — HIPAA-adjacent
  // ~6-year floor, mirroring the healthcare-wellness industry floor.
  { model: "careAppointmentStatusEvent", label: "Care appointment status events", regulatoryBasis: "HIPAA-adjacent clinical scheduling record retention", minRetentionYears: 6 },
  { model: "careIntakeStatusEvent", label: "Care intake status events", regulatoryBasis: "HIPAA-adjacent clinical intake record retention", minRetentionYears: 6 },
] as const;

/** Models the engine will purge (for guard tests + reporting). */
export const PURGE_MODELS: readonly string[] = PURGE_POLICIES.map((p) => p.model);
/** Regulated models the engine must never touch. */
export const RETAINED_MODELS: readonly string[] = RETAINED_DATASETS.map((d) => d.model);
