// Pure utility library — no server imports. Safe in tests and client components.
//
// DECLARED LIFECYCLE GRAMMARS — the concrete lifecycles expressed in the canonical grammar
// (apps/web/lib/lifecycle-grammar.ts). Each is a SHAPE instance; declaring one here does not
// rewrite its surfaces (that is the downstream BIs' work). validateGrammar() runs over all of
// them at module load so a malformed grammar fails tests, not production.
//
// Spec: docs/superpowers/specs/2026-08-15-canonical-lifecycle-grammar-design.md §5.

import {
  LIFECYCLE_STAGES,
  LIFECYCLE_STAGE_TRANSITIONS,
  type LifecycleStage,
} from "./lifecycle";
import {
  type LifecycleGrammar,
  type LifecyclePoint,
  validateGrammar,
} from "./lifecycle-grammar";

// ─── customer-account ────────────────────────────────────────────────────────────────
// Native decomposition of the 9-state CustomerAccount.status union (packages/db/src/
// customer-lifecycle.ts). Stored spellings kept (`at_risk` is exempted from hyphenation there).
// All 9 statuses are placed: prospect·qualified·onboarding·active·at_risk·suspended·closed·
// superseded·archived.
export const CUSTOMER_ACCOUNT_GRAMMAR: LifecycleGrammar = {
  key: "customer-account",
  label: "Customer account relationship",
  stages: [
    {
      key: "prospect",
      label: "Prospect",
      advancesTo: ["qualified", "closed"],
      exitCriteria: ["Contact and account identified", "Fit hypothesis recorded"],
      states: [{ key: "prospect", label: "Prospect", band: "on-track", isEntry: true, isExitReady: true }],
    },
    {
      key: "qualified",
      label: "Qualified",
      advancesTo: ["onboarding", "closed"],
      exitCriteria: ["Qualification confirmed", "Commercial path agreed"],
      states: [{ key: "qualified", label: "Qualified", band: "ready", isEntry: true, isExitReady: true }],
    },
    {
      key: "onboarding",
      label: "Onboarding",
      advancesTo: ["active", "closed"],
      exitCriteria: ["Onboarding milestones complete", "First value delivered"],
      states: [{ key: "onboarding", label: "Onboarding", band: "on-track", isEntry: true, isExitReady: true }],
    },
    {
      key: "active",
      label: "Active",
      advancesTo: ["closed"],
      // The recurring back-half. Within `active`, three stored statuses collapse: `active`
      // (healthy, on-track), `at_risk` (blocked — a churn-risk signal), `suspended` (blocked —
      // service paused). `at_risk`/`suspended` keep stored spelling for native round-trip.
      states: [
        { key: "active", label: "Active", band: "on-track", isEntry: true, isExitReady: true },
        { key: "at_risk", label: "At risk", band: "blocked" },
        { key: "suspended", label: "Suspended", band: "blocked" },
      ],
    },
    {
      key: "closed",
      label: "Closed",
      advancesTo: [],
      isTerminal: true,
      // Relationship end + the two data-lifecycle tombstones (merged / operator-archived).
      states: [
        { key: "closed", label: "Closed", band: "on-track", isEntry: true },
        { key: "superseded", label: "Superseded (merged)", band: "on-track" },
        { key: "archived", label: "Archived", band: "on-track" },
      ],
    },
  ],
};

/** Map a stored CustomerAccount.status → its (stage, state) point in the grammar. */
export function resolveCustomerAccountPoint(status: string): LifecyclePoint {
  switch (status) {
    case "prospect":
      return { stage: "prospect", state: "prospect" };
    case "qualified":
      return { stage: "qualified", state: "qualified" };
    case "onboarding":
      return { stage: "onboarding", state: "onboarding" };
    case "active":
      return { stage: "active", state: "active" };
    case "at_risk":
      return { stage: "active", state: "at_risk" };
    case "suspended":
      return { stage: "active", state: "suspended" };
    case "closed":
      return { stage: "closed", state: "closed" };
    case "superseded":
      return { stage: "closed", state: "superseded" };
    case "archived":
      return { stage: "closed", state: "archived" };
    default:
      // Unknown stored value → treat as prospect entry (conservative; surfaces as the earliest stage).
      return { stage: "prospect", state: "prospect" };
  }
}

