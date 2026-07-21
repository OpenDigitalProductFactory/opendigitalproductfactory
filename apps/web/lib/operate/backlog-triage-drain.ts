// apps/web/lib/operate/backlog-triage-drain.ts
//
// Autonomous backlog triage drain — testable core logic.
//
// Why this exists (BI-5076EA95):
//   Items captured into the backlog land in status="triaging" and sit there
//   until someone decides their outcome. The Scrum Master coworker can now
//   triage on request (it holds the backlog_triage grant), but nothing drains
//   the queue on its own, so undecided items accumulate. This module is the
//   scheduled drain: it asks an LLM to decide each triaging item and applies
//   the SAFE decisions automatically.
//
// Safety posture (deliberately conservative):
//   - Only "build" decisions are auto-applied. That outcome is reversible and
//     non-destructive — it just moves the item into the open/build pool as
//     real work. It never hides or removes anything.
//   - defer / discard / duplicate / runbook / coworker-task, low-confidence
//     decisions, and parse failures are LEFT in the triaging queue for a human
//     (or the Scrum Master on request) to decide. An autonomous job must never
//     silently bury work.
//   - Author intent is preserved (BI-TRIAGE-SIZE-OVERWRITE): when an item
//     already carries a deliberate, valid effortSize, the drain keeps THAT size
//     on auto-build and never overwrites it with the LLM's blind re-estimate
//     (which regresses to "medium"). The LLM only sizes items captured with no
//     size — the autonomous-capture path this drain was originally built for.
//     The LLM still makes the build-vs-needs-human call in both cases.
//
// The Inngest wrapper (apps/web/lib/queue/functions/backlog-triage-drain.ts)
// supplies prisma + the LLM caller; this module stays pure and unit-testable.

export const AUTO_TRIAGE_CONFIDENCE_THRESHOLD = 0.8;
const VALID_EFFORT_SIZES = new Set(["small", "medium", "large", "xlarge"]);

export type TriageCandidate = {
  itemId: string;
  title: string;
  body?: string | null;
  type?: string | null;
  workType?: string | null;
  /**
   * Author-provided effort size, if any. Preserved by the drain — a valid value
   * here is used verbatim on auto-build and is never overwritten by the LLM's
   * re-estimate (BI-TRIAGE-SIZE-OVERWRITE).
   */
  effortSize?: string | null;
  /** Author's advisory proposed outcome; passed to the LLM as a non-binding prior. */
  proposedOutcome?: string | null;
};

export type TriageDecision = {
  /** "build" is the only auto-applied outcome; anything else defers to a human. */
  outcome: string;
  effortSize?: string;
  confidence?: number;
  rationale?: string;
};

export type TriageDrainResult = {
  considered: number;
  autoBuilt: number;
  leftForOperator: number;
};

export const TRIAGE_DRAIN_SYSTEM_PROMPT =
  "You are a delivery-flow triage assistant draining a backlog's triaging queue. " +
  "You only auto-decide items that are UNAMBIGUOUSLY real, scoped, buildable work. " +
  "If an item is noise, a likely duplicate, stale, optional, vague, or you are at all unsure, " +
  "you defer it to a human instead of guessing. Respond with ONLY a JSON object.";

/** Build the per-item decision prompt. */
export function buildTriageDrainPrompt(item: TriageCandidate): string {
  const body = (item.body ?? "").toString().slice(0, 1200);

  // Author-provided priors (non-binding). They inform the build-vs-needs-human
  // judgment; the author's effortSize is preserved by the platform, so the model
  // does not need to re-estimate size when one is shown.
  const priors: string[] = [];
  if (typeof item.effortSize === "string" && item.effortSize.trim()) {
    priors.push(`AUTHOR_EFFORT_SIZE (prior, non-binding, preserved by the platform): ${item.effortSize.trim()}`);
  }
  if (typeof item.proposedOutcome === "string" && item.proposedOutcome.trim()) {
    priors.push(`AUTHOR_PROPOSED_OUTCOME (prior, non-binding): ${item.proposedOutcome.trim()}`);
  }
  const priorBlock = priors.length ? `${priors.join("\n")}\n` : "";

  return `Decide how to triage this backlog item.

ITEM: ${item.itemId}
TITLE: ${item.title}
TYPE: ${item.type ?? "unknown"} / ${item.workType ?? "unspecified"}
${priorBlock}${body ? `DETAIL:\n${body}\n` : ""}
Return ONLY this JSON (no prose, no fences):
{
  "outcome": "build" | "needs-human",
  "effortSize": "small" | "medium" | "large" | "xlarge",
  "confidence": 0.0-1.0,
  "rationale": "<one concise sentence>"
}

Choose "build" ONLY when the item is clearly real, scoped engineering/product work and you can size it confidently. For ANY noise, duplicate, stale/optional item, vague request, or uncertainty, choose "needs-human" (a human will decide defer/discard/duplicate). effortSize is required when outcome is "build" — but when an AUTHOR_EFFORT_SIZE prior is shown, treat it as the author's deliberate estimate (the platform keeps it; do not re-estimate the size) and focus your judgment on build vs needs-human.`;
}

/** Parse the model's JSON decision; tolerant of markdown fences. Returns null on failure. */
export function parseTriageDecision(content: string): TriageDecision | null {
  if (!content || typeof content !== "string") return null;
  const stripped = content.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  // Grab the first balanced-looking JSON object if there's surrounding text.
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof obj.outcome !== "string") return null;
  return {
    outcome: obj.outcome,
    effortSize: typeof obj.effortSize === "string" ? obj.effortSize : undefined,
    confidence: typeof obj.confidence === "number" ? obj.confidence : undefined,
    rationale: typeof obj.rationale === "string" ? obj.rationale : undefined,
  };
}

