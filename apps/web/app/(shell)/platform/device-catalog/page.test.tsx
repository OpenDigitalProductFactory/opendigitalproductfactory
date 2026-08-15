import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const catalogEntries = Array.from({ length: 30 }, (_, index) => ({
  ruleKey: `rule-${index}`,
  identity: {
    name: `Device ${index}`,
    vendor: "Example vendor",
    deviceClass: "example_device",
  },
  signals: [{ signal: "vendor", match: `example-${index}` }],
  placement: { path: ["Foundational", "Network management"] },
  identityConfidence: 0.95,
  taxonomyConfidence: 0.94,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    discoveryFingerprintRule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
  buildPublicDeviceCatalog: vi.fn(() => ({
    schemaVersion: "1",
    version: "test",
    count: catalogEntries.length,
    entries: catalogEntries,
  })),
}));

describe("DeviceCatalogPage", () => {
  it("defers the long catalog tail behind a closed disclosure", async () => {
    const { default: DeviceCatalogPage } = await import("./page");
    const html = renderToStaticMarkup(await DeviceCatalogPage());

    expect(html).toContain("Device Catalog");
    expect(html).toContain("Device 0");
    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain("Show 22 more catalog entries");
    expect(html).toContain("focus-visible:outline");

    const arrivalHtml = html.replace(/<details[\s\S]*?<\/details>/g, "");
    const arrivalWords = arrivalHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/&[^;]+;/g, " ")
      .trim()
      .split(/\s+/);
    expect(arrivalWords.length).toBeLessThan(388);
  });
});
