import {
  computeDemandPayloadDigest,
  validateDemandEnvelopeV1,
  type DemandAttribution,
  type DemandAudience,
  type DemandEnvelopeV1,
} from "@dpf/db/federated-demand-contract";
import {
  assertNoExcludedEgress,
  projectEstatePayload,
  type ProjectionContractSpec,
} from "@dpf/db/projection-serialization";

import { deriveDemandNetworkRefs, type FederationIdentity } from "./demand-identity";

export interface ProjectableDemandSource {
  localRecordRef: string;
  title: string;
  summary: string;
  workType?: string | null;
  occurrenceCount: number;
  product?: string | null;
  /** Planning scope of the item ("platform", "archetype-category", ...). Required
   *  so a caller cannot silently reintroduce an archetype-blind envelope: before
   *  BI-7ED79807 the projector wrote only `product`, so every envelope on the wire
   *  arrived with no archetype and no receiver could scope relevance to itself. */
  scopeKind: string | null;
  archetypeCategories: string[];
  archetypeIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** Namespaced applicability references (BI-7ED79807).
 *
 *  The envelope contract carries ONE `archetypeRefs` list, while the source
 *  carries three distinct dimensions (planning scope, archetype categories,
 *  specific archetypes). Namespacing keeps them distinguishable to a receiver
 *  instead of flattening three meanings into one ambiguous list:
 *
 *    scope:platform             — applies to EVERY install, whatever its archetype
 *    scope:archetype-category   — scoped by category; read the `category:` refs
 *    category:<slug>            — a portable archetype-category slug
 *    archetype:<id>             — a specific archetype
 *
 *  `scope:platform` short-circuits: a platform-scoped item applies universally,
 *  so listing categories beside it would wrongly imply a narrowing.
 *
 *  These are the same fields the federated WORK contract already projects
 *  verbatim (`work-page.ts`), so no new egress judgement is being made here —
 *  only the mapping into the demand envelope's shape.
 */
export function buildArchetypeRefs(source: {
  scopeKind: string | null;
  archetypeCategories: string[];
  archetypeIds: string[];
}): string[] {
  const clean = (values: string[], prefix: string): string[] =>
    values.map((value) => value.trim()).filter(Boolean).map((value) => `${prefix}:${value}`);

  const scope = source.scopeKind?.trim();
  if (scope === "platform") return ["scope:platform"];

  const refs = [
    ...(scope ? [`scope:${scope}`] : []),
    ...clean(source.archetypeCategories ?? [], "category"),
    ...clean(source.archetypeIds ?? [], "archetype"),
  ];
  // Dedupe while preserving order: a repeated category must not change the
  // payload digest, which would re-queue an unchanged envelope on every sweep.
  return [...new Set(refs)];
}

/** Assemble the applicability block, omitting it entirely when nothing is known
 *  rather than emitting an empty object that reads as "applies to nothing".
 *
 *  `capabilityRefs` and `platformRange` are deliberately NOT set: a BacklogItem
 *  carries no capability link and no version range, and inventing either would
 *  put a fabricated relevance signal on the wire. They stay absent until a real
 *  source exists. */
function buildApplicability(source: ProjectableDemandSource): DemandEnvelopeV1["applicability"] | undefined {
  const archetypeRefs = buildArchetypeRefs(source);
  const product = source.product?.trim() || undefined;
  if (!product && archetypeRefs.length === 0) return undefined;
  return {
    ...(product ? { product } : {}),
    ...(archetypeRefs.length > 0 ? { archetypeRefs } : {}),
  };
}

/** Build only the minimized network contract; the raw BacklogItem never reaches the transport. */
export function buildDemandEnvelope(input: {
  source: ProjectableDemandSource;
  identity: FederationIdentity;
  contract: ProjectionContractSpec;
  audience: DemandAudience;
  attribution: DemandAttribution;
  forwarding?: DemandEnvelopeV1["forwarding"];
}): { envelope: DemandEnvelopeV1; violations: string[] } {
  const refs = deriveDemandNetworkRefs(input.identity, input.source.localRecordRef);
  const candidate: DemandEnvelopeV1 = {
    specVersion: "dpf.demand/1",
    ...refs,
    originInstallationId: input.identity.installationId,
    originVersion: Math.max(1, input.source.updatedAt.getTime()),
    route: [],
    audience: input.audience,
    title: input.source.title.slice(0, 240),
    summary: (input.source.summary.trim() || "Shared demand").slice(0, 4_000),
    ...(input.source.workType ? { workType: input.source.workType } : {}),
    ...(() => {
      const applicability = buildApplicability(input.source);
      return applicability ? { applicability } : {};
    })(),
    signal: { occurrenceCount: Math.max(0, input.source.occurrenceCount) },
    attribution: input.attribution,
    ...(input.forwarding ? { forwarding: input.forwarding } : {}),
    createdAt: input.source.createdAt.toISOString(),
    updatedAt: input.source.updatedAt.toISOString(),
    payloadDigest: "sha256:pending",
  };

  const firstProjection = projectEstatePayload(input.contract, { demand: candidate });
  candidate.payloadDigest = computeDemandPayloadDigest(
    firstProjection.projected.demand as DemandEnvelopeV1,
  );

  const projection = projectEstatePayload(input.contract, { demand: candidate });
  const envelope = projection.projected.demand as DemandEnvelopeV1;
  const violations = [
    ...assertNoExcludedEgress(input.contract, projection.projected),
    ...validateDemandEnvelopeV1(envelope),
  ];
  return { envelope, violations };
}
