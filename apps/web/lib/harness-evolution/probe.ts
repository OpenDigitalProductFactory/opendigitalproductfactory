// The harness evolution probe (BI-B8DAEB71, slice 2; spec
// docs/superpowers/specs/2026-10-28-harness-evolution-loop-design.md).
//
// A room's candidate is replayed baseline-versus-variant on the room's own
// recorded tool trace. Each variant is a deterministic model of one edit,
// applied to the same calls. Every replay is measured on three axes:
//   1. outcome — intents completed;
//   2. load per rung — human units, AI units, code-carried units (the ladder
//      the founder wants load to move down: human → AI → code);
//   3. gate burden — refusals per success, recovery turns, and whether a
//      refusal named the exact next call (the GPP wrinkle).
// Pure and hermetic: no network, no model call, no grader. The trace is real
// recorded data, which is the real-data check of the edit's model; an edit
// that moves load into code still owes a real-host check of the code itself.

import { createHash } from "crypto";

/** Refusal codes that mean "no authority for this action". Mirrors room-candidates.ts. */
const PERMIT_GAP_CODES = new Set(["authority_denied", "approval_required", "permission_denied", "grant_missing", "workroom_access_denied"]);
/** An approval card is routed to a person for this code. */
const HUMAN_ROUTED_CODES = new Set(["approval_required"]);

export type TraceCall = {
  id: string;
  threadId: string;
  toolName: string;
  success: boolean;
  errorCode: string | null;
  namesNextCall: boolean;
  tokens: number;
  at: Date;
  /** Who made the turn (room-candidates.ts executorOf); absent in pre-executor fixtures. */
  executor?: string;
  /** Set by a variant: resolved inside the tool with no model turn. */
  resolvedInCode?: boolean;
};

export type ProbeTarget = { toolName: string; code: string };

export type Assessment = {
  outcome: { intents: number; completed: number; completionRate: number };
  load: { human: number; ai: number; code: number; tokens: number };
  gate: { refusals: number; successes: number; refusalsPerSuccess: number; recoveryTurns: number; namedNextCallShare: number };
};

/** A refusal names the next call when it carries a structured next step or names another tool. */
export function refusalNamesNextCall(input: { toolName: string; data: unknown; message: string | null }): boolean {
  const data = input.data && typeof input.data === "object" ? (input.data as Record<string, unknown>) : {};
  if ("nextAction" in data || "recovery" in data) return true;
  const named = (input.message ?? "").match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];
  return named.some((name) => name !== input.toolName);
}

/** Split a trace into intents: per thread, a run of calls that a success closes. */
function intentsOf(calls: readonly TraceCall[]): TraceCall[][] {
  const byThread = new Map<string, TraceCall[]>();
  for (const call of [...calls].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id))) {
    const list = byThread.get(call.threadId);
    if (list) list.push(call);
    else byThread.set(call.threadId, [call]);
  }
  const intents: TraceCall[][] = [];
  for (const threadId of [...byThread.keys()].sort()) {
    let current: TraceCall[] = [];
    for (const call of byThread.get(threadId)!) {
      current.push(call);
      if (call.success) {
        intents.push(current);
        current = [];
      }
    }
    if (current.length) intents.push(current);
  }
  return intents;
}

function measureIntents(intents: readonly TraceCall[][], extraHuman: number): Assessment {
  let completed = 0;
  let ai = 0;
  let code = 0;
  let tokens = 0;
  let refusals = 0;
  let successes = 0;
  let named = 0;
  let recoveryTurns = 0;
  let human = extraHuman;
  for (const intent of intents) {
    if (intent[intent.length - 1]?.success) completed += 1;
    const firstRefusal = intent.findIndex((c) => !c.success && !c.resolvedInCode);
    if (firstRefusal >= 0) recoveryTurns += intent.length - 1 - firstRefusal;
    for (const call of intent) {
      if (call.resolvedInCode) {
        code += 1;
        continue;
      }
      ai += 1;
      tokens += call.tokens;
      if (call.success) successes += 1;
      else {
        refusals += 1;
        if (call.namesNextCall) named += 1;
        if (call.errorCode && HUMAN_ROUTED_CODES.has(call.errorCode)) human += 1;
      }
    }
  }
  return {
    outcome: { intents: intents.length, completed, completionRate: intents.length ? completed / intents.length : 0 },
    load: { human, ai, code, tokens },
    gate: {
      refusals,
      successes,
      refusalsPerSuccess: refusals / Math.max(successes, 1),
      recoveryTurns,
      namedNextCallShare: refusals ? named / refusals : 0,
    },
  };
}

