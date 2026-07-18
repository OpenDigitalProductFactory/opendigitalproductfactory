// apps/web/lib/govern/data/lifecycle-classes.ts
// BI-DG-002 (spec §6.1/§6.6): lifecycle class DECLARATIONS — not executors. Each class
// declares its retention/deletion posture as independent concepts (minima, maxima,
// holds, deletion prohibitions) that conflict-resolve separately at runtime; nothing
// here deletes anything. The retention engine (apps/web/lib/operate/retention) remains
// the executor; this module is the governance-facing declaration the PDP reasons over.
//
// Spec §6.6: retention minima, deletion maxima, and legal holds are DISTINCT — no
// "retention always wins". A deletion prohibition (prohibited storage, e.g. PCI SAD)
// outranks ordinary retention; a hold blocks routine deletion while active.

import type { LifecycleClassKey } from "./taxonomy";

export type LifecycleClassDeclaration = {
  key: LifecycleClassKey;
  description: string;
  /** True when records of this class may be subject to a legal hold. */
  holdEligible: boolean;
  /** True when a defined retention MINIMUM applies (kept at least that long). */
  hasRetentionMinimum: boolean;
  /** True when a deletion MAXIMUM applies (must not be kept past it, absent a hold). */
  hasDeletionMaximum: boolean;
  /**
   * True when storing this data past authorization is PROHIBITED — a hard constraint
   * that outranks ordinary retention (spec §6.5 precedence). Distinct from a maximum.
   */
  storageProhibitedPastPurpose: boolean;
  /** True when routine auto-purge sweeps may delete this class once its window lapses. */
  autoPurgeEligible: boolean;
};

const DECLARATIONS: readonly LifecycleClassDeclaration[] = [
  {
    key: "ephemeral",
    description: "Caches and derived copies rebuildable from an authoritative source.",
    holdEligible: false,
    hasRetentionMinimum: false,
    hasDeletionMaximum: false,
    storageProhibitedPastPurpose: false,
    autoPurgeEligible: true,
  },
  {
    key: "operational",
    description: "Ordinary business records, retained while the relationship is active.",
    holdEligible: true,
    hasRetentionMinimum: false,
    hasDeletionMaximum: false,
    storageProhibitedPastPurpose: false,
    autoPurgeEligible: false,
  },
  {
    key: "telemetry-bounded",
    description: "Logs, metrics, and traces purged past a bounded retention window.",
    holdEligible: false,
    hasRetentionMinimum: false,
    hasDeletionMaximum: true,
    storageProhibitedPastPurpose: false,
    autoPurgeEligible: true,
  },
  {
    key: "business-record",
    description: "Records kept for a defined business minimum before disposal.",
    holdEligible: true,
    hasRetentionMinimum: true,
    hasDeletionMaximum: false,
    storageProhibitedPastPurpose: false,
    autoPurgeEligible: false,
  },
  {
    key: "regulated-record",
    description: "Financial/tax/HR/consent records with a regulated retention minimum.",
    holdEligible: true,
    hasRetentionMinimum: true,
    hasDeletionMaximum: false,
    storageProhibitedPastPurpose: false,
    autoPurgeEligible: false,
  },
  {
    key: "security-audit",
    description: "Audit trails and detections with a regulated retention minimum.",
    holdEligible: true,
    hasRetentionMinimum: true,
    hasDeletionMaximum: false,
    storageProhibitedPastPurpose: false,
    autoPurgeEligible: false,
  },
  {
    key: "legal-evidence",
    description: "Hold-eligible evidence; routine deletion blocked while a hold is active.",
    holdEligible: true,
    hasRetentionMinimum: true,
    hasDeletionMaximum: false,
    storageProhibitedPastPurpose: false,
    autoPurgeEligible: false,
  },
];

const BY_KEY: ReadonlyMap<LifecycleClassKey, LifecycleClassDeclaration> = new Map(
  DECLARATIONS.map((d) => [d.key, d]),
);

export const LIFECYCLE_CLASS_DECLARATIONS = DECLARATIONS;

export function getLifecycleClass(key: LifecycleClassKey): LifecycleClassDeclaration {
  const decl = BY_KEY.get(key);
  if (!decl) {
    // Unreachable for a valid LifecycleClassKey; fail loud rather than silently
    // treating an unknown class as freely purgeable.
    throw new Error(`unknown lifecycle class: ${String(key)}`);
  }
  return decl;
}

/** Classes a routine auto-purge sweep may act on once their window lapses. */
export function autoPurgeableLifecycleClasses(): readonly LifecycleClassKey[] {
  return DECLARATIONS.filter((d) => d.autoPurgeEligible).map((d) => d.key);
}
