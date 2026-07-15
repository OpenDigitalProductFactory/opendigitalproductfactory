// apps/web/lib/workspace-home/twin-panel-data.ts
//
// The workspace-home twin seam (EP-LIVING-BUSINESS-VIZ P3, increment 2). Resolves
// the org's archetype into a rendered operational twin for the /workspace hero:
// slug -> ALL_ARCHETYPES -> deriveTwinProfile -> snapshot. Pure, total (returns
// null rather than throwing when no definition resolves), and DB-free — the page
// already loads StorefrontConfig.archetype and hands the slug + name in.
//
// Plan: docs/superpowers/plans/2026-07-15-twin-workspace-home-placement-execution.md
// Renderer (sibling-owned, not edited here): apps/web/components/twin/TwinView.tsx

import {
  ALL_ARCHETYPES,
  deriveTwinProfile,
  type TwinProfile,
} from "@dpf/storefront-templates";

import { buildDemoTwinSnapshot, type TwinSnapshot } from "@/components/twin";

export interface WorkspaceTwinPresentation {
  archetypeId: string;
  archetypeName: string;
  profile: TwinProfile;
  snapshot: TwinSnapshot;
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
    demo,
  };
}
