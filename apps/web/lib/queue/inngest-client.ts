import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "dpf-platform" });

// Event payload types for type-safe event sending

export interface NonprodCapacityAvailableEvent {
  name: "nonprod/capacity.available";
  data: {
    eventId: string;
    taskRunId: string;
    leaseId: string;
    claimKey: string | null;
    environmentKey: string;
    ownerSessionId: string;
    candidateKey: string | null;
    occurredAt: string;
  };
}

/** BI-8A58C65A: execute an approved research proposal (enqueued from the
 *  approval seam; handled by research-execute.ts). */
export interface ResearchExecuteRunEvent {
  name: "research/execute.run";
  data: {
    proposalId: string;
    organizationId: string;
    digitalProductId: string | null;
    productLineId: string | null;
    businessProductId: string | null;
    topic: string;
    query: string;
  };
}

/** EP-INTAKE-UNIFY Phase 4 / BI-EDFBE081: project a freshly-created OPEN
 *  PlatformIssueReport into the backlog immediately (handled by
 *  issue-report-project.ts). The 15-min triage cron is the safety net. */
export interface IssueReportCreatedEvent {
  name: "quality/issue-report.created";
  data: { reportId: string };
}

export interface CwqItemCreatedEvent {
  name: "cwq/item.created";
  data: { workItemId: string; sourceType: string; urgency: string };
}

export interface CwqItemCompletedEvent {
  name: "cwq/item.completed";
  data: {
    workItemId: string;
    outcome: "success" | "failed" | "cancelled";
    evidence?: unknown;
  };
}

export interface CwqItemCancelledEvent {
  name: "cwq/item.cancelled";
  data: { workItemId: string; reason: string };
}

export interface DataControlOperationRecoveryRequestedEvent {
  name: "govern/data-control-operation.recover";
  data: { requestedByUserId?: string };
}

export interface CwqApprovalRequestedEvent {
  name: "cwq/approval.requested";
  data: {
    workItemId: string;
    escalationTimeoutMinutes: number;
    escalationLevel?: number;
  };
}

export interface CwqApprovalResponseEvent {
  name: "cwq/approval.response";
  data: {
    workItemId: string;
    decision: "approve" | "reject" | "delegate";
    decidedBy: string;
  };
}

export interface OpsRateRecoverEvent {
  name: "ops/rate.recover";
  data: { providerId: string; modelId: string };
}

export interface OpsMcpCatalogSyncEvent {
  name: "ops/mcp-catalog.sync";
  data: { syncId: string };
}

export interface OpsCodeGraphReconcileEvent {
  name: "ops/code-graph.reconcile";
  data: {
    reason: "git-commit" | "git-backup" | "scheduled" | "manual";
    graphKey: string;
    headSha: string | null;
    branch: string | null;
    forceFull?: boolean;
  };
}

export interface QualityIssueTriageEvent {
  name: "quality/issue-triage.run";
  data: Record<string, never>;
}

export interface AiEvalRunEvent {
  name: "ai/eval.run";
  /** force: bypass the recency-cooldown guard in runDimensionEval. Set by the
   *  operator-initiated "Run Eval" UI action so a manual re-eval always runs;
   *  left unset on automated enqueue paths (first-boot, page-load
   *  checkBundledProviders, model-discovery refresh) so a freshly-calibrated
   *  model isn't re-evaluated on every Inngest retry. BI-C8164664. */
  data: { endpointId: string; modelId: string; userId: string; force?: boolean };
}

export interface AiProbeRunEvent {
  name: "ai/probe.run";
  data: { endpointId?: string; modelId?: string; probesOnly: boolean; userId: string };
}

export interface BrandExtractRunEvent {
  name: "brand/extract.run";
  data: {
    organizationId: string;
    taskRunId: string;
    userId: string;
    threadId: string | null;
    sources: {
      url?: string;
      codebasePath?: string;
      uploadIds?: string[];
    };
  };
}

export interface BuildBacklogTeeUpRequestedEvent {
  name: "build/backlog-tee-up.requested";
  data: {
    userId: string;
    limit?: number | null;
    routeContext?: string | null;
    threadId?: string | null;
    requestedByAgentId?: string | null;
  };
}

export interface BuildGitUpdateReceivedEvent {
  name: "build/git-update.received";
  data: {
    candidateId: string;
  };
}

/** BI-89030C9B Phase 1 — durable build execution. Sent by autoExecuteBuild
 *  when DPF_BUILD_DURABLE_EXECUTION_ENABLED is on; handled by
 *  queue/functions/build-execute.ts. Sends carry a deterministic idempotency
 *  id (buildExecuteSendId) so duplicate dispatches of the same logical
 *  attempt collapse to one run. */
export interface BuildExecuteRunEvent {
  name: "build/execute.run";
  data: {
    buildId: string;
  };
}

export interface BuildPreBuildReviewRepairEvent {
  name: "build/pre-build-review.repair";
  data: {
    buildId: string;
    userId: string;
    kind: "design" | "plan";
  };
}

export interface AssuranceBomGenerateEvent {
  name: "assurance/bom.generate";
  data: {
    buildId: string;
    requestedByUserId: string;
  };
}

export interface AssuranceScanRunEvent {
  name: "assurance/scan.run";
  data: {
    buildId: string;
    requestedByUserId: string;
  };
}

export interface PortalSelfUpgradeRequestedEvent {
  name: "portal/self-upgrade.requested";
  data: {
    trigger: "manual";
    requestedByUserId?: string | null;
  };
}

/** BI-0AB96FE7: operator "run now" / dry-run for the Inngest history-retention
 *  + orphan-reaper sweep (handled by inngest-retention-sweep.ts). `dryRun`
 *  counts eligible rows without deleting. */
export interface OpsInngestRetentionRequestedEvent {
  name: "ops/inngest-retention.requested";
  data: { dryRun?: boolean };
}

export interface LocalModelInstallEvent {
  name: "inference/local-model.install";
  data: {
    jobId: string;
    attempt: number;
    modelReference: string;
    requestedByUserId: string;
  };
}

// ─── Activity Quiescence Protocol events (BI-QUIESCE-002) ────────────────

/** Sent by callers to start a quiescence drain. The coordinator function
 *  (apps/web/lib/queue/functions/quiescence-run.ts) is triggered on this event. */
export interface OpsQuiescenceStartEvent {
  name: "ops/quiescence.start";
  data: {
    runId: string;
    budgetMs: number;
    triggerRefId: string | null;
    shipForce: boolean;
  };
}

/** Sent by callers AFTER the swap completes (or fails / is aborted). The
 *  coordinator picks this up via step.waitForEvent and transitions to its
 *  terminal state. */
export interface OpsQuiescenceSwapCompleteEvent {
  name: "ops/quiescence.swap-complete";
  data: {
    runId: string;
    outcome: "succeeded" | "failed" | "aborted";
    reason?: string;
    operatorUserId?: string;
  };
}

/** Emitted by the coordinator on EVERY terminal transition. Two consumer
 *  classes: client UI (banner dismiss) AND suspended Inngest functions
 *  waiting on this event for resume. The CRITICAL invariant from spec §5.2:
 *  every terminal path emits this — without it, a coordinator failure leaves
 *  the Inngest queue waiting forever. */
export interface PlatformQuiescenceClearedEvent {
  name: "platform.quiescence-cleared";
  data: {
    runId: string;
    outcome: "succeeded" | "deferred" | "aborted" | "failed";
    triggerRefId: string | null;
    deferSurface: string | null;
    reason: string | null;
  };
}
