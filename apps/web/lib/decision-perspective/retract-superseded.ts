// Retracting a pending decision whose routing basis no longer holds
// (BI-13C38318).
//
// A decision is asked because some rule said this scope should answer it. When
// that rule changes, the pending rows it produced become questions the gate
// would no longer ask — and nothing removed them. Measured on the customer 0
// install: 39 of 53 unresolved founder-actionable rows were the identical
// "run hive scout ingest: ", produced before BI-63B14D4B taught the gate that a
// platform tool's judgement belongs to WWMD, not the customer's business
// stance. They will never be answered, because there is no longer a question.
//
// WHERE THE MARKER LIVES, AND WHY NOT `humanOutcome`.
// `humanOutcome` is the human's ruling — `persistence.ts` reads `clearsGate`
// from it to decide whether a person released the gate. Writing a machine
// cleanup there would forge exactly the thing the rest of this work exists to
// protect: an owner ruling nobody made. The marker therefore goes in
// `outcomePayload`, which is already the machine's own record of how the gate
// resolved. A retracted row keeps `humanOutcome` null forever, and it is
// honest for it to stay that way — no human ever answered it.

import type { ToolConsequenceScope } from "@/lib/mcp-tools";

export type RetractableRow = {
  interactionId: string;
  question: string;
  routeContext: string | null;
  outcomePayload: unknown;
};

export type DecisionRetraction = {
  retractedAt: string;
  /** Why the question stopped being one — recorded, never inferred at read time. */
  reason: string;
  /** The tool whose reclassification superseded the question. */
  supersededByTool: string;
};

/** A row already carrying a retraction marker. Re-running must not re-stamp it. */
export function retractionOf(outcomePayload: unknown): DecisionRetraction | null {
  if (!outcomePayload || typeof outcomePayload !== "object") return null;
  const value = (outcomePayload as Record<string, unknown>)["retraction"];
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return typeof record["retractedAt"] === "string" ? (record as DecisionRetraction) : null;
}

/**
 * The tool a decision row came from.
 *
 * Two shapes, both DERIVED from the live catalog rather than a hand-kept list:
 * `routeContext` is `/tool/<name>` when the gate recorded one, and otherwise
 * `alignmentStatement()` opened the question with the tool name de-underscored
 * (`"run hive scout ingest: …"`). Matching the question prefix against real
 * catalog names is what keeps this from becoming the fixture-shaped regex that
 * caused BI-9E1E1939 — the vocabulary is the catalog, so it cannot drift.
 */
export function toolNameForRow(row: RetractableRow, toolNames: Iterable<string>): string | null {
  const route = (row.routeContext ?? "").trim();
  const fromRoute = route.startsWith("/tool/") ? route.slice("/tool/".length) : null;
  const names = [...toolNames];
  if (fromRoute && names.includes(fromRoute)) return fromRoute;

  const question = row.question.trim().toLowerCase();
  // Longest first: "run hive scout ingest" must win over a shorter prefix that
  // also matches, or the wrong tool decides whether this row is superseded.
  const candidates = names
    .map((name) => ({ name, label: name.replaceAll("_", " ").toLowerCase() }))
    .sort((a, b) => b.label.length - a.label.length);
  for (const { name, label } of candidates) {
    if (question === label || question.startsWith(`${label}:`) || question.startsWith(`${label} with `)) {
      return name;
    }
  }
  return null;
}

/**
 * Whether this row's question would still be asked of the org business gate.
 *
 * Only a scope reclassification supersedes a question. A tool that is merely
 * gone from the catalog is NOT retracted here: absence is ambiguous (a rename,
 * a partial load, a pack not registered in this context), and retracting on
 * ambiguity is the same error as vetoing on an unparsed question.
 */
export function isSupersededByScope(
  toolName: string | null,
  scopeOf: (toolName: string) => ToolConsequenceScope | undefined,
): boolean {
  if (!toolName) return false;
  return scopeOf(toolName) === "platform";
}

export type RetractionPlanEntry = {
  interactionId: string;
  retraction: DecisionRetraction;
};

/**
 * Pure planner: which rows to retract and with what recorded reason. Separated
 * from the write so the decision is testable without a database, and so an
 * operator can be shown the plan before anything is stamped.
 */
export function planRetractions(input: {
  rows: RetractableRow[];
  toolNames: Iterable<string>;
  scopeOf: (toolName: string) => ToolConsequenceScope | undefined;
  now: Date;
}): RetractionPlanEntry[] {
  const names = [...input.toolNames];
  const plan: RetractionPlanEntry[] = [];
  for (const row of input.rows) {
    if (retractionOf(row.outcomePayload)) continue;
    const toolName = toolNameForRow(row, names);
    if (!isSupersededByScope(toolName, input.scopeOf)) continue;
    plan.push({
      interactionId: row.interactionId,
      retraction: {
        retractedAt: input.now.toISOString(),
        reason:
          `${toolName} is platform-scoped, so its judgement belongs to the founder kernel rather than this organization's business stance. `
          + "The gate would not ask this question today, so it is no longer awaiting an answer.",
        supersededByTool: toolName!,
      },
    });
  }
  return plan;
}

type RetractionDb = {
  decisionInteraction: {
    findMany: (args: unknown) => Promise<RetractableRow[]>;
    update: (args: unknown) => Promise<unknown>;
  };
};

export type RetractionRunResult = {
  scanned: number;
  retracted: number;
  entries: RetractionPlanEntry[];
};

/**
 * Stamp the retraction on every superseded pending row.
 *
 * Merges into `outcomePayload` rather than replacing it: the gate's own record
 * of how it resolved (confidence, alignment, relevance method) is the evidence
 * for WHY the row exists, and a cleanup that erased it would destroy the audit
 * trail it is meant to close out.
 */
export async function retractSupersededDecisions(input: {
  db: RetractionDb;
  toolNames: Iterable<string>;
  scopeOf: (toolName: string) => ToolConsequenceScope | undefined;
  now?: Date;
  /** Plan only — show the operator what would change without writing. */
  dryRun?: boolean;
}): Promise<RetractionRunResult> {
  const rows = await input.db.decisionInteraction.findMany({
    where: { gateKey: "org-business", outcomeType: { in: ["escalate", "defer"] } },
    select: { interactionId: true, question: true, routeContext: true, outcomePayload: true },
  });
  const entries = planRetractions({
    rows,
    toolNames: input.toolNames,
    scopeOf: input.scopeOf,
    now: input.now ?? new Date(),
  });
  if (input.dryRun) return { scanned: rows.length, retracted: 0, entries };

  const byId = new Map(rows.map((row) => [row.interactionId, row]));
  for (const entry of entries) {
    const existing = byId.get(entry.interactionId)?.outcomePayload;
    const payload = existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
    await input.db.decisionInteraction.update({
      where: { interactionId: entry.interactionId },
      data: { outcomePayload: { ...payload, retraction: entry.retraction } },
    });
  }
  return { scanned: rows.length, retracted: entries.length, entries };
}
