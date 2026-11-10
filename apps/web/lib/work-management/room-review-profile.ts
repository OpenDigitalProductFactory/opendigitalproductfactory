import { createHash } from "node:crypto";
import type { RoomReviewLayer, RoomReviewRequirement } from "./room-definition-contract";
import { getCanonicalWorkCaseSourceEntry, WORK_CASE_SOURCE_REGISTRY } from "./source-registry";
import { roomReviewLayers } from "./room-review-profile-catalog";

const ORDER: RoomReviewLayer["kind"][] = ["common", "source", "shape", "facet", "category", "leaf", "organization"];
const sorted = (values: readonly string[]) => [...new Set(values)].sort();
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export interface EffectiveRoomReviewRequirement extends RoomReviewRequirement {
  provenance: string[];
}

function normalizeRequirement(r: RoomReviewRequirement): RoomReviewRequirement {
  return { ref: r.ref, outcome: r.outcome, denominator: r.denominator,
    evidence: sorted(r.evidence), criticalFailures: sorted(r.criticalFailures),
    ...(r.maxAgeSeconds !== undefined ? { maxAgeSeconds: r.maxAgeSeconds } : {}) };
}

/**
 * Deterministic, additive composition. There is deliberately no delete/waive
 * operation: exceptions require a separate governed decision, never an overlay.
 * These read contracts do not assess evidence, authorize a write, or qualify a
 * profile for promotion. Consumers retain the fingerprint with their cycle.
 */
export function composeRoomReviewProfile(sourceKey: string, layers: readonly RoomReviewLayer[]) {
  const source = getCanonicalWorkCaseSourceEntry(sourceKey);
  const conflicts = new Set<string>();
  const requirements = new Map<string, EffectiveRoomReviewRequirement>();
  const versions = new Map<string, string>();
  const ordered = [...roomReviewLayers(sourceKey), ...layers].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || compareText(a.ref, b.ref));
  if (!ordered.some(l => l.kind === "common" && l.requirements.length > 0)) conflicts.add("missing-common-profile");
  for (const layer of ordered) {
    const normalized = layer.requirements.map(normalizeRequirement).sort((a, b) => compareText(a.ref, b.ref));
    const payload = JSON.stringify({ kind: layer.kind, requirements: normalized });
    if (!/@[^\s@]+$/.test(layer.ref) || !ORDER.includes(layer.kind)) conflicts.add(`invalid-layer:${layer.ref}`);
    if (versions.has(layer.ref) && versions.get(layer.ref) !== payload) conflicts.add(`layer-version-conflict:${layer.ref}`);
    versions.set(layer.ref, payload);
    for (const r of normalized) {
      if (!r.ref.trim() || !r.outcome.trim() || !r.denominator.trim()
        || [...r.evidence, ...r.criticalFailures].some(value => !value.trim())
        || (r.maxAgeSeconds !== undefined && (!Number.isFinite(r.maxAgeSeconds) || r.maxAgeSeconds <= 0))) {
        conflicts.add(`invalid-requirement:${r.ref}`);
      }
      const prior = requirements.get(r.ref);
      if (prior && (prior.outcome !== r.outcome || prior.denominator !== r.denominator)) conflicts.add(`requirement-conflict:${r.ref}`);
      const ages = [prior?.maxAgeSeconds, r.maxAgeSeconds].filter((v): v is number => v !== undefined);
      requirements.set(r.ref, { ...r, evidence: sorted([...(prior?.evidence ?? []), ...r.evidence]),
        criticalFailures: sorted([...(prior?.criticalFailures ?? []), ...r.criticalFailures]),
        ...(ages.length ? { maxAgeSeconds: Math.min(...ages) } : {}),
        provenance: sorted([...(prior?.provenance ?? []), layer.ref]) });
    }
  }
  const status = !source ? "unsupported" as const : conflicts.size ? "unresolved" as const : "resolved" as const;
  const resolved = [...requirements.values()].sort((a, b) => compareText(a.ref, b.ref));
  const identity = source ? { sourceKey: source.sourceKey, definitionVersion: source.definitionVersion } : null;
  const provenance = [...versions.keys()].sort();
  return { status, identity, requirements: resolved, provenance, conflicts: [...conflicts].sort(),
    fingerprint: status === "resolved" ? fingerprint({ identity, requirements: resolved, layers: [...versions.entries()].sort(([a], [b]) => compareText(a, b)) }) : null };
}

/** Bounded definition inventory; it never projects occurrence counts as assessment. */
export function listRoomReviewDefinitions({ limit = 50, after }: { limit?: number; after?: string } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("Review definition page limit must be 1–200.");
  const entries = new Map<string, { sourceKey: string; definitionVersion: number; aliases: string[]; assessment: "not-exercised" }>();
  for (const entry of WORK_CASE_SOURCE_REGISTRY) {
    const canonical = getCanonicalWorkCaseSourceEntry(entry.sourceKey);
    if (!canonical) throw new Error(`Invalid canonical source definition: ${entry.sourceKey}`);
    const item = entries.get(canonical.sourceKey) ?? { sourceKey: canonical.sourceKey, definitionVersion: canonical.definitionVersion, aliases: [], assessment: "not-exercised" as const };
    if (entry.sourceKey !== canonical.sourceKey) item.aliases.push(entry.sourceKey);
    entries.set(canonical.sourceKey, item);
  }
  const all = [...entries.values()].map(item => ({ ...item, aliases: sorted(item.aliases) })).sort((a, b) => compareText(a.sourceKey, b.sourceKey));
  const inventoryFingerprint = fingerprint(all);
  const cursor = after?.split("|");
  if (cursor && (cursor.length !== 2 || cursor[0] !== inventoryFingerprint || !entries.has(cursor[1]!))) {
    throw new Error("Stale or unknown review definition cursor; restart the inventory.");
  }
  const start = cursor === undefined ? 0 : all.findIndex(e => e.sourceKey === cursor[1]) + 1;
  const items = all.slice(start, start + limit).map(item => ({ ...item, aliases: sorted(item.aliases) }));
  return { items, total: all.length, inventoryFingerprint, nextCursor: start + items.length < all.length ? `${inventoryFingerprint}|${items.at(-1)!.sourceKey}` : null };
}
