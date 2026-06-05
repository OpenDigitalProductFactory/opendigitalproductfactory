// apps/web/lib/workspace-home/activation-orchestrator/signal-registry.ts
//
// Maps signal-kind keys declared by a WorkspaceHomeContribution's
// `setupActivation.requiredSignals[]` to the projection-service loader IDs
// they bind to.
//
// The projection-service spec lives at
// `docs/superpowers/specs/2026-06-04-vertical-workspace-home-projections-design.md`
// (BI-3E8D2CF5, PR #1452). Its impl hasn't shipped yet; the registry entries
// below name the loader IDs the spec promises so the orchestrator can detect
// "projection-service gap" cases honestly and emit a setup task pointing at
// BI-3E8D2CF5 when a contribution declares a signal kind no loader exists for.
//
// Per the plan (PR #1464 §Phase 1): the registry has a `bound` field
// distinguishing "kind has a loader-id mapping" from "the projection service
// is actually implemented and can serve it." Until BI-3E8D2CF5 lands, every
// known kind has `bound: false`. Once the projection-service impl ships, this
// file flips entries to `bound: true` by reference (no contribution change
// required).

/** A single signal-kind binding entry. */
export type SignalRegistryEntry = {
  /** The projection-service loader id the kind binds to (per PR #1452 spec). */
  loaderId: string;
  /**
   * Whether the projection service can currently serve this loader. False
   * until BI-3E8D2CF5's impl lands the corresponding loader function.
   */
  bound: boolean;
  /** Human-readable description; surfaces in setup-task copy when bound=false. */
  description: string;
};

/**
 * The substrate-known set of signal-kind keys.
 *
 * IDs sourced from the projection-service spec §5.1-5.3 (translation rules).
 * `bound: false` everywhere until BI-3E8D2CF5 ships — the registry distinguishes
 * "declared signal" from "served signal" so the orchestrator can emit the right
 * setup task per case.
 */
export const DEFAULT_SIGNAL_REGISTRY: Readonly<Record<string, SignalRegistryEntry>> = {
  "communication-failed": {
    loaderId: "gear-interface.slip-reason.failed-outcome",
    bound: false,
    description: "Customer notifications that failed to deliver",
  },
  "coworker-handoff": {
    loaderId:
      "coworker-action-envelope.proposed-joined-with-governor.require-hitl",
    bound: false,
    description: "Pending PAR acknowledgements + Governor require-hitl decisions",
  },
  "governor-require-hitl": {
    loaderId: "governor.verdict.require-hitl",
    bound: false,
    description: "Decisions awaiting human-in-the-loop confirmation",
  },
  "scheduled-work": {
    loaderId: "calendar-event.upcoming",
    bound: false,
    description: "Upcoming work scheduled on the calendar",
  },
  "urgent-exception": {
    loaderId: "gear-interface.slip-reason.urgent-exception",
    bound: false,
    description: "Work items flagged as urgent or blocked",
  },
};

/** Look up a registry entry, returning null for unknown signal kinds. */
export function getSignalEntry(
  kind: string,
  registry: Readonly<Record<string, SignalRegistryEntry>> = DEFAULT_SIGNAL_REGISTRY,
): SignalRegistryEntry | null {
  return registry[kind] ?? null;
}
