import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { parseItemBodyAcceptance } from "./item-body-baseline";
import type { InitiativeAcceptanceStatement } from "./baseline-manifest";

export type BodyCriteriaVersion = {
  bodyDigest: string;
  criteriaDigest: string;
  criteria: string[];
  anchors: number[];
  acceptanceStatements: InitiativeAcceptanceStatement[];
};

export const bodyBaselineDigest = (bytes: string) => `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;

/** The parser owns what constitutes a criterion; this only versions its output. */
export function bodyCriteriaVersion(body: string | null | undefined): BodyCriteriaVersion | null {
  const parsed = parseItemBodyAcceptance(body);
  if (parsed.criteria.length === 0) return null;
  return {
    ...parsed,
    bodyDigest: bodyBaselineDigest(body ?? ""),
    criteriaDigest: bodyBaselineDigest(canonicalJson(parsed)),
    acceptanceStatements: parsed.criteria.map((criterion, index) => ({
      acceptanceId: `AC-BODY-${String(index + 1).padStart(3, "0")}`,
      objectiveIds: [],
      artifactAnchor: `line:${parsed.anchors[index]}`,
      statementDigest: bodyBaselineDigest(criterion),
    })),
  };
}

export function sameBodyCriteriaVersion(version: Pick<BodyCriteriaVersion, "criteriaDigest"> | null, body: string | null | undefined): boolean {
  const current = bodyCriteriaVersion(body);
  return Boolean(version && current && version.criteriaDigest === current.criteriaDigest);
}
