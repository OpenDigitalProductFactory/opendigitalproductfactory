/**
 * ONE SEAM FOR OWNER ATTENTION (BI-5E067004, EP-8717D32C).
 *
 * Commandment: escalation is a gate, not a trust tier. A person is engaged only
 * when the action is damaging, or when nothing recorded can steer it. Before
 * this seam the gate (`resolveDecisionEscalation`, BI-6B3DA9DD) ran only on the
 * coworker MCP tool path. Background producers wrote owner-attention issue
 * reports directly: 91 in the 14 days to 2026-11-13, none consulted against
 * doctrine, most of them mechanical (a failing guard, a merge conflict, an
 * empty diff). PIR-QGQUH, a Prose Lint Guard failure, is the recorded fixture.
 *
 * This module is the ONLY source allowed to write an owner-attention report
 * (`selfFixClass` set, or a `build-stall-escalation` with an owner notice).
 * scripts/check-no-unrouted-owner-escalation.mjs fails CI when any other
 * source file does, so the rule is a control, not prose.
 *
 * Order, which is the safety property:
 *   1. Damage first: the gate's own damage test (critical risk, declared
 *      consequence, crossed threshold, regulation), plus restricted data and a
 *      propose boundary as the action gate defines them. Damage reaches a
 *      person exactly as before and the consult is skipped. Tighten-only.
 *   2. Otherwise consult the owning scope (WWMD for platform work, WWWD for
 *      organization work) with a FIXED feature vector per blocker class. The
 *      old escalation responder was deleted because it called principle_decide
 *      with no features and every option scored 0 (escalation-hygiene-runner.ts).
 *   3. `resolveDecisionEscalation` turns the consult's basis into a route. A
 *      non-damaging decision never reaches a person: it is decided (the repair
 *      goes to an agent) or held for independent review.
 *
 * The non-owner route reuses existing substrate (WWMD DI-82749A6FBEA1): an
 * ordinary issue report that issue-report triage projects into an
 * agent-pullable backlog item. It never reaches the Needs-you inbox.
 */
import type { PrincipalSensitivity } from "@dpf/db/principal-sensitivity";
import type { ToolConsequence } from "@/lib/tool-consequence";
import type { DecisionRiskTier } from "@/lib/decision-perspective/types";
import {
  DAMAGING_SENSITIVITIES,
  resolveDecisionEscalation,
  type DecisionBasis,
  type DecisionEscalationReasonCode,
} from "./escalation-gate";
import { humanDecisionReviewMessage } from "@/lib/decision-perspective/decision-escalation";

// ─── Vocabulary ─────────────────────────────────────────────────────────────

/** Every code path allowed to ask for owner attention. Closed on purpose. */
export const OWNER_ATTENTION_PRODUCERS = [
  "build-stall",
  "build-pr-delivery",
  "pull-request-follow-through",
  "assurance-merge-gate",
  "index-integrity-sweep",
] as const;
export type OwnerAttentionProducer = (typeof OWNER_ATTENTION_PRODUCERS)[number];

/** The self-fix class the seam writes on an owner route. Producers never set it. */
export const OWNER_ATTENTION_SELF_FIX_CLASS = "needs-human" as const;

/** Report type for work routed away from the owner; projected to the backlog. */
export const ROUTED_REPAIR_REPORT_TYPE = "routed-repair" as const;

export const BLOCKER_CLASSES = [
  "guard-failure",
  "merge-conflict",
  "stale-base",
  "empty-change",
  "check-failure",
  "review-finding",
  "unmitigated-risk",
  "evidence-withheld",
  "infrastructure",
  "observation-budget",
  "other",
] as const;
export type BlockerClass = (typeof BLOCKER_CLASSES)[number];

// First match wins; more specific patterns precede broader ones.
const BLOCKER_PATTERNS: ReadonlyArray<readonly [BlockerClass, RegExp]> = [
  ["empty-change", /without any committed change|changed nothing|empty[- ]diff/i],
  ["stale-base", /stale-update-budget|still conflicts with upstream|refresh onto upstream/i],
  ["merge-conflict", /merge[- ]conflict|not cleanly mergeable/i],
  ["guard-failure", /guard still failing|guard (?:failed|failure)|lint (?:failed|failure)/i],
  ["unmitigated-risk", /unmitigated risk/i],
  ["review-finding", /review finding|reviewer still rejected|diagnosis is incomplete|independent review still fails/i],
  ["evidence-withheld", /local-evidence-not-cleared|eligibility-withheld|osv-target-not-clean|cooldown-not-met/i],
  ["infrastructure", /infrastructure-(?:persists|not-rerunnable)|undecided merge state|not decided .*merge state/i],
  ["observation-budget", /observation-budget-exhausted/i],
  ["check-failure", /ci-not-green|repair-budget-exhausted|unclassified-check-failure|failing checks?|is red on/i],
];