// ─── opportunity ──────────────────────────────────────────────────────────────────────
// Lifts STAGE_EXIT_CRITERIA + STAGE_STALE_THRESHOLDS_DAYS verbatim from crm/pipeline-inspector.ts
// into the per-stage exitCriteria/staleAfterDays; stored underscore spellings kept
// (closed_won/closed_lost). pipeline-inspector re-imports these from here (behaviour-preserving).
// Default fallbacks (14-day stale, 2-item criteria) stay in pipeline-inspector's accessor funcs.
export const OPPORTUNITY_GRAMMAR: LifecycleGrammar = {
  key: "opportunity",
  label: "Sales opportunity",
  stages: [
    {
      key: "qualification",
      label: "Qualification",
      advancesTo: ["discovery", "closed_won", "closed_lost"],
      staleAfterDays: 7,
      exitCriteria: ["Buyer problem is clear", "Account and primary contact are known", "Value hypothesis is recorded"],
      states: [{ key: "open", label: "Open", band: "on-track", isEntry: true, isExitReady: true }],
    },
    {
      key: "discovery",
      label: "Discovery",
      advancesTo: ["proposal", "closed_won", "closed_lost"],
      staleAfterDays: 10,
      exitCriteria: ["Needs and success criteria captured", "Stakeholders and blockers identified", "Commercial fit is plausible"],
      states: [{ key: "open", label: "Open", band: "on-track", isEntry: true, isExitReady: true }],
    },
    {
      key: "proposal",
      label: "Proposal",
      advancesTo: ["negotiation", "closed_won", "closed_lost"],
      staleAfterDays: 14,
      exitCriteria: ["Quote or proposal sent", "Commercial owner identified", "Budget and timeline confirmed"],
      states: [{ key: "open", label: "Open", band: "on-track", isEntry: true, isExitReady: true }],
    },
    {
      key: "negotiation",
      label: "Negotiation",
      advancesTo: ["closed_won", "closed_lost"],
      staleAfterDays: 10,
      exitCriteria: ["Decision process confirmed", "Commercial objections resolved", "Signature or close step scheduled"],
      states: [{ key: "open", label: "Open", band: "on-track", isEntry: true, isExitReady: true }],
    },
    {
      key: "closed_won",
      label: "Won",
      advancesTo: [],
      isTerminal: true,
      exitCriteria: ["Order or onboarding path confirmed", "Handoff owner recorded"],
      states: [{ key: "won", label: "Won", band: "ready", isEntry: true }],
    },
    {
      key: "closed_lost",
      label: "Lost",
      advancesTo: [],
      isTerminal: true,
      exitCriteria: ["Lost reason recorded", "Reusable learning captured"],
      states: [{ key: "lost", label: "Lost", band: "on-track", isEntry: true }],
    },
  ],
};

/** Map a stored opportunity stage → its (stage, state) point. Opportunity has no separately
 *  stored in-stage state; the entry state stands in (staleness/blocked is derived at read time). */
export function resolveOpportunityPoint(stage: string): LifecyclePoint {
  switch (stage) {
    case "closed_won":
      return { stage: "closed_won", state: "won" };
    case "closed_lost":
      return { stage: "closed_lost", state: "lost" };
    case "qualification":
    case "discovery":
    case "proposal":
    case "negotiation":
      return { stage, state: "open" };
    default:
      return { stage: "qualification", state: "open" };
  }
}

// ─── backbone (EaElement / DigitalProduct / Agent) ────────────────────────────────────
// advancesTo DERIVES from LIFECYCLE_STAGE_TRANSITIONS so the legal map has one source and the
// two cannot drift. Flat LifecycleStatus maps to a band per stage entry state.
function backboneStageDef(stage: LifecycleStage) {
  const advancesTo = LIFECYCLE_STAGE_TRANSITIONS[stage];
  const isTerminal = advancesTo.length === 0;
  return {
    key: stage,
    label: stage.charAt(0).toUpperCase() + stage.slice(1),
    advancesTo,
    isTerminal,
    states: [
      // `active` is the exit-ready operational condition; `draft` is on-track pre-activation;
      // `inactive` (retirement) is terminal within the stage.
      { key: "active", label: "Active", band: "ready" as const, isEntry: true, isExitReady: !isTerminal },
      { key: "draft", label: "Draft", band: "on-track" as const },
      { key: "inactive", label: "Inactive", band: "on-track" as const },
    ],
  };
}

export const BACKBONE_GRAMMAR: LifecycleGrammar = {
  key: "backbone",
  label: "Governed-thing backbone",
  stages: LIFECYCLE_STAGES.map(backboneStageDef),
};

