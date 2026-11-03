// BI-FEDD8F45 — GPP §11 efficacy measures and guard efficacy measures, pure.
// Design: docs/superpowers/specs/2026-10-14-guard-outcome-efficacy-design.md §4.6, §5.1.
//
// GPP §11: "Measures MUST be computed from execution and decision records, not
// from configuration. A published measure MUST state what it omits." So every
// measure carries its numerator, its denominator, its unit and its omissions,
// and a measure DPF's records cannot answer is `null` with the reason, never
// zero. Where the records answer only part of the question, the full measure is
// null and the part is published beside it as a named subset proxy.

export type MeasureUnit = "share" | "decisions/effect" | "count";

export type Measure = {
  id: string;
  label: string;
  numerator: number | null;
  denominator: number | null;
  value: number | null;
  unit: MeasureUnit;
  omits: string;
};

export type GuardMeasureRow = {
  guardId: string;
  runs: number;
  refusals: number;
  caught: number;
  falseRefusals: number;
  overridden: number;
  unresolved: number;
  unresolvedByReason: Record<string, number>;
  totalDurationMs: number;
  medianDurationMs: number;
};

/** CoworkerActionEnvelope population created in the period, by stored status. */
export type EnvelopeCounts = {
  proposed: number;
  approved: number;
  executed: number;
  declined: number;
  failed: number;
  expired: number;
  cancelled: number;
};

export type EfficacyMeasureInputs = {
  period: { from: Date; to: Date };
  permits: {
    total: number;
    enforcedValid: number;
    perAgent: ReadonlyArray<{ agent: string; total: number; enforcedValid: number }>;
  };
  consequentialEffects: number;
  decisions: {
    total: number;
    humanResolved: number;
    agentResolved: number;
    escalated: number;
    held: number;
    admitted: number;
    admittedHumanChoice: number;
    admittedAgentChoice: number;
  };
  envelopes: EnvelopeCounts;
  authorization: {
    total: number;
    denied: number;
    deniedByAction: Readonly<Record<string, number>>;
    enforcedPermitRefusals: number;
  };
  shadow: { withExecution: number; divergentSucceeded: number };
  guards: readonly GuardMeasureRow[];
};

type GuardMeasures = {
  guardId: string;
  catchRate: Measure;
  falseRefusalRate: Measure;
  overrideRate: Measure;
  undecidedShare: Measure;
  runs: number;
  totalDurationMs: number;
  medianDurationMs: number;
  unresolvedByReason: Record<string, number>;
};

export type EfficacyReport = {
  period: { from: Date; to: Date };
  gpp: Measure[];
  /** Named subset proxies for measures whose full form is unknown. */
  proxies: Measure[];
  /** The actual approval-request population: what a person was asked. */
  approvalLoad: Measure[];
  m1PerAgent: Measure[];
  m3Mix: Measure[];
  m4ByAction: Measure[];
  guards: GuardMeasures[];
};

/** Published beside G-1/G-2 and in retirement review items (design §4.3, §5.1). */
export const PAIRING_PROXY_LIMITATION =
  "These are pairing labels, not causal findings: \"caught\" means the patch changed while the guard and base stayed fixed, and that change may be unrelated to the refusal; \"false refusal\" means the guard changed while the patch stayed fixed, which does not prove the earlier refusal was wrong.";

const GUARD_COVERAGE_OMITS =
  "Refusals still inside their 14-day window; runs from CI and from clones that never submitted; quarantined records.";

export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function measure(id: string, label: string, numerator: number, denominator: number, omits: string, unit: MeasureUnit = "share"): Measure {
  return { id, label, numerator, denominator, value: ratio(numerator, denominator), unit, omits };
}

function unknown(id: string, label: string, unit: MeasureUnit, omits: string): Measure {
  return { id, label, numerator: null, denominator: null, value: null, unit, omits };
}

function count(id: string, label: string, n: number): Measure {
  return { id, label, numerator: n, denominator: null, value: n, unit: "count", omits: "" };
}

