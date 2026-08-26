/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildPublicArchetypeProcessProjection } from "./public-process-projection";

const repoRoot = resolve(import.meta.dirname, "../../..");

describe("public archetype process projection", () => {
  it("keeps the committed public projection equal to the canonical archetype model", () => {
    const committed = JSON.parse(
      readFileSync(resolve(repoRoot, "docs/business-types/_process-projection.generated.json"), "utf8"),
    );
    expect(committed).toEqual(buildPublicArchetypeProcessProjection());
  });

  it("publishes a Pet Rescue drill-down from that projection", () => {
    const html = readFileSync(
      resolve(repoRoot, "docs/business-types/archetypes/pet-rescue.html"),
      "utf8",
    );
    expect(html).toContain("Intake and safe placement");
    expect(html).toContain("Health and welfare");
    expect(html).toContain("Adoption and placement");
    expect(html).toContain("Return and re-enter care");
    expect(html).not.toContain("Capture Demand");
  });
});