// ─── tech-currency ─────────────────────────────────────────────────────────────────────
// Each currency value is both a stage and its own band. Consumed by BI-6328BCA6.
export const TECH_CURRENCY_GRAMMAR: LifecycleGrammar = {
  key: "tech-currency",
  label: "Technology currency (EOL)",
  stages: [
    {
      key: "current",
      label: "Current",
      advancesTo: ["approaching-eol"],
      states: [{ key: "current", label: "Current", band: "on-track", isEntry: true, isExitReady: true }],
    },
    {
      key: "approaching-eol",
      label: "Approaching EOL",
      advancesTo: ["unsupported", "end-of-life"],
      states: [{ key: "approaching-eol", label: "Approaching EOL", band: "blocked", isEntry: true, isExitReady: true }],
    },
    {
      key: "unsupported",
      label: "Unsupported",
      advancesTo: ["end-of-life"],
      states: [{ key: "unsupported", label: "Unsupported", band: "blocked", isEntry: true, isExitReady: true }],
    },
    {
      key: "end-of-life",
      label: "End of life",
      advancesTo: [],
      isTerminal: true,
      states: [{ key: "end-of-life", label: "End of life", band: "blocked", isEntry: true }],
    },
  ],
};

// ─── ovsm ──────────────────────────────────────────────────────────────────────────────
// The six primary OVSM stages (packages/storefront-templates/src/operational-value-stream.ts).
// Minimal states; consumed/enriched by BI-9078F4EE + BI-A72D29BE.
const OVSM_PRIMARY_STAGES = ["attract", "capture", "qualify", "deliver", "settle", "retain"] as const;
export const OVSM_GRAMMAR: LifecycleGrammar = {
  key: "ovsm",
  label: "Operational value stream",
  stages: OVSM_PRIMARY_STAGES.map((stage, index) => {
    const next = OVSM_PRIMARY_STAGES[index + 1];
    return {
      key: stage,
      label: stage.charAt(0).toUpperCase() + stage.slice(1),
      advancesTo: next ? [next] : [],
      isTerminal: !next,
      states: [{ key: "in-stage", label: "In stage", band: "on-track" as const, isEntry: true, isExitReady: Boolean(next) }],
    };
  }),
};

// ─── Registry ────────────────────────────────────────────────────────────────────────
// ─── bookkeeping-room ──────────────────────────────────────────────────────────────────
// The recurring day-to-day books loop as a Work Room lifecycle (BI-F8B6CF81, slice S-ROOM of
// BI-1585FA9E — docs/superpowers/specs/2026-08-16-bookkeeping-work-room-design.md). Six stages
// carry a period from open to reconciled-and-closed: open → gather → import-categorize →
// reconcile → owner-review → closed. Each working stage names its real exception condition as a
// `blocked` state so a stalled period reads honestly (awaiting the owner's statement export, open
// transaction exceptions, an unexplained reconciliation gap, owner-requested changes) rather than
// looking on-track. `owner-review` is `ready` — the books are done and waiting only on the human.
export const BOOKKEEPING_ROOM_GRAMMAR: LifecycleGrammar = {
  key: "bookkeeping-room",
  label: "Bookkeeping period",
  stages: [
    {
      key: "open",
      label: "Open",
      advancesTo: ["gather"],
      exitCriteria: ["Period and accounts in scope confirmed", "Bookkeeper convened"],
      states: [{ key: "open", label: "Open", band: "on-track", isEntry: true, isExitReady: true }],
    },
    {
      key: "gather",
      label: "Gather",
      advancesTo: ["import-categorize"],
      exitCriteria: ["Statements and receipts for the period received"],
      states: [
        { key: "gathering", label: "Gathering", band: "on-track", isEntry: true, isExitReady: true },
        // The owner's card-statement export is the standing gate (spec §Standing blockers) — a
        // period waiting on it is blocked, not on-track.
        { key: "awaiting-documents", label: "Awaiting documents", band: "blocked" },
      ],
    },
    {
      key: "import-categorize",
      label: "Import & categorize",
      advancesTo: ["reconcile"],
      exitCriteria: [
        "Statement imported with provenance",
        "Every transaction categorized/matched or surfaced as an exception",
      ],
      states: [
        { key: "categorizing", label: "Categorizing", band: "on-track", isEntry: true, isExitReady: true },
        // An unmatched transaction with no explaining record stays an exception — never a forced match.
        { key: "exceptions-open", label: "Exceptions open", band: "blocked" },
      ],
    },
    {
      key: "reconcile",
      label: "Reconcile",
      advancesTo: ["owner-review"],
      exitCriteria: ["Book balance reconciled to the statement", "Any difference explained by named open items"],
      states: [
        { key: "reconciling", label: "Reconciling", band: "on-track", isEntry: true, isExitReady: true },
        // An unexplained difference is a finding, not a plug.
        { key: "unreconciled", label: "Unreconciled", band: "blocked" },
      ],
    },
    {
      key: "owner-review",
      label: "Owner review",
      advancesTo: ["closed"],
      exitCriteria: ["Owner reviewed the Outcome Packet", "Consequential writes approved"],
      states: [
        { key: "in-review", label: "In review", band: "ready", isEntry: true, isExitReady: true },
        { key: "changes-requested", label: "Changes requested", band: "blocked" },
      ],
    },
    {
      key: "closed",
      label: "Closed",
      advancesTo: [],
      isTerminal: true,
      states: [
        { key: "closed", label: "Closed", band: "on-track", isEntry: true },
        { key: "cancelled", label: "Cancelled", band: "on-track" },
      ],
    },
  ],
};

