import { describe, expect, it } from "vitest";

import { assertNoExcludedEgress, projectEstatePayload } from "./projection-serialization";
import {
  DEPLOYMENT_DECLARATION_PROJECTION_TEMPLATE,
  computeDeploymentDeclarationDigest,
  isIsoCountryCode,
  validateDeploymentDeclarationV1,
  type DeploymentDeclarationV1,
} from "./federated-deployment-declaration-contract";

function declaration(overrides: Partial<DeploymentDeclarationV1> = {}): DeploymentDeclarationV1 {
  const base: DeploymentDeclarationV1 = {
    specVersion: "dpf.deployment-declaration/1",
    originInstallationId: "inst_abc123",
    originVersion: 1_790_000_000_000,
    state: "declared",
    countryCode: "DE",
    declaredAt: "2026-10-01T00:00:00.000Z",
    payloadDigest: "sha256:pending",
    ...overrides,
  };
  return { ...base, payloadDigest: computeDeploymentDeclarationDigest(base) };
}

describe("deployment declaration contract", () => {
  it("accepts a declared and a withdrawn record", () => {
    expect(validateDeploymentDeclarationV1(declaration())).toEqual([]);
    expect(validateDeploymentDeclarationV1(declaration({ state: "withdrawn", countryCode: null }))).toEqual([]);
  });

  it("knows ISO 3166-1 alpha-2 codes from the seeded country list", () => {
    expect(isIsoCountryCode("US")).toBe(true);
    expect(isIsoCountryCode("XX")).toBe(false);
    expect(isIsoCountryCode("us")).toBe(false);
    expect(isIsoCountryCode("USA")).toBe(false);
  });

  it("rejects an unknown country, and a declared record without one", () => {
    expect(validateDeploymentDeclarationV1(declaration({ countryCode: "XX" }))).toContain("countryCode:invalid");
    expect(validateDeploymentDeclarationV1(declaration({ countryCode: null }))).toContain("countryCode:invalid");
  });

  it.each(["latitude", "longitude", "lat", "lon", "coordinates", "geometry", "address", "addressLine1", "city", "postalCode", "region"])(
    "rejects a record carrying %s",
    (field) => {
      const leaked = { ...declaration(), [field]: "anything" };
      expect(validateDeploymentDeclarationV1(leaked)).toContain(`field:not-allowed:${field}`);
    },
  );

  it("detects tampering through the digest", () => {
    const tampered = { ...declaration(), countryCode: "FR" };
    expect(validateDeploymentDeclarationV1(tampered)).toContain("payloadDigest:mismatch");
  });

  it("projects only allow-listed fields through the egress template", () => {
    const leaky = { ...declaration(), city: "Berlin", latitude: 52.5 };
    const projection = projectEstatePayload(DEPLOYMENT_DECLARATION_PROJECTION_TEMPLATE, { declaration: leaky });
    const projected = projection.projected.declaration as Record<string, unknown>;
    expect(Object.keys(projected).sort()).toEqual(
      ["countryCode", "declaredAt", "originInstallationId", "originVersion", "payloadDigest", "specVersion", "state"],
    );
    expect(assertNoExcludedEgress(DEPLOYMENT_DECLARATION_PROJECTION_TEMPLATE, projection.projected)).toEqual([]);
  });
});