export function computeEfficacyMeasures(input: EfficacyMeasureInputs): EfficacyReport {
  const { permits, decisions, authorization, shadow, envelopes } = input;
  const gpp: Measure[] = [
    measure(
      "M-1",
      "Gate coverage (call-based proxy)",
      permits.enforcedValid,
      permits.total,
      "GPP §11 asks about reachable tools; this counts consequential calls, so tools never called are absent. Direct-path calls carry no agent. Every permit binding is shadow until one is promoted, so the value is 0 until then.",
    ),
    unknown(
      "M-2",
      "Human decisions per consequential effect",
      "decisions/effect",
      "Unknown: approval requests, kernel decisions and effects are not yet linked by distinct identity, so they cannot be summed without double counting. See the kernel-only subset proxy (M-2a) and the approval load beside it.",
    ),
    measure(
      "M-3",
      "Resolution mix: human share",
      decisions.humanResolved,
      decisions.total,
      "GPP §11 asks about gate resolutions; this measures kernel decisions, a subset. The full mix is listed separately.",
    ),
    measure(
      "M-4",
      "Refusals before effect",
      authorization.denied + authorization.enforcedPermitRefusals,
      authorization.total + authorization.enforcedPermitRefusals,
      "GPP §11 asks for reason codes; the authorization log stores none, so refusals are grouped by action. Refusals inside tool handlers that are not logged are absent.",
    ),
    unknown(
      "M-5",
      "Unauthorized or unintended effects",
      "count",
      "Not measurable: no record marks an executed effect as later unauthorized or unintended. A missing failure label is not evidence of an intended effect.",
    ),
    measure(
      "M-6",
      "Shadow divergence",
      shadow.divergentSucceeded,
      shadow.withExecution,
      "Counts shadow verdicts that would have refused a call that then succeeded. Calls the Workroom shape gate never observes (BI-10501365) and direct-path calls without an execution row are absent.",
    ),
    unknown(
      "M-7",
      "Decision outcome linkage (observed outcomes)",
      "share",
      "Unknown: no typed observation links an admitted decision to its observed effect. A recorded choice is not an observed outcome; see the choice-linkage proxies (M-7a, M-7b).",
    ),
  ];

  const proxies: Measure[] = [
    measure(
      "M-2a",
      "Kernel human decisions per consequential effect (subset proxy)",
      decisions.humanResolved,
      input.consequentialEffects,
      "Kernel-ledger decisions resolved by a human only. Portal approvals, human checkpoints and envelope approvals are not in it: never read a low value as few approvals.",
      "decisions/effect",
    ),
    measure("M-7a", "Admitted decisions with a human-recorded choice", decisions.admittedHumanChoice, decisions.admitted, "A choice, not an observed result."),
    measure("M-7b", "Admitted decisions with an agent-reported choice", decisions.admittedAgentChoice, decisions.admitted, "Agent-reported; not independently observed."),
  ];

  const envelopeTotal = Object.values(envelopes).reduce((sum, n) => sum + n, 0);
  const approvalLoad: Measure[] = [
    count("envelopes:total", "Approval requests created", envelopeTotal),
    count("envelopes:waiting", "Waiting for a person", envelopes.proposed),
    count("envelopes:approved", "Approved, not yet run", envelopes.approved),
    count("envelopes:executed", "Approved and run", envelopes.executed),
    count("envelopes:declined", "Declined", envelopes.declined),
    count("envelopes:failed", "Approved but failed", envelopes.failed),
    count("envelopes:expired", "Expired unanswered", envelopes.expired),
    count("envelopes:cancelled", "Cancelled", envelopes.cancelled),
  ];

  const m1PerAgent = [...permits.perAgent]
    .sort((a, b) => b.total - a.total || a.agent.localeCompare(b.agent))
    .map((row) => measure(`M-1:${row.agent}`, row.agent, row.enforcedValid, row.total, ""));

  const doctrineOnly = Math.max(0, decisions.total - decisions.humanResolved - decisions.escalated - decisions.held);
  const m3Mix = [
    measure("M-3:human", "Resolved by a human", decisions.humanResolved, decisions.total, ""),
    measure("M-3:escalated", "Escalated", decisions.escalated, decisions.total, ""),
    measure("M-3:held", "Held (deferred or slipped)", decisions.held, decisions.total, ""),
    measure("M-3:doctrine-only", "Doctrine only", doctrineOnly, decisions.total, ""),
  ];

  const m4ByAction = Object.entries(authorization.deniedByAction)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([action, n]) => measure(`M-4:${action}`, action, n, authorization.denied, ""));

  const guards = [...input.guards]
    .sort((a, b) => b.totalDurationMs - a.totalDurationMs || a.guardId.localeCompare(b.guardId))
    .map((row): GuardMeasures => {
      const classified = row.caught + row.falseRefusals + row.overridden + row.unresolved;
      return {
        guardId: row.guardId,
        catchRate: measure("G-1", "Caught (pairing proxy)", row.caught, classified, `${PAIRING_PROXY_LIMITATION} ${GUARD_COVERAGE_OMITS}`),
        falseRefusalRate: measure(
          "G-2",
          "False refusal (pairing proxy)",
          row.falseRefusals,
          row.caught + row.falseRefusals,
          `${PAIRING_PROXY_LIMITATION} ${GUARD_COVERAGE_OMITS}`,
        ),
        overrideRate: measure("G-3", "Overridden", row.overridden, classified, GUARD_COVERAGE_OMITS),
        undecidedShare: measure("G-5", "Undecided", row.unresolved, classified, GUARD_COVERAGE_OMITS),
        runs: row.runs,
        totalDurationMs: row.totalDurationMs,
        medianDurationMs: row.medianDurationMs,
        unresolvedByReason: row.unresolvedByReason,
      };
    });

  return { period: input.period, gpp, proxies, approvalLoad, m1PerAgent, m3Mix, m4ByAction, guards };
}
