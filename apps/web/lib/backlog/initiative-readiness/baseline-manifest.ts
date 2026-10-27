import { createHash } from "node:crypto";
import { parseMarkdown } from "../../shared/markdown";

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

export const NO_MARKED_OBJECTIVE_STATEMENTS = "The artifact has no marked objective statements.";

/** GFM removes the slash immediately before a pipe before parsing inline text. */
function tableCells(line: string): string[] | null {
  const cells: string[] = [];
  let cell = "";
  for (const character of line.trim()) {
    if (character !== "|") {
      cell += character;
    } else if (cell.endsWith("\\")) {
      cell = `${cell.slice(0, -1)}|`;
    } else {
      cells.push(cell.trim());
      cell = "";
    }
  }
  cells.push(cell.trim());
  // The governed notation requires both outer delimiters, even though GFM
  // allows their omission. Never accept a partially written scope row.
  if (cells[0] !== "" || cells.at(-1) !== "") return null;
  return cells.slice(1, -1).map(value => value.replace(/\\\\/g, "\\"));
}

export function parseInitiativeScopeManifest(
  bytes: string,
  artifactDigest = sha256(bytes),
): InitiativeScopeManifestResult {
  const objectives: InitiativeObjectiveStatement[] = [];
  const acceptance: InitiativeAcceptanceStatement[] = [];
  const objectiveIds = new Set<string>();
  const acceptanceIds = new Set<string>();
  const lines = bytes.split(/\r?\n/);
  const ignoredLines = new Set<number>();
  const headerLines = new Set<number>();
  const tableWidths = new Map<number, number>();
  const objectiveParagraphs = new Map<number, number>();
  for (const token of parseMarkdown(bytes)) {
    if (!token.map) continue;
    const [start, end] = token.map;
    if (token.type === "fence" || token.type === "code_block" || token.type === "blockquote_open") {
      for (let index = start; index < end; index++) ignoredLines.add(index);
    }
    if (token.type === "table_open") {
      headerLines.add(start);
      const header = tableCells(lines[start]!);
      const width = header?.length;
      // An AC reference inside a grounding/traceability table is prose. A
      // scope table declares objective links or uses a complete AC-ID cell.
      // Once recognized, validate every row, including malformed identifiers.
      const hasScope = /^objectives?$/i.test(header?.[1] ?? "")
        || lines.slice(start + 2, end).some(line => /^\s*\|\s*AC-[A-Z0-9-]+\s*\|/i.test(line));
      for (let index = start + 2; index < end; index++) {
        if (width && hasScope) tableWidths.set(index, width);
        else ignoredLines.add(index);
      }
    }
    if (token.type === "paragraph_open") for (let index = start; index < end; index++) objectiveParagraphs.set(index, end);
  }

  for (const [index, line] of lines.entries()) {
    if (ignoredLines.has(index) || headerLines.has(index)) continue;
    const atLine = (message: string) => invalid(`${message} (line ${index + 1})`);
    const objectiveMatch = line.match(/^\s*(?:\d+\.\s+|[-*]\s+)?\*\*(OBJ-[A-Z0-9-]+):\*\*\s*(.*)$/);
    if (objectiveMatch) {
      const [, objectiveId, rawStatement] = objectiveMatch;
      const statementLines = [rawStatement ?? ""];
      for (let continuation = index + 1; continuation < (objectiveParagraphs.get(index) ?? index + 1); continuation++) {
        const nextLine = lines[continuation]!;
        if (/^\s*(?:(?:\d+\.\s+|[-*]\s+)?\*\*OBJ-|\|\s*AC-)/i.test(nextLine)) break;
        statementLines.push(nextLine);
      }
      const statement = normalizedStatement(statementLines.join(" "));
      if (!statement) return atLine(`${objectiveId} has no statement text.`);
      if (objectiveIds.has(objectiveId!)) return atLine(`${objectiveId} is duplicated.`);
      objectiveIds.add(objectiveId!);
      objectives.push({
        objectiveId: objectiveId!,
        artifactAnchor: `line:${index + 1}`,
        statementDigest: sha256(statement),
      });
      continue;
    }

    if (/^\s*(?:\d+\.\s+|[-*]\s+)?\*\*OBJ-/i.test(line)) {
      return atLine("Malformed objective marker; expected **OBJ-ID:** followed by its statement.");
    }
    if (!/^\s*\|\s*AC-/i.test(line)) {
      if (tableWidths.has(index)) return atLine("Every row in a scope table must name an AC-ID; keep each statement on one line.");
      continue;
    }
    const cells = tableCells(line);
    // Legacy scope used bare three-cell rows. Those remain unambiguous; any
    // additional metadata column needs a declared header to distinguish it
    // from an accidentally unescaped pipe in the criterion.
    const width = tableWidths.get(index) ?? 3;
    if (!cells || !width || width < 3 || cells.length !== width) {
      return atLine("Malformed acceptance row; use a declared table with matching cells and escape literal pipes as \\|.");
    }
    const [acceptanceId, rawObjectiveIds, rawStatement] = cells;
    if (!/^AC-[A-Z0-9-]+$/.test(acceptanceId!)) return atLine("Malformed acceptance identifier.");
    const statement = normalizedStatement(rawStatement ?? "");
    const linkedObjectives = (rawObjectiveIds ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!statement) return atLine(`${acceptanceId} has no statement text.`);
    if (linkedObjectives.length === 0) return atLine(`${acceptanceId} does not name an objective.`);
    if (acceptanceIds.has(acceptanceId!)) return atLine(`${acceptanceId} is duplicated.`);
    if (linkedObjectives.some((id) => !/^OBJ-[A-Z0-9-]+$/.test(id))) {
      return atLine(`${acceptanceId} has a malformed objective link.`);
    }
    if (new Set(linkedObjectives).size !== linkedObjectives.length) return atLine(`${acceptanceId} repeats an objective link.`);
    acceptanceIds.add(acceptanceId!);
    acceptance.push({
      acceptanceId: acceptanceId!,
      objectiveIds: linkedObjectives,
      artifactAnchor: `line:${index + 1}`,
      statementDigest: sha256(statement),
    });
  }

  if (objectives.length === 0) return invalid(NO_MARKED_OBJECTIVE_STATEMENTS);
  if (acceptance.length === 0) return invalid("The artifact has no marked acceptance statements.");
  for (const entry of acceptance) {
    const unknownLinks = entry.objectiveIds.filter(id => !objectiveIds.has(id));
    if (unknownLinks.length) return invalid(`Unknown objective link(s): ${unknownLinks.join(", ")} (${entry.artifactAnchor.replace(":", " ")}).`);
  }

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