/** Measure the recorded trace for the candidate's tool family. */
export function measureTrace(trace: readonly TraceCall[], target: ProbeTarget, context: { humanEvents: number }): Assessment {
  return measureIntents(intentsOf(trace.filter((c) => c.toolName === target.toolName)), context.humanEvents);
}

export type Judgement = { pass: boolean; reasons: string[] };

/** The decision rules: human load never rises; outcome never falls; load moves down the ladder or the edit earns nothing. */
export function judgeVariant(baseline: Assessment, candidate: Assessment): Judgement {
  if (candidate.load.human > baseline.load.human) return { pass: false, reasons: ["raises-human-load"] };
  const reasons: string[] = [];
  const outcomeGain = candidate.outcome.completionRate - baseline.outcome.completionRate;
  if (outcomeGain < 0) reasons.push("lowers-outcome");
  if (candidate.gate.refusalsPerSuccess > baseline.gate.refusalsPerSuccess && outcomeGain <= 0) {
    reasons.push("raises-gate-burden-without-gain");
  }
  if (candidate.load.code < baseline.load.code && candidate.load.ai > baseline.load.ai) reasons.push("moves-load-up");
  const movedDown = candidate.load.human < baseline.load.human || candidate.load.ai < baseline.load.ai;
  if (!reasons.length && outcomeGain <= 0 && !movedDown) reasons.push("no-gain");
  return { pass: reasons.length === 0, reasons };
}

export type VariantKey = "in-tool-resolution" | "named-next-call" | "gpp-permit";

/** Preference between gates of equal outcome: inside the tool, then a named next call, then a permit. */
export const VARIANT_PREFERENCE: readonly VariantKey[] = ["in-tool-resolution", "named-next-call", "gpp-permit"];

export type VariantProbe = {
  variantKey: VariantKey;
  pairKey: string;
  assessment: Assessment;
  judgement: Judgement;
  /** An edit that moves load into code must be checked against the real host before it lands. */
  encodedRuleCheck: "required-on-real-host" | "not-applicable";
};

export type CandidateProbe = {
  target: ProbeTarget;
  baseline: { pairKey: string; assessment: Assessment };
  variants: VariantProbe[];
  /** Baseline plus one replay per variant: what the run's maxProbeReplays counts. */
  replays: number;
  traceCalls: number;
  /** Target refusals per executor in the trace: which executor layer the edit belongs to. */
  executors: Record<string, number>;
};

const isTargetRefusal = (call: TraceCall, target: ProbeTarget) => !call.success && call.errorCode === target.code;

/** Rewrite each intent that met the target refusal; intents without it are untouched. */
function applyVariant(intents: readonly TraceCall[][], target: ProbeTarget, rewrite: (intent: TraceCall[]) => TraceCall[]): TraceCall[][] {
  return intents.map((intent) => (intent.some((c) => isTargetRefusal(c, target)) ? rewrite(intent) : intent));
}

function succeeded(call: TraceCall): TraceCall {
  return { ...call, success: true, errorCode: null, namesNextCall: false };
}