/** Pure, fixed mapping from blocking facts to a blocker class. */
export function classifyOwnerAttentionBlocker(facts: readonly string[]): BlockerClass {
  const text = facts.join("\n");
  for (const [blocker, pattern] of BLOCKER_PATTERNS) if (pattern.test(text)) return blocker;
  return "other";
}

// ─── Fixed feature extraction ───────────────────────────────────────────────

export const ROUTE_OPTION_IDS = ["resume", "route-to-agent", "escalate"] as const;
export type RouteOptionId = (typeof ROUTE_OPTION_IDS)[number];

type FeatureVector = Readonly<Record<string, number>>;
type FeatureProfile = Readonly<Record<RouteOptionId, FeatureVector>>;
export type BlockerProfile = "mechanical" | "judgement" | "external-wait";

/**
 * Blocker profiles. MECHANICAL is the vector WWMD scored on the PIR-QGQUH
 * fixture: route-to-agent, high confidence, margin 6.18, autonomy-eligible
 * (DI-007A5617C3EE). Every option carries the same ten axes, so no option wins
 * or loses by omission. Cost axes (operator_effort, human_cognitive_load,
 * blast_radius) score magnitude: higher is worse.
 */
const PROFILES: Readonly<Record<BlockerProfile, FeatureProfile>> = {
  mechanical: {
    resume: { speed_to_value: 0.4, operator_effort: 0.1, human_cognitive_load: 0.1, long_term_maintainability: 0.2, evidence_density: 0.3, reversibility: 0.9, blast_radius: 0.2, governance_compliance: 0.5, legibility_of_consequence: 0.4, cost_efficiency: 0.3 },
    "route-to-agent": { speed_to_value: 0.8, operator_effort: 0.1, human_cognitive_load: 0.1, long_term_maintainability: 0.8, evidence_density: 0.8, reversibility: 0.9, blast_radius: 0.2, governance_compliance: 0.9, legibility_of_consequence: 0.8, cost_efficiency: 0.7 },
    escalate: { speed_to_value: 0.1, operator_effort: 0.9, human_cognitive_load: 0.9, long_term_maintainability: 0.4, evidence_density: 0.5, reversibility: 0.9, blast_radius: 0.2, governance_compliance: 0.6, legibility_of_consequence: 0.6, cost_efficiency: 0.2 },
  },
  // A reviewer's finding or an open risk: an agent can still repair it, but the
  // evidence behind the repair is thinner, so the margin is narrower.
  judgement: {
    resume: { speed_to_value: 0.3, operator_effort: 0.1, human_cognitive_load: 0.1, long_term_maintainability: 0.2, evidence_density: 0.3, reversibility: 0.9, blast_radius: 0.3, governance_compliance: 0.4, legibility_of_consequence: 0.4, cost_efficiency: 0.3 },
    "route-to-agent": { speed_to_value: 0.7, operator_effort: 0.1, human_cognitive_load: 0.2, long_term_maintainability: 0.7, evidence_density: 0.6, reversibility: 0.9, blast_radius: 0.3, governance_compliance: 0.8, legibility_of_consequence: 0.7, cost_efficiency: 0.6 },
    escalate: { speed_to_value: 0.2, operator_effort: 0.8, human_cognitive_load: 0.8, long_term_maintainability: 0.5, evidence_density: 0.6, reversibility: 0.9, blast_radius: 0.3, governance_compliance: 0.7, legibility_of_consequence: 0.7, cost_efficiency: 0.2 },
  },
  // Something outside the code must change first (CI infrastructure, GitHub's
  // merge state, an advisory cooldown): waiting and retrying is the cheap move.
  "external-wait": {
    resume: { speed_to_value: 0.6, operator_effort: 0.1, human_cognitive_load: 0.1, long_term_maintainability: 0.6, evidence_density: 0.6, reversibility: 0.9, blast_radius: 0.1, governance_compliance: 0.8, legibility_of_consequence: 0.7, cost_efficiency: 0.8 },
    "route-to-agent": { speed_to_value: 0.5, operator_effort: 0.1, human_cognitive_load: 0.2, long_term_maintainability: 0.6, evidence_density: 0.6, reversibility: 0.9, blast_radius: 0.2, governance_compliance: 0.8, legibility_of_consequence: 0.7, cost_efficiency: 0.5 },
    escalate: { speed_to_value: 0.1, operator_effort: 0.9, human_cognitive_load: 0.8, long_term_maintainability: 0.4, evidence_density: 0.5, reversibility: 0.9, blast_radius: 0.1, governance_compliance: 0.6, legibility_of_consequence: 0.6, cost_efficiency: 0.2 },
  },
};

