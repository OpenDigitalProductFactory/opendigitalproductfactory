import type { ArchetypeDefinition } from "./types";
import { deriveTwinProfile, type TwinProfile, type TwinTemplate } from "./twin-profile";
import {
  deriveOperationalValueStream,
  type OperationalValueStream,
  type OperationalValueStreamStageKey,
} from "./operational-value-stream";

/**
 * Twin ⇄ Value-Stream grounding (EP-LIVING-BUSINESS-EXCELLENCE, workstream C).
 *
 * The operational twin (`deriveTwinProfile`) renders *space* — zones and demand
 * queues; the operational value stream (`deriveOperationalValueStream`) renders
 * *flow* — the six-stage backbone (Attract → Capture → Qualify → Deliver → Settle
 * → Retain, plus cross-cuts). Until now they were two disjoint sibling
 * derivations, so the animation view and the architecture view were unrelated
 * pictures of the same business.
 *
 * `deriveTwinValueStreamBinding` closes that gap: it binds each twin queue and
 * zone to the value-stream stage its work actually sits in, so the twin's tiles
 * map to the archetype's real process — the factory-automation lens of "queue
 * depth + wait per stage". One pure derivation, consumed by the demo generator
 * (per-stage demand), the live projection (per-stage flow), and the architecture
 * view (the same stage labels).
 *
 * Design: docs/superpowers/specs/2026-07-15-living-business-excellence-program-design.md §2 (row C)
 * Parent: docs/superpowers/specs/2026-07-12-operational-twin-framework-design.md
 *
 * PURE + DB-free + deterministic. The seventh member of the derive family.
 */

export interface TwinStageBinding {
  stageKey: OperationalValueStreamStageKey;
  stageLabel: string;
  order: number;
  loadBearing: boolean;
  /** Twin queue keys whose demand sits at this stage. */
  queueKeys: string[];
  /** Twin zone keys where this stage's work physically happens. */
  zoneKeys: string[];
  /** True when this stage comes from the universal backbone that a leaf profile
   *  composes with (BI-4B11F98E) rather than from the archetype's own lanes. An
   *  archetype with no leaf profile has no inherited stages: its backbone IS its
   *  stream. */
  inherited: boolean;
}

export interface TwinValueStreamBinding {
  archetypeId: string;
  archetypeName: string;
  template: TwinTemplate;
  /** The archetype's OVS stages in order, each with the twin queues/zones bound to it. */
  stages: TwinStageBinding[];
  /** Every twin queue key → its value-stream stage. */
  queueToStage: Record<string, OperationalValueStreamStageKey>;
  /** Every twin zone key → its value-stream stage. */
  zoneToStage: Record<string, OperationalValueStreamStageKey>;
  /** The single stage that carries the archetype's primary demand (its load-bearing lens). */
  primaryStageKey: OperationalValueStreamStageKey;
}

// ── Keyword → stage rules ──────────────────────────────────────────────────────
// Ordered, first-match-wins; clamped to the stages the archetype actually has.

interface Rule {
  test: RegExp;
  stage: OperationalValueStreamStageKey;
}

const QUEUE_RULES: Rule[] = [
  { test: /(renew|at-?risk|laps|retain|grant|shift|moves)/, stage: "retain" },
  { test: /(inspect|compliance|obligation)/, stage: "trust-compliance" },
  { test: /(dispatch|schedul|promised|deadline|approv)/, stage: "qualify" },
  { test: /(review|wip|in-?progress|bay)/, stage: "deliver" },
  { test: /(return)/, stage: "return-inspect" },
  // The demand-capture family (intake/waitlist/requests/reservations/walkins/
  // checkins/holds/tickets/pickups/restock/ctas/online) is handled by the
  // primary-stage fallback so it tracks where THIS archetype captures value.
];

const ZONE_RULES: Rule[] = [
  { test: /(entrance|waitlist|intake|queue|online|back)/, stage: "capture" },
  { test: /(grid|book|calendar|day)/, stage: "qualify" },
  { test: /(return)/, stage: "return-inspect" },
  { test: /(maintenance)/, stage: "operate-improve" },
  { test: /(inspection)/, stage: "trust-compliance" },
  { test: /(ready|pickup|out)/, stage: "settle" },
  { test: /(kitchen|floor|bays?|map|runofshow|pipeline|programs|board|room|base|moves)/, stage: "deliver" },
];

function clamp(
  stage: OperationalValueStreamStageKey,
  available: ReadonlySet<OperationalValueStreamStageKey>,
  fallback: OperationalValueStreamStageKey,
): OperationalValueStreamStageKey {
  return available.has(stage) ? stage : fallback;
}

function primaryStage(ovs: OperationalValueStream): OperationalValueStreamStageKey {
  // The first load-bearing stage is where the archetype's value is captured or
  // committed; it is the home of the primary demand queue.
  return ovs.loadBearingStageKeys[0] ?? "capture";
}

function matchRule(
  key: string,
  rules: Rule[],
  available: ReadonlySet<OperationalValueStreamStageKey>,
  fallback: OperationalValueStreamStageKey,
): OperationalValueStreamStageKey {
  const k = key.toLowerCase();
  for (const rule of rules) {
    if (rule.test.test(k)) return clamp(rule.stage, available, fallback);
  }
  return fallback;
}

/**
 * Bind an archetype's twin queues and zones to its value-stream stages. Pure and
 * total: every queue and zone resolves to a stage the archetype actually has.
 */
export function deriveTwinValueStreamBinding(archetype: ArchetypeDefinition): TwinValueStreamBinding {
  const profile: TwinProfile = deriveTwinProfile(archetype);
  const ovs = deriveOperationalValueStream(archetype);
  const available = new Set<OperationalValueStreamStageKey>(ovs.stages.map((s) => s.key));
  const primary = clamp(primaryStage(ovs), available, "capture");

  const queueToStage: Record<string, OperationalValueStreamStageKey> = {};
  for (const queue of profile.queues) {
    // Capture-family queues track the primary stage; the rest match by keyword.
    queueToStage[queue.key] = matchRule(queue.key, QUEUE_RULES, available, primary);
  }

  const zoneToStage: Record<string, OperationalValueStreamStageKey> = {};
  for (const zone of profile.zones) {
    zoneToStage[zone.key] = matchRule(zone.key, ZONE_RULES, available, primary);
  }

  const hasLeafProfile = ovs.streams.some((stream) => stream.key !== "operational-value-stream");
  const stages: TwinStageBinding[] = ovs.stages
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      stageKey: s.key,
      stageLabel: s.label,
      order: s.order,
      loadBearing: s.loadBearing,
      inherited: hasLeafProfile && s.streamKey === "operational-value-stream",
      queueKeys: profile.queues.filter((q) => queueToStage[q.key] === s.key).map((q) => q.key),
      zoneKeys: profile.zones.filter((z) => zoneToStage[z.key] === s.key).map((z) => z.key),
    }));

  return {
    archetypeId: archetype.archetypeId,
    archetypeName: archetype.name,
    template: profile.template,
    stages,
    queueToStage,
    zoneToStage,
    primaryStageKey: primary,
  };
}