export function probeCandidate(input: {
  trace: readonly TraceCall[];
  target: ProbeTarget;
  humanEvents: number;
  /** False while GPP permits are minted by an approval (BI-6B610D94): each grant then costs a person. */
  gppPermitsSteer: boolean;
}): CandidateProbe {
  const family = input.trace.filter((c) => c.toolName === input.target.toolName);
  const intents = intentsOf(family);
  const pairKey = `HEP-${createHash("sha256")
    .update(`${input.target.toolName}|${input.target.code}|${family.map((c) => c.id).sort().join(",")}`)
    .digest("hex")
    .slice(0, 16)}`;
  const baseline = measureIntents(intents, input.humanEvents);
  const affected = intents.filter((intent) => intent.some((c) => isTargetRefusal(c, input.target))).length;

  const models: Array<{ key: VariantKey; intents: TraceCall[][]; extraHuman: number }> = [
    {
      // The tool resolves, expands or rewrites the input itself: one AI turn succeeds, each refusal becomes code.
      key: "in-tool-resolution",
      intents: applyVariant(intents, input.target, (intent) => {
        const first = intent[0]!;
        const resolved = intent.filter((c) => isTargetRefusal(c, input.target)).map((c) => ({ ...c, resolvedInCode: true }));
        return [...resolved, succeeded(first)];
      }),
      extraHuman: 0,
    },
    {
      // The refusal names the exact next call: one refusal, then one call. An intent that never succeeded still does not.
      key: "named-next-call",
      intents: applyVariant(intents, input.target, (intent) => {
        const refusal = { ...intent.find((c) => isTargetRefusal(c, input.target))!, namesNextCall: true };
        const done = intent[intent.length - 1]!.success;
        return done ? [refusal, intent[intent.length - 1]!] : [refusal];
      }),
      extraHuman: 0,
    },
  ];
  if (PERMIT_GAP_CODES.has(input.target.code)) {
    models.push({
      // A narrow permit lets the call through. Until permits steer, each single-use grant is minted by a person's approval.
      key: "gpp-permit",
      intents: applyVariant(intents, input.target, (intent) => [succeeded(intent[0]!)]),
      extraHuman: input.gppPermitsSteer ? 0 : affected,
    });
  }

  const variants = models.map(({ key, intents: replayed, extraHuman }) => {
    const assessment = measureIntents(replayed, input.humanEvents + extraHuman);
    return {
      variantKey: key,
      pairKey,
      assessment,
      judgement: judgeVariant(baseline, assessment),
      encodedRuleCheck: assessment.load.code > baseline.load.code ? ("required-on-real-host" as const) : ("not-applicable" as const),
    };
  });
  const executors: Record<string, number> = {};
  for (const call of family) {
    if (!isTargetRefusal(call, input.target)) continue;
    const name = call.executor ?? "unknown";
    executors[name] = (executors[name] ?? 0) + 1;
  }
  return {
    target: input.target,
    baseline: { pairKey, assessment: baseline },
    variants,
    replays: 1 + variants.length,
    traceCalls: family.length,
    executors: Object.fromEntries(Object.entries(executors).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export type ScopeOption = { id: string; description: string; features: Record<string, number> };

const VARIANT_DESCRIPTIONS: Record<VariantKey, string> = {
  "in-tool-resolution": "Change the tool so it resolves, expands or rewrites the input itself instead of refusing it.",
  "named-next-call": "Keep the refusal but make it name the exact next call that recovers.",
  "gpp-permit": "Grant a narrow GPP permit for this specific action in this room.",
};

/**
 * The options the owning scope scores (WWMD / WWWD / WSID), with features
 * measured by the probe rather than asserted. Costs are high-is-worse.
 */
export function buildScopeOptions(probe: CandidateProbe): ScopeOption[] {
  const all = [{ id: "keep-base", assessment: probe.baseline.assessment }, ...probe.variants.map((v) => ({ id: v.variantKey, assessment: v.assessment }))];
  const maxHuman = Math.max(1, ...all.map((o) => o.assessment.load.human));
  const maxAi = Math.max(1, ...all.map((o) => o.assessment.load.ai));
  const evidence = Math.min(1, probe.baseline.assessment.outcome.intents / 10);
  return all.map(({ id, assessment }) => ({
    id,
    description: id === "keep-base"
      ? `Keep the harness unchanged for ${probe.target.toolName} refused ${probe.target.code}.`
      : VARIANT_DESCRIPTIONS[id as VariantKey],
    features: {
      human_cognitive_load: assessment.load.human / maxHuman,
      operator_effort: assessment.load.ai / maxAi,
      speed_to_value: assessment.outcome.completionRate,
      evidence_density: evidence,
      reversibility: 1,
    },
  }));
}