export const BLOCKER_PROFILE: Readonly<Record<BlockerClass, BlockerProfile>> = {
  "guard-failure": "mechanical",
  "merge-conflict": "mechanical",
  "stale-base": "mechanical",
  "empty-change": "mechanical",
  "check-failure": "mechanical",
  "review-finding": "judgement",
  "unmitigated-risk": "judgement",
  "evidence-withheld": "judgement",
  other: "judgement",
  infrastructure: "external-wait",
  "observation-budget": "external-wait",
};

const OPTION_DESCRIPTIONS: Readonly<Record<RouteOptionId, string>> = {
  resume: "Retry the same automated loop unchanged.",
  "route-to-agent": "Hand the repair to a coding agent with the blocking facts as the brief, through the normal gates.",
  escalate: "Send it to the owner's Needs-you inbox for a decision.",
};

export type RouteConsultOption = { id: RouteOptionId; description: string; features: Record<string, number> };

/** The fixed options with their feature vectors for one blocker class. */
export function featuresForBlocker(blocker: BlockerClass): RouteConsultOption[] {
  const profile = PROFILES[BLOCKER_PROFILE[blocker]];
  return ROUTE_OPTION_IDS.map((id) => ({ id, description: OPTION_DESCRIPTIONS[id], features: { ...profile[id] } }));
}

// ─── The decision ───────────────────────────────────────────────────────────

export type OwnerAttentionScope = "platform" | "organization";

export type OwnerAttentionDeclarations = {
  riskTier?: DecisionRiskTier;
  consequence?: ToolConsequence | null;
  thresholdExceeded?: boolean;
  regulated?: boolean;
  sensitivity?: PrincipalSensitivity;
  /** The room is set to propose, not act: a person runs the step (BI-C8EC05C9). */
  proposeBoundary?: boolean;
};

export type OwnerAttentionInput = {
  producer: OwnerAttentionProducer;
  subject: { kind: "build" | "workroom" | "pull-request" | "platform"; id: string };
  /** The facts that block the work: the issues, the stop reason, the failing guard. */
  blockingFacts: string[];
  /** Override the fact classifier when the producer knows the class exactly. */
  blockerClass?: BlockerClass;
  declarations?: OwnerAttentionDeclarations;
  scope?: OwnerAttentionScope;
};

export type ScopeConsultRequest = {
  scope: OwnerAttentionScope;
  context: string;
  options: RouteConsultOption[];
  callingSurface: string;
};
export type ScopeConsultResult = {
  recommendation: { optionId: string; confidence: string } | null;
  autonomyEligible: boolean;
  commandmentConflict: boolean;
  interactionId: string | null;
};
export type ScopeConsult = (request: ScopeConsultRequest) => Promise<ScopeConsultResult>;

export type OwnerAttentionRoute = "agent" | "independent-review" | "human";
export type OwnerAttentionReasonCode = DecisionEscalationReasonCode | "damaging-sensitivity" | "propose-boundary";

export type OwnerAttentionDecision = {
  route: OwnerAttentionRoute;
  reasonCode: OwnerAttentionReasonCode;
  damaging: boolean;
  blockerClass: BlockerClass;
  /** The basis the consult produced; null when damage skipped the consult. */
  basis: DecisionBasis | null;
  /** On the agent route: whether the agent resumes the loop or repairs it. */
  agentAction: "resume" | "route-to-agent" | null;
  consult: {
    status: "skipped-damaging" | "decided" | "indecisive" | "fault";
    scope: OwnerAttentionScope;
    optionId: string | null;
    confidence: string | null;
    interactionId: string | null;
  };
  /** One sentence for the report: why it reached a person, or where it went instead. */
  reason: string;
};

