import { createHash } from "node:crypto";

export type InitiativeObjectiveStatement = {
  objectiveId: string;
  artifactAnchor: string;
  statementDigest: string;
};

export type InitiativeAcceptanceStatement = {
  acceptanceId: string;
  objectiveIds: string[];
  artifactAnchor: string;
  statementDigest: string;
};

export type InitiativeScopeManifestResult =
  | {
    ok: true;
    artifactDigest: string;
    objectives: InitiativeObjectiveStatement[];
    acceptance: InitiativeAcceptanceStatement[];
  }
  | {
    ok: false;
    code: "manifest-invalid";
    error: string;
  };

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function normalizedStatement(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function invalid(error: string): InitiativeScopeManifestResult {
  return { ok: false, code: "manifest-invalid", error };
}

export function parseInitiativeScopeManifest(
  bytes: string,
  artifactDigest = sha256(bytes),
): InitiativeScopeManifestResult {
  const objectives: InitiativeObjectiveStatement[] = [];
  const acceptance: InitiativeAcceptanceStatement[] = [];
  const objectiveIds = new Set<string>();
  const acceptanceIds = new Set<string>();

  for (const [index, line] of bytes.split(/\r?\n/).entries()) {
    const objectiveMatch = line.match(/^\s*(?:\d+\.\s+|[-*]\s+)?\*\*(OBJ-[A-Z0-9-]+):\*\*\s*(.*)$/);
    if (objectiveMatch) {
      const [, objectiveId, rawStatement] = objectiveMatch;
      const statement = normalizedStatement(rawStatement ?? "");
      if (!statement) return invalid(`${objectiveId} has no statement text.`);
      if (objectiveIds.has(objectiveId!)) return invalid(`${objectiveId} is duplicated.`);
      objectiveIds.add(objectiveId!);
      objectives.push({
        objectiveId: objectiveId!,
        artifactAnchor: `line:${index + 1}`,
        statementDigest: sha256(statement),
      });
      continue;
    }

    const acceptanceMatch = line.match(/^\s*\|\s*(AC-[A-Z0-9-]+)\s*\|\s*([^|]*)\|\s*([^|]*)\|/);
    if (!acceptanceMatch) continue;
    const [, acceptanceId, rawObjectiveIds, rawStatement] = acceptanceMatch;
    const statement = normalizedStatement(rawStatement ?? "");
    const linkedObjectives = (rawObjectiveIds ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!statement) return invalid(`${acceptanceId} has no statement text.`);
    if (linkedObjectives.length === 0) return invalid(`${acceptanceId} does not name an objective.`);
    if (acceptanceIds.has(acceptanceId!)) return invalid(`${acceptanceId} is duplicated.`);
    if (linkedObjectives.some((id) => !/^OBJ-[A-Z0-9-]+$/.test(id))) {
      return invalid(`${acceptanceId} has a malformed objective link.`);
    }
    acceptanceIds.add(acceptanceId!);
    acceptance.push({
      acceptanceId: acceptanceId!,
      objectiveIds: linkedObjectives,
      artifactAnchor: `line:${index + 1}`,
      statementDigest: sha256(statement),
    });
  }

  if (objectives.length === 0) return invalid("The artifact has no marked objective statements.");
  if (acceptance.length === 0) return invalid("The artifact has no marked acceptance statements.");
  const unknownLinks = acceptance.flatMap((entry) => entry.objectiveIds).filter((id) => !objectiveIds.has(id));
  if (unknownLinks.length > 0) return invalid(`Unknown objective link(s): ${[...new Set(unknownLinks)].join(", ")}.`);

  return {
    ok: true,
    artifactDigest,
    objectives,
    acceptance,
  };
}

export type InitiativeScopeSemanticDiff = {
  removedOrChangedObjectiveIds: string[];
  removedOrChangedAcceptanceIds: string[];
  addedObjectiveIds: string[];
  addedAcceptanceIds: string[];
};

export function diffInitiativeScopeManifests(
  previous: Extract<InitiativeScopeManifestResult, { ok: true }>,
  next: Extract<InitiativeScopeManifestResult, { ok: true }>,
): InitiativeScopeSemanticDiff {
  const changed = <T extends { statementDigest: string }>(
    prior: Map<string, T>,
    current: Map<string, T>,
    equivalent: (left: T, right: T) => boolean = (left, right) => left.statementDigest === right.statementDigest,
  ) => [...prior].filter(([id, value]) => {
    const nextValue = current.get(id);
    return !nextValue || !equivalent(value, nextValue);
  }).map(([id]) => id);
  const added = <T>(prior: Map<string, T>, current: Map<string, T>) => [...current.keys()].filter((id) => !prior.has(id));
  const priorObjectives = new Map(previous.objectives.map((entry) => [entry.objectiveId, entry]));
  const nextObjectives = new Map(next.objectives.map((entry) => [entry.objectiveId, entry]));
  const priorAcceptance = new Map(previous.acceptance.map((entry) => [entry.acceptanceId, entry]));
  const nextAcceptance = new Map(next.acceptance.map((entry) => [entry.acceptanceId, entry]));
  return {
    removedOrChangedObjectiveIds: changed(priorObjectives, nextObjectives),
    removedOrChangedAcceptanceIds: changed(
      priorAcceptance,
      nextAcceptance,
      (left, right) => left.statementDigest === right.statementDigest
        && [...left.objectiveIds].sort().join("\0") === [...right.objectiveIds].sort().join("\0"),
    ),
    addedObjectiveIds: added(priorObjectives, nextObjectives),
    addedAcceptanceIds: added(priorAcceptance, nextAcceptance),
  };
}
