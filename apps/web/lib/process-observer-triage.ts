// ─── Process Observer — Triage & Backlog Filing ─────────────────────────────
// Routes observation findings to correct backlog with dedup.

import type { ObservationFinding, Severity } from "./process-observer";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BacklogTarget {
  digitalProductId: string | null;
  taxonomyNodeId: string | null;
  type: "product" | "portfolio";
}

export interface BacklogItemData {
  itemId: string;
  title: string;
  body: string | null;
  status: string;
  type: string;
  priority: number;
  source: string;
  digitalProductId: string | null;
  taxonomyNodeId: string | null;
}

// ─── Pure Functions ─────────────────────────────────────────────────────────

const SEVERITY_MAP: Record<Severity, number> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
};

export function severityToPriority(severity: Severity): number {
  return SEVERITY_MAP[severity];
}

export function resolveBacklogTarget(context: {
  digitalProductId: string | null;
  routeContext: string;
}): BacklogTarget {
  if (context.digitalProductId) {
    return {
      digitalProductId: context.digitalProductId,
      taxonomyNodeId: null,
      type: "product",
    };
  }

  return {
    digitalProductId: null,
    taxonomyNodeId: null,
    type: "portfolio",
  };
}

export function buildBacklogItemData(
  finding: ObservationFinding,
  taxonomyNodeId: string | null,
  digitalProductId: string | null,
): BacklogItemData {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    itemId: `BI-OBS-${suffix}`,
    title: finding.title,
    body: [
      finding.description,
      finding.rootCause ? `Root cause: ${finding.rootCause}` : null,
      finding.suggestedAction ? `Suggested: ${finding.suggestedAction}` : null,
      `Source messages: ${finding.sourceMessageIds.join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
    status: "open",
    type: digitalProductId ? "product" : "portfolio",
    priority: severityToPriority(finding.severity),
    source: "process_observer",
    digitalProductId,
    taxonomyNodeId,
  };
}

export function isDuplicate(title: string, existingTitles: string[]): boolean {
  const normalised = title.toLowerCase();
  return existingTitles.some((existing) => {
    const normExisting = existing.toLowerCase();
    return normExisting === normalised ||
      normExisting.includes(normalised) ||
      normalised.includes(normExisting);
  });
}

// ─── Async Filing ───────────────────────────────────────────────────────────

/**
 * Triage findings and file them as backlog items, deduplicating against
 * existing items. Returns the number of new items created.
 *
 * @param findings - Observation findings from analyzeConversation
 * @param context - Route context for target resolution
 * @param deps - Injectable dependencies for DB access (enables testing)
 */
export async function triageAndFile(
  findings: ObservationFinding[],
  context: { digitalProductId: string | null; routeContext: string },
  deps: {
    getExistingTitles: () => Promise<string[]>;
    createBacklogItem: (data: BacklogItemData) => Promise<void>;
  },
): Promise<number> {
  if (findings.length === 0) return 0;

  const existingTitles = await deps.getExistingTitles();
  const target = resolveBacklogTarget(context);
  let created = 0;

  for (const finding of findings) {
    if (isDuplicate(finding.title, existingTitles)) {
      continue;
    }

    const data = buildBacklogItemData(
      finding,
      target.taxonomyNodeId,
      target.digitalProductId,
    );

    await deps.createBacklogItem(data);
    existingTitles.push(finding.title); // prevent intra-batch dupes
    created++;
  }

  return created;
}
