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

import { buildDemoTwinSnapshot } from "@/components/twin/demo-snapshot";
import type { TwinSnapshot } from "@/components/twin/snapshot";
import { loadVersionedOperationsSnapshot } from "@/lib/twin/operations-loader";
import {
  toLivingBusinessSnapshot,
  type OperationsSnapshotTelemetry,
} from "@/lib/twin/operations-snapshot";
import {
  loadOrCreateRestaurantScene,
  type OperationalSceneLayoutDatabase,
  type RestaurantOperationalScene,
} from "@/lib/twin/restaurant-scene-layout";
import {
  loadRestaurantFloorOperationalView,
  type RestaurantFloorDatabase,
  type RestaurantFloorOperationalView,
} from "@/lib/twin/restaurant-floor-loader.server";
import {
  type RoomsDomain,
  type RoomsOperationalView,
} from "@/lib/twin/rooms-operations";
import { buildDemoRoomsOperationalView } from "@/lib/twin/rooms-operations-demo";

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
  scene: RestaurantOperationalScene | null;
  restaurantFloor: RestaurantFloorOperationalView | null;
  roomsOperations: RoomsOperationalView | null;
  roomsOperationsDemo: boolean;
  /**
   * True while the snapshot is deterministic demo fixture data — the live
   * `LivingBusinessSnapshot` projection (parent spec P4) has not been wired.
   * Drives the "Demo data" badge so a zeros-free demo board is never mistaken
   * for live state.
   */
  demo: boolean;
}

function roomsDomainForArchetype(archetypeId: string): RoomsDomain {
  if (/(pet|boarding|kennel|shelter)/i.test(archetypeId)) return "boarding";
  if (/(clinic|dental|medical|health|care|inpatient)/i.test(archetypeId)) {
    return "care";
  }
  return "lodging";
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
    scene: null,
    restaurantFloor: null,
    roomsOperations:
      profile.template === "ROOMS"
        ? buildDemoRoomsOperationalView({
            domain: roomsDomainForArchetype(archetypeId),
            roomCount: 40,
          })
        : null,
    roomsOperationsDemo: profile.template === "ROOMS",
    demo,
  };
}

async function loadRestaurantWorkspaceFloor(
  dbInput: unknown,
  archetypeId: string,
  now?: Date,
): Promise<RestaurantFloorOperationalView | null> {
  try {
    const db =
      dbInput ??
      ((await import("@dpf/db")).prisma as unknown);
    const client = db as RestaurantFloorDatabase & {
      storefrontConfig: {
        findFirst(input: unknown): Promise<{
          id: string;
          organizationId: string;
        } | null>;
      };
    };
    if (
      !client.hospitalityResource ||
      !client.hospitalityCapacityAllocation ||
      !client.storefrontBooking ||
      !client.bookingHold ||
      !client.staffingResourceLink ||
      !client.employeeProfile
    ) {
      return null;
    }
    const config = await client.storefrontConfig.findFirst({
      where: { archetype: { archetypeId } },
      select: { id: true, organizationId: true },
    });
    if (!config?.organizationId) return null;
    return await loadRestaurantFloorOperationalView(client, {
      organizationId: config.organizationId,
      storefrontId: config.id,
      now,
    });
  } catch {
    return null;
  }
}

async function loadRestaurantWorkspaceScene(
  dbInput: unknown,
  archetypeId: string,
): Promise<RestaurantOperationalScene | null> {
  try {
    const db =
      dbInput ??
      ((await import("@dpf/db")).prisma as unknown);
    const client = db as {
      storefrontConfig: {
        findFirst(input: unknown): Promise<{
          id: string;
          organization: { orgId: string };
          archetype: { name: string } | null;
          hospitalityResources: Array<{
            id: string;
            label: string;
            capacity: number;
            serviceArea: string | null;
            attributes: unknown;
          }>;
        } | null>;
      };
    } & OperationalSceneLayoutDatabase;
    if (!client.operationalSceneLayout) return null;
    const config = await client.storefrontConfig.findFirst({
      where: { archetype: { archetypeId } },
      select: {
        id: true,
        organization: { select: { orgId: true } },
        archetype: { select: { name: true } },
        hospitalityResources: {
          where: { kind: "table", status: { not: "retired" } },
          select: {
            id: true,
            label: true,
            capacity: true,
            serviceArea: true,
            attributes: true,
          },
        },
      },
    });
    if (!config || config.hospitalityResources.length === 0) return null;
    return await loadOrCreateRestaurantScene({
      database: client,
      orgId: config.organization.orgId,
      locationId: config.id,
      locationLabel: `${config.archetype?.name ?? "Restaurant"} floor`,
      tables: config.hospitalityResources,
    });
  } catch {
    return null;
  }
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
  const isFloor = base.profile.template === "FLOOR";
  // These projections are independent read models. Run them concurrently so
  // the host is not waiting on scene IO, live floor joins, then the generic
  // operations snapshot in series during a customer-facing interaction.
  const [scene, restaurantFloor, operations] = await Promise.all([
    isFloor
      ? loadRestaurantWorkspaceScene(opts?.db, base.archetypeId)
      : Promise.resolve(null),
    isFloor
      ? loadRestaurantWorkspaceFloor(opts?.db, base.archetypeId, opts?.now)
      : Promise.resolve(null),
    loadVersionedOperationsSnapshot(opts).catch(() => null),
  ]);
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
      scene,
      restaurantFloor,
      demo: false,
    };
  }
  return { ...base, scene, restaurantFloor };
}
