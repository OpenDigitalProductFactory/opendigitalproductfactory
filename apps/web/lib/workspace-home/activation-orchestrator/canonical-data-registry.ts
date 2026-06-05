// apps/web/lib/workspace-home/activation-orchestrator/canonical-data-registry.ts
//
// Maps canonical-data keys declared by a WorkspaceHomeContribution's
// `setupActivation.requiredCanonicalData[]` to the Prisma queries that count
// satisfying rows on the live install.
//
// Initial entries cover the HVAC-shaped + dental + restaurant proving installs.
// New contributions land by adding entries here; an unregistered key in a
// contribution surfaces as `satisfied: false, sample: null` from the walker
// plus an [orchestrator-unknown-canonical-data] log so the gap is visible
// rather than silent.
//
// Per the plan (PR #1464 §Phase 1): the registry is a code change with type-
// system enforcement. No runtime sandbox; no per-archetype seed code.

import type { PrismaClient } from "@dpf/db";

/** A single canonical-data declaration's count contract. */
export type CanonicalDataRegistryEntry = {
  /** Human-readable Prisma model name; surfaces in setup-task copy. */
  tableName: string;
  /** Minimum row count for the install to be considered "has data" for this key. */
  expectedMin: number;
  /** Count satisfying rows on the install. Pure read; no writes. */
  count(prisma: PrismaClient): Promise<number>;
};

/**
 * The substrate-known set of canonical-data declaration keys.
 *
 * Order is alphabetical for readability. Each entry uses prisma's count() —
 * cheap, indexed, no row materialization.
 */
export const DEFAULT_CANONICAL_DATA_REGISTRY: Readonly<
  Record<string, CanonicalDataRegistryEntry>
> = {
  "calendar-event": {
    tableName: "CalendarEvent",
    expectedMin: 1,
    count: (prisma) => prisma.calendarEvent.count(),
  },
  "communication-delivery-attempt": {
    tableName: "CommunicationDeliveryAttempt",
    expectedMin: 1,
    count: (prisma) => prisma.communicationDeliveryAttempt.count(),
  },
  "customer-account": {
    tableName: "CustomerAccount",
    expectedMin: 1,
    count: (prisma) => prisma.customerAccount.count(),
  },
  "customer-configuration-item": {
    tableName: "CustomerConfigurationItem",
    expectedMin: 1,
    count: (prisma) => prisma.customerConfigurationItem.count(),
  },
  "work-item": {
    tableName: "WorkItem",
    expectedMin: 1,
    // HVAC narrows to `sourceType = "field-service-job"`. Other archetypes
    // declare the same `work-item` key against different sourceTypes; the
    // registry stays generic and per-archetype overrides land as separate
    // entries (e.g. `"work-item-field-service"`) when evidence justifies.
    count: (prisma) => prisma.workItem.count(),
  },
  "work-schedule": {
    tableName: "WorkSchedule",
    expectedMin: 1,
    count: (prisma) => prisma.workSchedule.count(),
  },
};

/** Look up a registry entry, returning null for unknown keys. */
export function getCanonicalDataEntry(
  key: string,
  registry: Readonly<Record<string, CanonicalDataRegistryEntry>> = DEFAULT_CANONICAL_DATA_REGISTRY,
): CanonicalDataRegistryEntry | null {
  return registry[key] ?? null;
}
