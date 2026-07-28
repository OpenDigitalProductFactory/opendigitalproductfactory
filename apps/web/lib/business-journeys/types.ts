// Critical Business Journey Watchdog — types (BI-E105303D, EP-PROACTIVE-OPS).
// Spec: docs/superpowers/specs/2026-07-28-critical-business-journey-watchdog-design.md
//
// A "critical business journey" is a path the BUSINESS cannot afford to lose —
// a customer signing up, requesting a quote, booking a slot, paying. This is
// deliberately distinct from `lib/coworker-lifecycle/golden-journeys.ts`, which
// certifies COWORKERS, and from `lib/business-activity-sim/`, which simulates a
// flow in memory without touching the running install.

/**
 * How much a step actually proved. This is the load-bearing type of the whole
 * module: `structural-verification-is-not-functional` is a commandment, so a
 * watchdog that pings a URL must never be able to report "journey healthy".
 *
 * The ladder is ordered — comparisons rely on the index in `DEPTH_ORDER`.
 */
export type VerificationDepth =
  /** The entry surface responded as declared. Proves the door opens. */
  | "reachability"
  /** The journey's required substrate exists and is coherent (published
   *  storefront, bookable items, a configured archetype). Proves the room
   *  behind the door is furnished. */
  | "contract"
  /** The journey's REAL persistence path and REAL database constraints executed
   *  end-to-end inside a watchdog-owned transaction that was then rolled back.
   *  Proves the business record can actually be created. */
  | "data-path"
  /** The real server action / rendered client was driven end-to-end.
   *  NOT COVERED IN P1 — named here so the gap is visible in the product
   *  instead of hidden in a backlog. */
  | "interaction";

/** Weakest → strongest. Index position IS the comparison. */
export const DEPTH_ORDER: readonly VerificationDepth[] = [
  "reachability",
  "contract",
  "data-path",
  "interaction",
] as const;

/** Depths this slice can actually reach. Everything above is reported as unchecked. */
export const SUPPORTED_DEPTHS: readonly VerificationDepth[] = [
  "reachability",
  "contract",
  "data-path",
] as const;

/** Owner-facing sentence for each depth — what it does and does not prove. */
export const DEPTH_MEANING: Record<VerificationDepth, string> = {
  reachability: "the page loads",
  contract: "the setup behind it is complete",
  "data-path": "a real record can be created and the database accepts it",
  interaction: "a customer completing this in a browser",
};

export type StepOutcome = "passed" | "failed" | "skipped";

/** One probe within a journey. Steps run cheapest-first and a step is skipped
 *  when an earlier step in the same journey failed — a broken storefront costs
 *  one HTTP call, not a full transaction rehearsal. */
export type JourneyStep = {
  stepId: string;
  /** What this step checks, in the owner's language. */
  label: string;
  depth: VerificationDepth;
  run: (ctx: JourneyProbeContext) => Promise<StepProbeResult>;
};

/** What a probe returns. `expected`/`actual` are required on failure so every
 *  defect carries reproduction detail (the `every-defect-needs-reproduction-steps`
 *  commandment applies to the watchdog's own output). */
export type StepProbeResult = {
  passed: boolean;
  detail: string;
  expected?: string;
  actual?: string;
};

export type JourneyStepResult = {
  stepId: string;
  label: string;
  depth: VerificationDepth;
  outcome: StepOutcome;
  detail: string;
  expected?: string;
  actual?: string;
  durationMs: number;
};

/** Facts about what this install actually has switched on. Journeys declare
 *  applicability against this rather than assuming every install is a storefront. */
export type InstallJourneyContext = {
  organizationId: string | null;
  organizationSlug: string | null;
  /** Canonical origin for reachability probes. */
  baseUrl: string;
  storefrontId: string | null;
  storefrontPublished: boolean;
  /** Primary archetype plus any composed secondaries. */
  archetypeIds: string[];
  bookableItemId: string | null;
  hasInquirySurface: boolean;
  hasPaymentConfiguration: boolean;
};

export type JourneyProbeContext = InstallJourneyContext & {
  fetchImpl: typeof fetch;
  now: () => Date;
};

export type JourneyDefinition = {
  journeyId: string;
  /** The outcome in the owner's language — "New customers can request a quote".
   *  Never the mechanism. This is what the attention card and tile render. */
  outcome: string;
  /** What the business loses when this journey is down. */
  businessImpact: string;
  /** Revenue-bearing journeys escalate to high-risk in the attention surface. */
  revenueBearing: boolean;
  /** Install-defined: a journey that does not apply is `not-applicable`, never red. */
  appliesWhen: (ctx: InstallJourneyContext) => boolean;
  /** Why it does not apply, shown instead of a status when skipped. */
  notApplicableReason: string;
  steps: JourneyStep[];
};

export type JourneyStatus = "passed" | "failed" | "not-applicable";

export type JourneyResult = {
  journeyId: string;
  outcome: string;
  businessImpact: string;
  revenueBearing: boolean;
  status: JourneyStatus;
  /** The weakest depth among PASSING steps — see `achievedDepth`. Null when the
   *  journey failed or did not apply, because nothing was established. */
  achievedDepth: VerificationDepth | null;
  /** Depths this run did not establish. Rendered as "Not checked: …". */
  uncheckedDepths: VerificationDepth[];
  notApplicableReason?: string;
  steps: JourneyStepResult[];
  durationMs: number;
};

export type JourneySweepResult = {
  runId: string;
  startedAt: Date;
  completedAt: Date;
  journeys: JourneyResult[];
  passed: number;
  failed: number;
  notApplicable: number;
};

export const JOURNEY_ADAPTER_KEY = "journey-watchdog";
export const JOURNEY_ADAPTER_VERSION = "1.0.0";
export const JOURNEY_ASSURANCE_SCOPE_TYPE = "business-journey";
