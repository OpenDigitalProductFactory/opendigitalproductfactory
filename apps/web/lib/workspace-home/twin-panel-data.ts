// apps/web/lib/workspace-home/twin-panel-data.ts
//
// The workspace-home twin seam (EP-LIVING-BUSINESS-VIZ P3, increment 2). Resolves
// the org's archetype into a rendered operational twin for the /workspace hero:
// slug -> ALL_ARCHETYPES -> deriveTwinProfile -> snapshot.
//
// Two resolvers share one presentation shape:
//   - resolveWorkspaceTwinPresentation — pure, total, DB-free; deterministic DEMO
//     snapshot (used by tests and as the always-available fallback).
//   - loadWorkspaceTwinPresentation — async; overlays the real
//     `LivingBusinessSnapshot` projection when an org is configured, else falls
//     back to the demo. This is the wired demo -> real path.
//
// Plan: docs/superpowers/plans/2026-07-15-twin-workspace-home-placement-execution.md
// Renderer (sibling-owned, not edited here): apps/web/components/twin/TwinView.tsx

import {
  ALL_ARCHETYPES,
  deriveTwinProfile,
  type TwinProfile,
} from "@dpf/storefront-templates";

import { buildDemoTwinSnapshot, type TwinSnapshot } from "@/components/twin";
import { loadVersionedOperationsSnapshot } from "@/lib/twin/operations-loader";
import {
  toLivingBusinessSnapshot,
  type OperationsSnapshotTelemetry,
} from "@/lib/twin/operations-snapshot";

export interface WorkspaceTwinPresentation {
  archetypeId: string;
  archetypeName: string;
  profile: TwinProfile;
  snapshot: TwinSnapshot;
  operations: {
    version: string;
    asOf: string;
    sourceWatermark: string | null;
    freshness: "current" | "stale" | "degraded";
    degradedSourceCount: number;
    telemetry: OperationsSnapshotTelemetry;
  } | null;
  /**
   * True while the snapshot is deterministic demo fixture data — the live
   * `LivingBusinessSnapshot` projection (parent spec P4) has not been wired.
   * Drives the "Demo data" badge so a zeros-free demo board is never mistaken
   * for live state.
   */
  demo: boolean;
}

// ─── THE DEMO → REAL SEAM ─────────────────────────────────────────────────────
// The single place a workspace-home twin snapshot is produced. Today it returns
// deterministic demo fixture data. When the sibling `LivingBusinessSnapshot`
// projection lands it fills the SAME `TwinSnapshot` shape, so swapping this one
// function body (and flipping `demo` to false) is the entire change — nothing
// else on this surface moves.
function produceWorkspaceTwinSnapshot(profile: TwinProfile): {
  snapshot: TwinSnapshot;
  demo: boolean;
} {
  return { snapshot: buildDemoTwinSnapshot(profile), demo: true };
}
// ──────────────────────────────────────────────────────────────────────────────

/**
 * The workspace home is NOT the twin's own attention surface: `OperatorCockpit`
 * is the single "what needs you now" surface here (BI-8C3EB52C). Strip the twin's
 * rival needs-you `quests` and its HITL `cog` so exactly one attention/decision
 * surface renders on the home. This is a property of the home mount, not of the
 * data source, so it persists after the demo → real swap above.
 */
function condenseForWorkspaceHome(snapshot: TwinSnapshot): TwinSnapshot {
  return { ...snapshot, cog: undefined, quests: [] };
}

/**
 * Resolve the org's operational twin for the workspace home, or `null` when the
 * archetype slug has no derivable definition (unconfigured org, or a slug not in
 * `ALL_ARCHETYPES`). Never throws — a resolution failure falls back to the
 * existing workspace home.
 */
export function resolveWorkspaceTwinPresentation(
  archetypeId: string | null | undefined,
  archetypeName?: string | null,
): WorkspaceTwinPresentation | null {
  if (!archetypeId) return null;
  const def = ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId);
  if (!def) return null;

  const profile = deriveTwinProfile(def);
  const { snapshot, demo } = produceWorkspaceTwinSnapshot(profile);
  return {
    archetypeId,
    archetypeName: archetypeName?.trim() || def.name,
    profile,
    snapshot: condenseForWorkspaceHome(snapshot),
    operations: null,
    demo,
  };
}

/**
 * The LIVE workspace-home twin (EP-LIVING-BUSINESS-VIZ P3, increment 2 — wired).
 * Overlays the real `LivingBusinessSnapshot` projection onto the resolved
 * presentation: when an org is configured and its archetype matches, the panel
 * renders live business data (`demo: false`); otherwise it falls back to the
 * deterministic demo above. Never throws — a projection failure degrades to demo,
 * so the home always renders. The home-mount condensing (drop the twin's rival
 * `cog`/`quests` so `OperatorCockpit` stays the single attention surface) applies
 * to the live snapshot too.
 */
export async function loadWorkspaceTwinPresentation(
  archetypeId: string | null | undefined,
  archetypeName?: string | null,
  opts?: Parameters<typeof loadVersionedOperationsSnapshot>[0],
): Promise<WorkspaceTwinPresentation | null> {
  const base = resolveWorkspaceTwinPresentation(archetypeId, archetypeName);
  if (!base) return null;
  try {
    const operations = await loadVersionedOperationsSnapshot(opts);
    if (operations && operations.identity.archetypeId === base.archetypeId) {
      return {
        ...base,
        snapshot: condenseForWorkspaceHome(toLivingBusinessSnapshot(operations)),
        operations: {
          version: operations.version,
          asOf: operations.asOf,
          sourceWatermark: operations.sourceWatermark,
          freshness: operations.freshness,
          degradedSourceCount: operations.degradedSources.length,
          telemetry: operations.telemetry,
        },
        demo: false,
      };
    }
  } catch {
    // Projection failed (no DB in this context, transient error) — keep the demo.
  }
  return base;
}
