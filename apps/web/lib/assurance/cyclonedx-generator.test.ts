import { describe, expect, it } from "vitest";
import { generateCycloneDxBom } from "./cyclonedx-generator";

const packageJson = JSON.stringify({
  name: "web",
  version: "0.1.0",
});

const lockText = `
lockfileVersion: '9.0'
importers:
  apps/web:
    dependencies:
      next:
        specifier: ^16.2.6
        version: 16.2.6(react@19.2.6)
      '@dpf/db':
        specifier: workspace:*
        version: link:../../packages/db
`;

describe("generateCycloneDxBom", () => {
  it("creates CycloneDX JSON plus normalized package and model components", () => {
    const result = generateCycloneDxBom({
      workspacePath: "apps/web",
      packageJson,
      lockText,
      generatedAt: new Date("2026-05-22T00:00:00.000Z"),
      gitRef: "abc123",
      modelProfiles: [
        { providerId: "openai", modelId: "gpt-5.4", modelStatus: "active" },
      ],
    });

    expect(result.cyclonedx.bomFormat).toBe("CycloneDX");
    expect(result.cyclonedx.specVersion).toBe("1.7");
    expect(result.components.map((component) => component.name)).toEqual([
      "next",
      "@dpf/db",
      "gpt-5.4",
    ]);
    expect(result.components.find((component) => component.name === "gpt-5.4")).toMatchObject({
      componentType: "model",
      ecosystem: "ai-model",
      supplierName: "openai",
    });
    expect(result.documentDigest).toMatch(/^[a-f0-9]{64}$/);
  });
});
