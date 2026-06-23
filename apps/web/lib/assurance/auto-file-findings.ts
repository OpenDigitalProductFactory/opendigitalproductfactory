// apps/web/lib/assurance/auto-file-findings.ts
//
// The auto-file step the Assurance Gate runs after persisting findings. It closes
// the "lost queue" (findings that only became backlog items via a manual per-
// finding button) by filing GENUINE findings through the shared ingestBacklogItem
// front door (EP-INTAKE-UNIFY) — no operator click — while reconciling against
// main first so stale/accepted findings never spawn phantom work.
//
// Disposition (apps/web/lib/assurance/finding-reconcile.ts, founder-kernel policy):
//   file          → ingest a BI (high/critical=build, moderate=deferred); status→planned
//   suppress      → accepted-in-baseline (status→accepted) | stale-on-main (status→false-positive)
//   evidence-only → already-linked | low/info | reconcile-context-unavailable (fail-closed)
//
// Every finding is annotated with `evidence.autoFile` so the read-only panel can
// show "Linked BI-…" or "suppressed: <reason>".

import {
  decideFindingDisposition,
  emptyDispositionTotals,
  type DispositionTotals,
  type ReconcileContext,
} from "./finding-reconcile";
import {
  ingestBacklogItem,
  type BacklogIngestInput,
  type BacklogIngestResult,
} from "@/lib/operate/backlog-ingest";
import type { AssuranceFindingStatus, NormalizedAssuranceFinding } from "./types";

export const ASSURANCE_AUTO_FILE_EPIC = "EP-ASSURANCE-LEDGER";

const TERMINAL_STATUSES = new Set<AssuranceFindingStatus>(["resolved", "false-positive"]);

export interface AutoFileFindingsDb {
  assuranceFinding: {
    update(args: unknown): Promise<unknown>;
  };
}

export interface AutoFileFindingsInput {
  db: AutoFileFindingsDb;
  findings: NormalizedAssuranceFinding[];
  context: ReconcileContext;
  buildId: string;
  digitalProductId?: string | null;
  now: Date;
  epicId?: string;
  /** Injectable for tests; defaults to the shared backlog front door. */
  ingest?: (input: BacklogIngestInput) => Promise<BacklogIngestResult>;
}

function severityLabel(severity: string): string {
  return severity ? severity.toUpperCase() : "UNKNOWN";
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function autoFileBody(
  finding: NormalizedAssuranceFinding,
  buildId: string,
  digitalProductId: string | null | undefined,
  reason: string,
): string {
  const moduleName = asString(finding.evidence.moduleName);
  const observed = asString(finding.evidence.observedVersion);
  const patched = asString(finding.remediationHint?.patchedVersions);
  return [
    `Auto-filed by the Build Studio Assurance Gate from finding ${finding.findingKey} (${finding.vendorIdentifier}).`,
    "",
    `Severity: ${severityLabel(finding.policySeverity)}`,
    `Build: ${buildId}`,
    digitalProductId ? `Product: ${digitalProductId}` : null,
    moduleName && observed ? `Observed: ${moduleName}@${observed}` : null,
    patched ? `Patched: ${patched}` : null,
    `Disposition: ${reason}`,
    "",
    "Reconciled against main before filing (accepted-baseline + stale-version checks); the finding evidence carries the back-link.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Apply the auto-file policy to a freshly-persisted set of normalized findings.
 * Returns how many were filed, suppressed, or retained as evidence.
 */
export async function autoFileFindingsFromScan(input: AutoFileFindingsInput): Promise<DispositionTotals> {
  const ingest = input.ingest ?? ingestBacklogItem;
  const epicId = input.epicId ?? ASSURANCE_AUTO_FILE_EPIC;
  const totals = emptyDispositionTotals();

  for (const finding of input.findings) {
    const disposition = decideFindingDisposition(finding, input.context);
    let backlogItemId: string | null = null;

    if (disposition.action === "file") {
      const item = await ingest({
        title: `Remediate: ${finding.title}`.slice(0, 180),
        body: autoFileBody(finding, input.buildId, input.digitalProductId, disposition.reason),
        type: "product",
        workType: "bug",
        source: "automated-detection",
        proposedOutcome: disposition.proposedOutcome,
        effortSize: "medium",
        epicId,
        digitalProductId: input.digitalProductId ?? undefined,
        ...(typeof disposition.priority === "number" ? { priority: disposition.priority } : {}),
        origin: { kind: "assuranceFinding", id: finding.findingKey },
      });
      backlogItemId = item.itemId;
      totals.filed += 1;
    } else if (disposition.action === "suppress") {
      totals.suppressed += 1;
    } else {
      totals.evidenceOnly += 1;
    }

    const data: Record<string, unknown> = {
      evidence: {
        ...finding.evidence,
        ...(backlogItemId ? { backlogItemId } : {}),
        autoFile: {
          action: disposition.action,
          reason: disposition.reason,
          at: input.now.toISOString(),
          ...(backlogItemId ? { backlogItemId } : {}),
        },
      },
    };
    if (disposition.findingStatus) {
      data.status = disposition.findingStatus;
      if (TERMINAL_STATUSES.has(disposition.findingStatus)) data.resolvedAt = input.now;
    }

    await input.db.assuranceFinding.update({
      where: { findingKey: finding.findingKey },
      data,
    });
  }

  return totals;
}
