import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  INSTALLATION_OWNER_SENSITIVITY_FLOOR,
  PRINCIPAL_SENSITIVITIES,
  coerceDataSensitivity,
  normalizePrincipalSensitivities,
  resolvePrincipalSensitivityClearance,
} from "./principal-sensitivity";

describe("coerceDataSensitivity", () => {
  it("passes through every known sensitivity level", () => {
    for (const level of PRINCIPAL_SENSITIVITIES) {
      expect(coerceDataSensitivity(level)).toBe(level);
    }
  });

  it("fails CLOSED to 'restricted' for unknown / empty / nullish labels", () => {
    expect(coerceDataSensitivity("top-secret")).toBe("restricted");
    expect(coerceDataSensitivity("")).toBe("restricted");
    expect(coerceDataSensitivity(null)).toBe("restricted");
    expect(coerceDataSensitivity(undefined)).toBe("restricted");
  });
});

describe("principal sensitivity clearance", () => {
  it("keeps the canonical TypeScript vocabulary aligned with Prisma", () => {
    const schemaPath = fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url));
    const schema = readFileSync(schemaPath, "utf8");
    const enumBody = schema.match(/enum PrincipalSensitivity \{([^}]+)\}/)?.[1] ?? "";
    const prismaValues = enumBody.match(/^\s+([a-z][a-z0-9_]*)\s*$/gm)?.map((line) => line.trim());

    expect(prismaValues).toEqual(PRINCIPAL_SENSITIVITIES);
  });

  it("defaults absent clearance to public only", () => {
    expect(normalizePrincipalSensitivities(undefined)).toEqual(["public"]);
  });

  it("deduplicates and sorts known clearance values", () => {
    expect(normalizePrincipalSensitivities(["restricted", "public", "restricted"])).toEqual([
      "public",
      "restricted",
    ]);
  });

  it("rejects unknown clearance rather than widening authority", () => {
    expect(() => normalizePrincipalSensitivities(["secret"])).toThrow(
      "Unknown principal sensitivity clearance: secret",
    );
  });

  it("clears the installation owner for the business's own data up to confidential — never restricted", () => {
    // The seed creates tier-2 coworkers at sensitivity "confidential"; the
    // authority gate requires the owner's clearance to include that level, so
    // the floor must carry it or every such coworker is unauthorizable.
    expect(INSTALLATION_OWNER_SENSITIVITY_FLOOR).toEqual([
      "public",
      "internal",
      "confidential",
    ]);
    expect(
      resolvePrincipalSensitivityClearance({
        existing: ["public"],
        isSuperuser: true,
      }),
    ).toEqual(["public", "internal", "confidential"]);
    expect(
      resolvePrincipalSensitivityClearance({
        existing: ["public"],
        isSuperuser: true,
      }),
    ).not.toContain("restricted");
  });

  it("preserves governed clearance without widening ordinary principals", () => {
    expect(
      resolvePrincipalSensitivityClearance({
        existing: ["public", "confidential"],
        isSuperuser: false,
      }),
    ).toEqual(["public", "confidential"]);
  });
});
