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
  for (const { key, heading } of SECTIONS) {
    const rendered = renderValue(doc[key]);
    if (rendered) parts.push(`## ${heading}\n\n${rendered}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}