const SCOPE_NAME: Record<OwnerAttentionScope, string> = { platform: "WWMD", organization: "WWWD" };

const FOLLOW_ON_CAUSE: Record<Exclude<DecisionBasis, "decided">, string> = {
  "corpus-gap": "gave no decisive recommendation",
  "vector-gap": "found conflicting commandments",
  "capability-gap": "could not score the options",
  "policy-limit": "recommended a person, but the case is not damaging",
  "evaluation-fault": "could not be consulted",
};

function damagingReasonFor(input: OwnerAttentionInput): { code: OwnerAttentionReasonCode; sentence: string } | null {
  const d = input.declarations ?? {};
  // The gate's own damage test. The basis is irrelevant once damage is found.
  const gate = resolveDecisionEscalation({
    basis: "evaluation-fault",
    riskTier: d.riskTier ?? "medium",
    declarations: { consequence: d.consequence, thresholdExceeded: d.thresholdExceeded, regulated: d.regulated },
  });
  if (gate.route === "human") return { code: gate.reasonCode, sentence: humanDecisionReviewMessage(gate.reasonCode) };
  if (d.sensitivity && DAMAGING_SENSITIVITIES.includes(d.sensitivity)) {
    return { code: "damaging-sensitivity", sentence: "This decision requires a person because it touches restricted data." };
  }
  if (d.proposeBoundary === true) {
    return { code: "propose-boundary", sentence: "This decision requires a person because the room is set to propose, not act, so a person runs the step." };
  }
  return null;
}

function basisFor(result: ScopeConsultResult): { basis: DecisionBasis; status: OwnerAttentionDecision["consult"]["status"] } {
  if (result.commandmentConflict) return { basis: "vector-gap", status: "indecisive" };
  const rec = result.recommendation;
  if (!rec || rec.confidence !== "high" || !result.autonomyEligible) return { basis: "corpus-gap", status: "indecisive" };
  if (rec.optionId === "escalate") return { basis: "policy-limit", status: "decided" };
  if (rec.optionId === "resume" || rec.optionId === "route-to-agent") return { basis: "decided", status: "decided" };
  return { basis: "corpus-gap", status: "indecisive" };
}

function consultContext(input: OwnerAttentionInput, blocker: BlockerClass): string {
  const facts = input.blockingFacts.map((f) => f.trim()).filter(Boolean).slice(0, 5).join(" | ").slice(0, 900);
  return (
    `${input.producer} stopped ${input.subject.kind} ${input.subject.id}. Blocker class: ${blocker}. ` +
    "The case declares no damaging consequence, threshold, regulation or restricted data. " +
    "Decide whether to resume the same loop, route the repair to a coding agent with the blocking facts, or escalate to the owner. " +
    `Facts: ${facts || "(none recorded)"}`
  );
}

/**
 * Decide where an owner-attention request goes. Pure apart from the injected
 * consult, which is skipped for damaging cases. A consult failure routes to
 * independent review, never to a person.
 */