/** Map a stored bookkeeping-period status → its (stage, state) point in the grammar. The period's
 *  status is supplied by the room loader (S-TRIG wires the live period source); unknown values fall
 *  back to the `open` entry, the earliest stage. */
export function resolveBookkeepingRoomPoint(status: string): LifecyclePoint {
  switch (status) {
    case "open":
      return { stage: "open", state: "open" };
    case "gathering":
      return { stage: "gather", state: "gathering" };
    case "awaiting-documents":
      return { stage: "gather", state: "awaiting-documents" };
    case "categorizing":
      return { stage: "import-categorize", state: "categorizing" };
    case "exceptions-open":
      return { stage: "import-categorize", state: "exceptions-open" };
    case "reconciling":
      return { stage: "reconcile", state: "reconciling" };
    case "unreconciled":
      return { stage: "reconcile", state: "unreconciled" };
    case "in-review":
      return { stage: "owner-review", state: "in-review" };
    case "changes-requested":
      return { stage: "owner-review", state: "changes-requested" };
    case "closed":
      return { stage: "closed", state: "closed" };
    case "cancelled":
      return { stage: "closed", state: "cancelled" };
    default:
      return { stage: "open", state: "open" };
  }
}

// ─── Registry ────────────────────────────────────────────────────────────────
export const LIFECYCLE_GRAMMARS: Record<string, LifecycleGrammar> = {
  [CUSTOMER_ACCOUNT_GRAMMAR.key]: CUSTOMER_ACCOUNT_GRAMMAR,
  [OPPORTUNITY_GRAMMAR.key]: OPPORTUNITY_GRAMMAR,
  [BACKBONE_GRAMMAR.key]: BACKBONE_GRAMMAR,
  [TECH_CURRENCY_GRAMMAR.key]: TECH_CURRENCY_GRAMMAR,
  [OVSM_GRAMMAR.key]: OVSM_GRAMMAR,
  [BOOKKEEPING_ROOM_GRAMMAR.key]: BOOKKEEPING_ROOM_GRAMMAR,
};

/**
 * Entity kinds each grammar applies to. This is the grammar's OWN kind vocabulary for the
 * LifecycleEvent write path (recordLifecycleTransition), kept SEPARATE from the closed EA
 * GOVERNED_THING_KINDS allowlist in governed-thing-ref.ts so grammar entities can log events
 * without being dragged into the resolveLifecycle cascade. See spec §4.2.
 */
export const LIFECYCLE_GRAMMAR_KINDS: Record<string, string> = {
  CustomerAccount: "customer-account",
  Opportunity: "opportunity",
};

export function getGrammar(key: string): LifecycleGrammar | null {
  return LIFECYCLE_GRAMMARS[key] ?? null;
}

/** Grammar key for a governed-thing kind, if that kind is grammar-driven. */
export function grammarKeyForKind(kind: string): string | null {
  return LIFECYCLE_GRAMMAR_KINDS[kind] ?? null;
}

// Fail fast: every declared grammar is validated at module load (dev + test).
for (const grammar of Object.values(LIFECYCLE_GRAMMARS)) {
  validateGrammar(grammar);
}
