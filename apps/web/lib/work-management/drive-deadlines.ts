/**
 * Stage deadlines on the graph drive (BI-8875C9DF, GPP Phase 3c PR-3c-4).
 *
 * Design: docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
 * §8 (deadlines), §6.3; plan:
 * docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
 * (PR-3c-4, drive-marking.ts / drive-resolution-graph.ts).
 *
 * Pure. Kept beside drive-marking.ts rather than inside it, so the token step
 * stays one statement of the token game: a deadline never changes the
 * marking's tokens (parent §6.1 rule 8, "timers never change M"), so nothing
 * here touches `tokens`, `iterations` or `reworkTaken`.
 *
 * - CLOCK. The drive tick (the 15-minute cron plus run-now) is the clock. A
 *   token on stage `s` is overdue when `now ≥ enteredAt + s.deadline.afterDays`
 *   days. No scheduler or timer service is added.
 * - KEY. `<cycleKey>#<stageKey>#<iteration>`. A rework starts a new iteration
 *   with a fresh `enteredAt`, so it can owe a new notice; a new cycle starts a
 *   fresh marking, so the same stage can be noticed again next cycle; the same
 *   cycle and iteration never raise twice.
 * - RAISE (raiseDueDeadlines). An overdue token whose key is not yet in
 *   `marking.deadlines` gets `{ raisedAt: now, notifiedAt: null }`. That is the
 *   whole effect on the marking. Expiry never moves work: the token stays, and
 *   nothing routes it to a refuse route or a stop (design §8, Q3).
 * - NOTICE (unnotifiedDeadlines, withDeadlinesNotified). The runner tells the
 *   escalation target on the tick AFTER the entry is committed, and writes
 *   `notifiedAt` only when the send succeeded, so a failed send retries next
 *   tick and a successful one never repeats (at least once).
 * - OPEN (openDeadlines). The entries whose token is still on that stage at
 *   that iteration in that cycle: what the attention inbox lists.
 */
import { stageElementId } from "@/lib/gpp/shape-language/element-ids";

import { iterationOf, stageToken, type DriveMarking } from "./drive-marking";
import type { WorkShapeDefinitionContract } from "./work-shapes";

export const DAY_MS = 86_400_000;

type DeadlineShape = Pick<WorkShapeDefinitionContract, "stages">;
type DeadlineStage = DeadlineShape["stages"][number];

/** The notice key for one pass through one stage in one cycle. */
export function deadlineKey(cycleKey: string, stageKey: string, iteration: number): string {
  return `${cycleKey}#${stageKey}#${iteration}`;
}

/** The stage key and iteration a notice key names, or null when it is not one. The cycle key may itself hold `#`. */
export function parseDeadlineKey(key: string): { cycleKey: string; stageKey: string; iteration: number } | null {
  const last = key.lastIndexOf("#");
  const middle = last > 0 ? key.lastIndexOf("#", last - 1) : -1;
  if (middle < 0) return null;
  const iteration = Number(key.slice(last + 1));
  if (!Number.isInteger(iteration) || iteration < 0) return null;
  return { cycleKey: key.slice(0, middle), stageKey: key.slice(middle + 1, last), iteration };
}

/** Who an overdue stage is escalated to: the gate's escalation role, else the stage's accountable principal (design §8). */
export function deadlineEscalationRef(stage: DeadlineStage): string {
  const gate = stage.advance.kind === "governed-decision" ? stage.advance.gate : undefined;
  return gate?.escalation?.role ?? stage.accountablePrincipalRef;
}

export type DueDeadline = {
  key: string;
  stageKey: string;
  stageTitle: string;
  iteration: number;
  description: string;
  afterDays: number;
  enteredAt: string;
  /** enteredAt + afterDays. */
  dueAt: string;
  /** How far past `dueAt` the tick is, in milliseconds (0 when exactly due). */
  overdueMs: number;
  escalationRef: string;
};

