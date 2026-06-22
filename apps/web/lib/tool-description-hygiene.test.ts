import { describe, it, expect } from "vitest";
import { PLATFORM_TOOLS } from "./mcp-tools";

/**
 * Tool-description hygiene guard — design criterion P5 / gap G4 from
 * `docs/architecture/context-engineering-standards.md`.
 *
 * Tool *definitions* are a standing context tax: their `description` is sent on
 * every `tools/list` and to every model that can see the tool. Internal
 * provenance — epic phase markers ("Phase 4b/7"), backlog ids ("(BI-2E6CC391)"),
 * and source file paths — costs tokens on every call and tells the model
 * nothing it can act on. Keep provenance in code comments, not in the
 * model-facing string.
 *
 * This guard scans the TOP-LEVEL `tool.description` only. Input-schema property
 * descriptions may legitimately carry format examples (e.g. "the item ID, like
 * BI-E4A86393" or "a path like apps/web/lib/actions/crm.ts") and are not
 * checked here.
 */

// "Phase 4a", "Phase 5", "Phase 4b/7" — internal epic step markers.
const PROVENANCE_PHASE = /\bPhase\s+\d+[a-z]?\b/i;
// "(BI-2E6CC391)" / "BI-2E6CC391" — internal backlog ids.
const PROVENANCE_BI = /\bBI-[0-9A-Fa-f]{6,}\b/i;
// Leaked internal source paths.
const SOURCE_PATH = /\b(?:apps|packages|lib|src)\/[\w./-]+\.(?:ts|tsx|js|mjs|json|prisma)\b/i;
// Soft budget — over-long descriptions are surfaced (warn) but not failed, so
// genuinely useful disambiguation guidance is not forced out. Tighten via the
// eval harness (R8) once we can measure selection-accuracy impact.
const SOFT_DESCRIPTION_BUDGET = 900;

describe("tool description hygiene (context-engineering-standards.md P5/G4)", () => {
  it("carries no internal provenance (Phase N / BI-id) in the model-facing description", () => {
    const offenders = PLATFORM_TOOLS.filter(
      (t) => PROVENANCE_PHASE.test(t.description) || PROVENANCE_BI.test(t.description),
    ).map((t) => t.name);
    expect(
      offenders,
      `Strip "Phase N" / "(BI-…)" provenance from these tool descriptions (keep it in code comments): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("leaks no internal source file path in the model-facing description", () => {
    const offenders = PLATFORM_TOOLS.filter((t) => SOURCE_PATH.test(t.description)).map(
      (t) => t.name,
    );
    expect(
      offenders,
      `Remove internal source paths from these tool descriptions: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("surfaces over-long descriptions (soft budget)", () => {
    const offenders = PLATFORM_TOOLS.filter(
      (t) => (t.description?.length ?? 0) > SOFT_DESCRIPTION_BUDGET,
    ).map((t) => `${t.name}(${t.description.length})`);
    if (offenders.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[tool-description-hygiene] ${offenders.length} description(s) over ${SOFT_DESCRIPTION_BUDGET} chars: ${offenders.join(", ")}`,
      );
    }
    // Intentionally not asserted — soft signal only.
    expect(Array.isArray(offenders)).toBe(true);
  });
});
