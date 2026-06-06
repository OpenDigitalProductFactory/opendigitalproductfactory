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
  return `Decide how to triage this backlog item.

ITEM: ${item.itemId}
TITLE: ${item.title}
TYPE: ${item.type ?? "unknown"} / ${item.workType ?? "unspecified"}
${body ? `DETAIL:\n${body}\n` : ""}
Return ONLY this JSON (no prose, no fences):
{
  "outcome": "build" | "needs-human",
  "effortSize": "small" | "medium" | "large" | "xlarge",
  "confidence": 0.0-1.0,
  "rationale": "<one concise sentence>"
}

Choose "build" ONLY when the item is clearly real, scoped engineering/product work and you can size it confidently. For ANY noise, duplicate, stale/optional item, vague request, or uncertainty, choose "needs-human" (a human will decide defer/discard/duplicate). effortSize is required when outcome is "build".`;
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

/**
 * The auto-apply gate. Returns the effortSize to apply when the decision is a
 * confident, well-formed BUILD; otherwise null (leave for a human).
 */
export function autoApplyBuildSize(decision: TriageDecision | null): string | null {
  if (!decision) return null;
  if (decision.outcome !== "build") return null;
  if (typeof decision.effortSize !== "string" || !VALID_EFFORT_SIZES.has(decision.effortSize)) return null;
  if ((decision.confidence ?? 0) < AUTO_TRIAGE_CONFIDENCE_THRESHOLD) return null;
  return decision.effortSize;
}

export type TriageDrainDeps = {
  /** Fetch a bounded batch of items currently in the triaging queue. */
  getTriagingItems: () => Promise<TriageCandidate[]>;
  /** Ask the LLM for a decision; return raw text. Throwing is treated as "skip item". */
  decide: (item: TriageCandidate) => Promise<string>;
  /** Apply a confident build decision (status→open, triageOutcome=build, effortSize, resolution). */
  applyBuild: (itemId: string, effortSize: string, rationale: string) => Promise<void>;
};

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
    let decision: TriageDecision | null = null;
    try {
      decision = parseTriageDecision(await deps.decide(item));
    } catch {
      decision = null;
    }
    const size = autoApplyBuildSize(decision);
    if (size) {
      try {
        await deps.applyBuild(
          item.itemId,
          size,
          `Auto-triaged by scheduled drain: ${(decision?.rationale ?? "confident build").slice(0, 400)}`,
        );
        autoBuilt++;
      } catch {
        leftForOperator++;
      }
    } else {
      leftForOperator++;
    }
  }

  return { considered: items.length, autoBuilt, leftForOperator };
}