function describe(stage: DeadlineStage, marking: DriveMarking, now: Date): DueDeadline | null {
  const deadline = stage.deadline;
  const token = stageToken(marking, stage.key);
  if (!deadline || !token) return null;
  const entered = Date.parse(token.enteredAt);
  if (!Number.isFinite(entered) || !Number.isFinite(deadline.afterDays)) return null;
  const due = entered + deadline.afterDays * DAY_MS;
  const iteration = iterationOf(marking, stage.key);
  return {
    key: deadlineKey(marking.cycleKey, stage.key, iteration),
    stageKey: stage.key,
    stageTitle: stage.title,
    iteration,
    description: deadline.description,
    afterDays: deadline.afterDays,
    enteredAt: token.enteredAt,
    dueAt: new Date(due).toISOString(),
    overdueMs: Math.max(0, now.getTime() - due),
    escalationRef: deadlineEscalationRef(stage),
  };
}

/** The marked stages, in document order, that are overdue at `now` and owe a notice not yet raised. */
export function overdueDeadlines(definition: DeadlineShape, marking: DriveMarking, now: Date): DueDeadline[] {
  const out: DueDeadline[] = [];
  for (const stage of definition.stages) {
    const due = describe(stage, marking, now);
    if (!due || now.getTime() < Date.parse(due.dueAt) || Object.hasOwn(marking.deadlines, due.key)) continue;
    out.push(due);
  }
  return out;
}

/** The marking with every overdue notice raised (`notifiedAt: null`), and what was raised. Tokens are untouched. */
export function raiseDueDeadlines(definition: DeadlineShape, marking: DriveMarking, now: Date): { marking: DriveMarking; raised: DueDeadline[] } {
  const raised = overdueDeadlines(definition, marking, now);
  if (raised.length === 0) return { marking, raised };
  const deadlines = { ...marking.deadlines };
  for (const due of raised) deadlines[due.key] = { raisedAt: now.toISOString(), notifiedAt: null };
  return { marking: { ...marking, deadlines }, raised };
}

export type PendingDeadlineNotice = {
  key: string;
  stageKey: string;
  stageTitle: string;
  iteration: number;
  description: string;
  afterDays: number;
  raisedAt: string;
  escalationRef: string;
};

/** Raised notices not yet sent, in key order. A key naming no stage of the definition is skipped. */
export function unnotifiedDeadlines(definition: DeadlineShape, marking: DriveMarking): PendingDeadlineNotice[] {
  const out: PendingDeadlineNotice[] = [];
  for (const key of Object.keys(marking.deadlines).sort()) {
    const entry = marking.deadlines[key]!;
    const parsed = parseDeadlineKey(key);
    const stage = parsed ? definition.stages.find((candidate) => candidate.key === parsed.stageKey) : undefined;
    if (entry.notifiedAt !== null || !parsed || !stage) continue;
    out.push({
      key,
      stageKey: stage.key,
      stageTitle: stage.title,
      iteration: parsed.iteration,
      description: stage.deadline?.description ?? "",
      afterDays: stage.deadline?.afterDays ?? 0,
      raisedAt: entry.raisedAt,
      escalationRef: deadlineEscalationRef(stage),
    });
  }
  return out;
}

/** The marking with `notifiedAt` written for each key that is present and still unsent. */
export function withDeadlinesNotified(marking: DriveMarking, keys: readonly string[], now: Date): DriveMarking {
  const deadlines = { ...marking.deadlines };
  let changed = false;
  for (const key of keys) {
    const entry = deadlines[key];
    if (!entry || entry.notifiedAt !== null) continue;
    deadlines[key] = { ...entry, notifiedAt: now.toISOString() };
    changed = true;
  }
  return changed ? { ...marking, deadlines } : marking;
}

/**
 * The raised notices whose token is still on that stage, at that iteration,
 * in the marking's own cycle: the stages that are past their deadline now.
 * In document order, one per stage.
 */
export function openDeadlines(definition: DeadlineShape, marking: DriveMarking): Array<{ key: string; stageKey: string; stageTitle: string; description: string; raisedAt: string }> {
  const out: Array<{ key: string; stageKey: string; stageTitle: string; description: string; raisedAt: string }> = [];
  for (const stage of definition.stages) {
    if (!marking.tokens.some((token) => token.node === stageElementId(stage.key) && token.from === undefined)) continue;
    const key = deadlineKey(marking.cycleKey, stage.key, iterationOf(marking, stage.key));
    const entry = marking.deadlines[key];
    if (!entry) continue;
    out.push({ key, stageKey: stage.key, stageTitle: stage.title, description: stage.deadline?.description ?? "", raisedAt: entry.raisedAt });
  }
  return out;
}
