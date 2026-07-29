import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  INSTALLATION_OWNER_SENSITIVITY_FLOOR,
  PRINCIPAL_SENSITIVITIES,
  normalizePrincipalSensitivities,
  resolvePrincipalSensitivityClearance,
} from "./principal-sensitivity";

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

  it("gives the installation owner only the public and internal floor", () => {
    expect(INSTALLATION_OWNER_SENSITIVITY_FLOOR).toEqual(["public", "internal"]);
    expect(
      resolvePrincipalSensitivityClearance({
        existing: ["public"],
        isSuperuser: true,
      }),
    ).toEqual(["public", "internal"]);
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
