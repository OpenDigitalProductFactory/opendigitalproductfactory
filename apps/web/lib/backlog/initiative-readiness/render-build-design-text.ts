// apps/web/lib/backlog/initiative-readiness/render-build-design-text.ts
//
// BI-126441FA — a Build Studio design document IS the initiative's design.
//
// resolveInitiativeArtifact accepted only two shapes for a canonical initiative
// design: a plain string, or an object carrying `initiativeScopeMarkdown`.
// Build Studio stores a structured document —
//
//   dataModel, reusePlan, targetRoles, accessibility, problemStatement,
//   proposedApproach, acceptanceCriteria, reusabilityAnalysis,
//   existingFunctionalityAudit
//
// — and nothing anywhere writes `initiativeScopeMarkdown`. So every Build
// Studio design that has ever existed resolved to null content and was refused
// as "not an accepted canonical initiative design", blocking spec-approval,
// the canonical design baseline, and artifact author: three of the six facts
// that gate ideate -> plan. Because spec-approval is `independent: true`, no
// one could work around it.
//
// Rendering here rather than writing the field at save time is deliberate:
// existing revisions become resolvable without rewriting stored artifacts, and
// the pinned `valueDigest` keeps covering exactly what the author saved.
//
// The rendering must be DETERMINISTIC. A baseline pins a digest and reviewers
// read this text; the same stored value must always produce the same document,
// so the section order is fixed here rather than taken from key order.
//
// BI-CFD5A55A — resolving as canonical text is not enough; the text has to be
// BASELINEABLE. `spec-approval` mints the initiative scope baseline as well as
// recording approval, and minting parses this document with
// parseInitiativeScopeManifest, which reads two exact shapes and refuses an
// artifact carrying neither:
//
//   **OBJ-<ID>:** <statement>
//   | AC-<ID> | <OBJ-ids> | <statement> |
//
// This renderer emitted prose sections and a bulleted acceptance list, so every
// Build Studio design parsed to zero objectives and failed with "the artifact
// has no marked objective statements" — the next refusal behind BI-126441FA.
//
// The raw material was already here: `problemStatement` is the initiative's one
// objective and `acceptanceCriteria` are its criteria. Only the notation was
// missing, so the markers are DERIVED, never generated: same stored design,
// same ids, same digest.

/** Fixed section order — never derive this from Object.keys. */
const SECTIONS: ReadonlyArray<{ key: string; heading: string }> = [
  { key: "problemStatement", heading: "Problem statement" },
  { key: "existingFunctionalityAudit", heading: "Existing functionality audit" },
  { key: "reusabilityAnalysis", heading: "Reusability analysis" },
  { key: "reusePlan", heading: "Reuse plan" },
  { key: "proposedApproach", heading: "Proposed approach" },
  { key: "dataModel", heading: "Data model" },
  { key: "targetRoles", heading: "Target roles" },
  { key: "accessibility", heading: "Accessibility" },
  { key: "acceptanceCriteria", heading: "Acceptance criteria" },
];

function renderValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const items = value.map(renderValue).filter((entry): entry is string => Boolean(entry));
    return items.length > 0 ? items.map((entry) => `- ${entry}`).join("\n") : null;
  }
  if (value && typeof value === "object") {
    // Sort object keys so a stored object never renders two different ways.
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => {
        const rendered = renderValue(child);
        return rendered ? `- **${key}**: ${rendered.replace(/\n/g, " ")}` : null;
      })
      .filter((entry): entry is string => Boolean(entry));
    return entries.length > 0 ? entries.join("\n") : null;
  }
  return null;
}

/** The single objective a Build Studio design states, in its problem statement. */
const OBJECTIVE_ID = "OBJ-1";

/**
 * Flatten a statement onto one line and neutralise the characters the manifest
 * grammar treats as structure.
 *
 * An acceptance cell is `[^|]*`, so a literal pipe inside a criterion ends the
 * cell early and silently truncates — or malforms — the row. A newline splits
 * one criterion across two lines and drops the remainder. Neither may be left to
 * corrupt a manifest a baseline is about to pin.
 */
function asStatement(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const flattened = value.replace(/\s+/g, " ").split("|").join("\|").trim();
  return flattened || null;
}

/**
 * Render the marked objective and its acceptance table.
 *
 * Returns null unless BOTH an objective statement and at least one acceptance
 * criterion are present. The parser rejects an acceptance row naming an unknown
 * objective, so criteria with no problem statement must render nothing rather
 * than rows pointing at an objective that was never emitted.
 */
function renderScopeManifest(doc: Record<string, unknown>): string | null {
  const objective = asStatement(doc.problemStatement);
  if (!objective) return null;

  const criteria = Array.isArray(doc.acceptanceCriteria) ? doc.acceptanceCriteria : [];
  const rows = criteria
    .map(asStatement)
    // Index the SURVIVING criteria: a criterion that renders to nothing must not
    // leave a gap that shifts every later id and moves the baseline digest.
    .filter((statement): statement is string => statement !== null)
    .map((statement, index) => `| AC-${index + 1} | ${OBJECTIVE_ID} | ${statement} |`);
  if (rows.length === 0) return null;

  return [
    "## Scope",
    "",
    `**${OBJECTIVE_ID}:** ${objective}`,
    "",
    "| ID | Objectives | Acceptance criterion |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/**
 * Render a Build Studio design document as canonical initiative text.
 *
 * Returns null when the value carries none of the known sections — an object
 * that is not a design document must not be dressed up as one.
 */
export function renderBuildDesignText(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const doc = value as Record<string, unknown>;
  const parts: string[] = [];
  // The scope manifest leads: it is what the baseline parses, and a reviewer
  // should meet the objective before the prose.
  const manifest = renderScopeManifest(doc);
  if (manifest) parts.push(manifest);
  for (const { key, heading } of SECTIONS) {
    const rendered = renderValue(doc[key]);
    if (rendered) parts.push(`## ${heading}\n\n${rendered}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}
