import { describe, expect, it } from "vitest";
import type { CycloneDxDocument } from "./bom-types";
import { createShareableCycloneDxBom } from "./bom-redaction";

const internalBom: CycloneDxDocument = {
  bomFormat: "CycloneDX",
  specVersion: "1.7",
  serialNumber: "urn:uuid:11111111-1111-1111-1111-111111111111",
  version: 1,
  metadata: {
    timestamp: "2026-05-22T00:00:00.000Z",
    component: { type: "application", name: "dpf-web", version: "0.1.0" },
    properties: [
      { name: "dpf:sourceDigest", value: "internal-source-digest" },
      { name: "dpf:workspacePath", value: "D:/DPF/apps/web" },
      { name: "supplier", value: "Open Digital Product Factory" },
    ],
  },
  components: [
    {
      type: "framework",
      name: "next",
      version: "16.2.6",
      purl: "pkg:npm/next@16.2.6",
      evidence: { workspacePath: "D:/DPF/apps/web", requestedByUserId: "user_123" },
    },
    {
      type: "machine-learning-model",
      name: "gpt-5.4",
      version: "2026-05",
      properties: [{ name: "dpf:routeContext", value: "/build" }],
    },
  ],
  dependencies: [{ ref: "pkg:npm/next@16.2.6" }],
};

describe("createShareableCycloneDxBom", () => {
  it("preserves machine-readable component inventory", () => {
    const shareable = createShareableCycloneDxBom(internalBom);

    expect(shareable.bomFormat).toBe("CycloneDX");
    expect(shareable.specVersion).toBe("1.7");
    expect(shareable.components).toHaveLength(2);
    expect(shareable.components[0]).toMatchObject({
      name: "next",
      version: "16.2.6",
      purl: "pkg:npm/next@16.2.6",
    });
    expect(shareable.components[1]).toMatchObject({
      name: "gpt-5.4",
      version: "2026-05",
    });
  });

  it("removes internal execution metadata from shareable exports", () => {
    const serialized = JSON.stringify(createShareableCycloneDxBom(internalBom));

    expect(serialized).not.toContain("D:/DPF");
    expect(serialized).not.toContain("workspacePath");
    expect(serialized).not.toContain("requestedByUserId");
    expect(serialized).not.toContain("routeContext");
    expect(serialized).not.toContain("internal-source-digest");
  });

  it("marks the export profile without removing non-internal properties", () => {
    const shareable = createShareableCycloneDxBom(internalBom);
    const properties = shareable.metadata.properties as Array<{ name: string; value: string }>;

    expect(properties).toContainEqual({ name: "supplier", value: "Open Digital Product Factory" });
    expect(properties).toContainEqual({ name: "dpf:exportProfile", value: "shareable" });
  });
});