/** The author's pre-existing effortSize when it is a valid size; otherwise null. */
export function authorEffortSize(item?: TriageCandidate | null): string | null {
  const size = item?.effortSize;
  return typeof size === "string" && VALID_EFFORT_SIZES.has(size) ? size : null;
}

/**
 * The auto-apply gate. Returns the effortSize to apply when the decision is a
 * confident BUILD; otherwise null (leave for a human).
 *
 * Author intent is preserved (BI-TRIAGE-SIZE-OVERWRITE): when the item already
 * carries a valid author-provided effortSize, THAT size is returned and the
 * LLM's blind re-estimate is ignored — the drain must never overwrite a
 * deliberate author size. The LLM-decided size is only a fallback for items
 * captured with no size (the autonomous-capture path), which still require a
 * size to enter the build pool. The author size never bypasses the build /
 * confidence gate: a needs-human or low-confidence decision still defers.
 */
export function autoApplyBuildSize(
  decision: TriageDecision | null,
  item?: TriageCandidate | null,
): string | null {
  if (!decision) return null;
  if (decision.outcome !== "build") return null;
  if ((decision.confidence ?? 0) < AUTO_TRIAGE_CONFIDENCE_THRESHOLD) return null;
  // Preserve a valid author-provided size; never clobber it with a re-estimate.
  const authored = authorEffortSize(item);
  if (authored) return authored;
  // Autonomous-capture fallback: items filed with no size get the LLM's size.
  if (typeof decision.effortSize === "string" && VALID_EFFORT_SIZES.has(decision.effortSize)) {
    return decision.effortSize;
  }
  return null;
}

export type TriageDrainDeps = {
  /** Fetch a bounded batch of items currently in the triaging queue. */
  getTriagingItems: () => Promise<TriageCandidate[]>;
  /** Ask the LLM for a decision; return raw text. Throwing is treated as "skip item". */
  decide: (item: TriageCandidate) => Promise<string>;
  /** Apply a confident build decision (status→open, triageOutcome=build, effortSize, resolution). */
  applyBuild: (itemId: string, effortSize: string, rationale: string) => Promise<void>;
  /**
   * Record the decision to the governance ledger BEFORE it is applied
   * (BI-BB2E585C). Resolving false (or throwing) blocks the mutation and leaves
   * the item for a human — fail-closed, because the ledger row is the only
   * evidence the auto-mutation was governed at all.
   *
   * Optional so existing callers/tests compile; omitting it means the mutation
   * proceeds unledgered, which is the defect. `triageOneItem` warns loudly when
   * it is absent so the omission cannot be silent.
   */
  recordDecision?: (
    item: TriageCandidate,
    decision: TriageDecision,
    appliedEffortSize: string,
  ) => Promise<boolean>;
};

/** Outcome of triaging a single item — the unit the scheduled drain accounts by. */
export type TriageItemOutcome = "auto-built" | "left-for-operator";

/**
 * Triage one item: get a decision and auto-apply only a confident BUILD outcome.
 * Anything else (or any failure) leaves the item for a human. Never throws — a
 * bad decide() or applyBuild() resolves to "left-for-operator".
 *
 * Pulled out of runBacklogTriageDrain so the Inngest wrapper can run each item
 * in its own step: one item = one HTTP round-trip, so a single slow LLM call
 * can't hold the whole batch open past Inngest's response-header timeout — the
 * failure mode that spun this function into duplicate-span / run-not-found
 * retry storms (BI-C8164664 context).
 */
export async function triageOneItem(
  item: TriageCandidate,
  deps: Pick<TriageDrainDeps, "decide" | "applyBuild" | "recordDecision">,
): Promise<TriageItemOutcome> {
  let decision: TriageDecision | null = null;
  try {
    decision = parseTriageDecision(await deps.decide(item));
  } catch {
    decision = null;
  }
  const size = autoApplyBuildSize(decision, item);
  if (!size || !decision) return "left-for-operator";

  // Ledger BEFORE mutating (BI-BB2E585C). Fail-closed: an unrecordable decision
  // is not applied, so the ledger can never understate what the drain changed.
  if (deps.recordDecision) {
    let recorded = false;
    try {
      recorded = await deps.recordDecision(item, decision, size);
    } catch {
      recorded = false;
    }
    if (!recorded) return "left-for-operator";
  } else {
    console.warn(
      `[backlog-triage-drain] ${item.itemId}: applying a build decision with NO governance ledger — ` +
        "recordDecision dep is missing (BI-BB2E585C)",
    );
  }

  try {
    await deps.applyBuild(
      item.itemId,
      size,
      `Auto-triaged by scheduled drain: ${(decision.rationale ?? "confident build").slice(0, 400)}`,
    );
    return "auto-built";
  } catch {
    return "left-for-operator";
  }
}

/**
 * Drain the triaging queue: for each item, get a decision and auto-apply only
 * confident BUILD outcomes. Everything else is left for a human. Never throws
 * for a single bad item — it skips and continues.
 */
export async function runBacklogTriageDrain(deps: TriageDrainDeps): Promise<TriageDrainResult> {
  const items = await deps.getTriagingItems();
  if (items.length === 0) return { considered: 0, autoBuilt: 0, leftForOperator: 0 };

  let autoBuilt = 0;
  let leftForOperator = 0;

  for (const item of items) {
    if ((await triageOneItem(item, deps)) === "auto-built") autoBuilt++;
    else leftForOperator++;
  }

  return { considered: items.length, autoBuilt, leftForOperator };
}