export async function decideOwnerAttentionRoute(
  input: OwnerAttentionInput,
  consult: ScopeConsult = consultOwningScope,
): Promise<OwnerAttentionDecision> {
  const scope = input.scope ?? "platform";
  const blockerClass = input.blockerClass ?? classifyOwnerAttentionBlocker(input.blockingFacts);
  const damage = damagingReasonFor(input);
  if (damage) {
    return {
      route: "human", reasonCode: damage.code, damaging: true, blockerClass, basis: null, agentAction: null,
      consult: { status: "skipped-damaging", scope, optionId: null, confidence: null, interactionId: null },
      reason: damage.sentence,
    };
  }

  let result: ScopeConsultResult | null;
  try {
    result = await consult({
      scope,
      context: consultContext(input, blockerClass),
      options: featuresForBlocker(blockerClass),
      callingSurface: `route-to-human:${input.producer}`,
    });
  } catch {
    result = null;
  }
  const { basis, status } = result ? basisFor(result) : { basis: "evaluation-fault" as const, status: "fault" as const };
  const escalation = resolveDecisionEscalation({ basis, riskTier: input.declarations?.riskTier ?? "medium", declarations: {} });
  const consultRecord = {
    status, scope,
    optionId: result?.recommendation?.optionId ?? null,
    confidence: result?.recommendation?.confidence ?? null,
    interactionId: result?.interactionId ?? null,
  };
  const ref = consultRecord.interactionId ? ` (${consultRecord.interactionId})` : "";

  if (escalation.route === "decided") {
    const agentAction = result?.recommendation?.optionId === "resume" ? "resume" : "route-to-agent";
    return {
      route: "agent", reasonCode: escalation.reasonCode, damaging: false, blockerClass, basis, agentAction,
      consult: consultRecord,
      reason: `Not damaging, and ${SCOPE_NAME[scope]} decided ${agentAction}${ref} for this ${blockerClass} blocker, so a coding agent takes it instead of the owner.`,
    };
  }
  // resolveDecisionEscalation returns human only for damage, handled above.
  return {
    route: "independent-review", reasonCode: escalation.reasonCode, damaging: false, blockerClass, basis, agentAction: null,
    consult: consultRecord,
    reason: `Not damaging, but ${SCOPE_NAME[scope]} ${FOLLOW_ON_CAUSE[basis as Exclude<DecisionBasis, "decided">]}${ref} for this ${blockerClass} blocker, so it goes to independent review instead of the owner.`,
  };
}

// ─── The default consult: the owning scope through principle_decide ─────────

export function readScopeConsultResult(data: Record<string, unknown> | undefined): ScopeConsultResult {
  const rec = data?.recommendation as Record<string, unknown> | null | undefined;
  const flags = (data?.flags ?? {}) as Record<string, unknown>;
  const signal = (data?.signalQuality ?? {}) as Record<string, unknown>;
  const ledger = (data?.ledger ?? {}) as Record<string, unknown>;
  return {
    recommendation: rec && typeof rec.optionId === "string" && typeof rec.confidence === "string"
      ? { optionId: rec.optionId, confidence: rec.confidence }
      : null,
    autonomyEligible: signal.autonomyEligible === true || flags.autonomyEligible === true,
    commandmentConflict: flags.commandmentConflict === true,
    interactionId: typeof ledger.interactionId === "string" ? ledger.interactionId : null,
  };
}

/**
 * Consult WWMD (platform) or WWWD (organization) with the fixed options.
 * Calls the principle_decide runner directly, as policy-action-judgment.ts
 * does, rather than through the MCP tool hub: this seam sits under build
 * handlers the hub reaches, so a hub import would close an import cycle. The
 * runner records the consult on the kernel ledger either way.
 */
export async function consultOwningScope(request: ScopeConsultRequest): Promise<ScopeConsultResult> {
  const { runPrincipleDecision } = await import("@/lib/mcp/packs/principle-decide-pack");
  const response = await runPrincipleDecision(
    {
      context: request.context,
      callingPopulation: "in_platform_coworker",
      decisionDomain: request.scope === "organization" ? "org-business" : "platform-development",
      stakes: "routine",
      callingSurface: request.callingSurface,
      options: request.options,
    },
    { routeContext: "/ops" },
  );
  if (!response.success) throw new Error(response.error ?? "principle_decide failed");
  return readScopeConsultResult(response.data as Record<string, unknown> | undefined);
}

// ─── The writes ─────────────────────────────────────────────────────────────

export type OwnerAttentionReport = {
  /** Report type on the owner route; defaults to build-stall-escalation. */
  type?: string;
  source: string;
  severity: string;
  title: string;
  description: string;
  featureBuildId?: string | null;
  triggerKind: string;
  dedupeKey: string;
  routeContext?: string | null;
};

export type OwnerAttentionNotice = { deepLink: string; title?: string };

export type OwnerAttentionWriteDeps = {
  createReport: (input: Record<string, unknown>) => Promise<{ reportId: string }>;
  resolveOwner: () => Promise<string | null>;
  notify: (input: { source: "escalation"; itemKey: string; userId: string; title: string; deepLink: string; riskClass: "high-risk" }) => Promise<void>;
};

async function liveWriteDeps(): Promise<OwnerAttentionWriteDeps> {
  const [{ createPlatformIssueReport }, attention] = await Promise.all([
    import("@/lib/quality/platform-issue-reports"),
    import("@/lib/attention/notify-live"),
  ]);
  return {
    createReport: (input) => createPlatformIssueReport(input as unknown as Parameters<typeof createPlatformIssueReport>[0]),
    resolveOwner: attention.resolveOperatorRecipient,
    notify: attention.notifyAttentionLive,
  };
}

export type OwnerAttentionFiled = {
  reportId: string | null;
  /** The owner notified on the human route; null otherwise. */
  ownerUserId: string | null;
  error: string | null;
};

/** The recorded decision, appended to every report the seam writes. */
export function describeOwnerAttentionDecision(decision: OwnerAttentionDecision): string {
  const c = decision.consult;
  const consult = c.status === "skipped-damaging"
    ? "not consulted: the case is damaging"
    : `${c.status}${c.optionId ? `, ${c.optionId}` : ""}${c.confidence ? ` (${c.confidence})` : ""}${c.interactionId ? `, ${c.interactionId}` : ""}`;
  return (
    `Escalation decision (BI-5E067004): route ${decision.route}, ${decision.reasonCode}; ` +
    `blocker ${decision.blockerClass}; ${SCOPE_NAME[c.scope]} ${consult}.\n` +
    `Why: ${decision.reason}`
  );
}

/**
 * Write what the decision says. The human route files the owner-attention
 * report and notifies the owner. The other routes file an ordinary report that
 * triage projects into agent-pullable backlog work, with no owner notice.
 * Best-effort: a write failure is returned, never thrown, so a producer that
 * must still free a slot or record state can.
 */
export async function fileOwnerAttentionRoute(
  decision: OwnerAttentionDecision,
  report: OwnerAttentionReport,
  notice?: OwnerAttentionNotice,
  deps?: OwnerAttentionWriteDeps,
): Promise<OwnerAttentionFiled> {
  const decided = describeOwnerAttentionDecision(decision);
  try {
    const d = deps ?? await liveWriteDeps();
    if (decision.route === "human") {
      const { reportId } = await d.createReport({
        type: report.type ?? "build-stall-escalation",
        source: report.source,
        severity: report.severity,
        title: report.title,
        description: `${report.description}\n\n${decided}`,
        featureBuildId: report.featureBuildId ?? null,
        triggerKind: report.triggerKind,
        dedupeKey: report.dedupeKey,
        routeContext: report.routeContext ?? null,
        selfFixClass: OWNER_ATTENTION_SELF_FIX_CLASS,
      });
      let ownerUserId: string | null = null;
      if (notice) {
        ownerUserId = await d.resolveOwner();
        if (ownerUserId) {
          await d.notify({
            source: "escalation", itemKey: reportId, userId: ownerUserId,
            title: notice.title ?? report.title, deepLink: notice.deepLink, riskClass: "high-risk",
          });
        }
      }
      return { reportId, ownerUserId, error: null };
    }
    const destination = decision.route === "agent" ? "a coding agent" : "independent review";
    const { reportId } = await d.createReport({
      type: ROUTED_REPAIR_REPORT_TYPE,
      source: report.source,
      severity: report.severity === "critical" ? "high" : report.severity,
      title: `Routed to ${destination}: ${report.title}`.slice(0, 300),
      description: `${report.description}\n\n${decided}`,
      featureBuildId: report.featureBuildId ?? null,
      triggerKind: report.triggerKind,
      dedupeKey: `${report.dedupeKey}:routed`,
      routeContext: report.routeContext ?? null,
    });
    return { reportId, ownerUserId: null, error: null };
  } catch (err) {
    return { reportId: null, ownerUserId: null, error: String(err instanceof Error ? err.message : err).slice(0, 300) };
  }
}

/** Decide, then write. The entry point for producers with nothing to fence. */
export async function routeToHuman(
  input: OwnerAttentionInput & { report: OwnerAttentionReport; notice?: OwnerAttentionNotice },
  deps?: { consult?: ScopeConsult; write?: OwnerAttentionWriteDeps },
): Promise<{ decision: OwnerAttentionDecision } & OwnerAttentionFiled> {
  const decision = await decideOwnerAttentionRoute(input, deps?.consult);
  const filed = await fileOwnerAttentionRoute(decision, input.report, input.notice, deps?.write);
  return { decision, ...filed };
}
