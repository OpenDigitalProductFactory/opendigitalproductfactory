import { describe, expect, it, vi } from "vitest";
import {
  brandMasterInputFrom,
  brandThemeFor,
  ensureBrandMaster,
  logoFromDataUri,
  type BrandMasterDeps,
  type BrandSource,
} from "./brand-master";

vi.mock("@dpf/db", () => ({ prisma: {} }));

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function source(overrides: Partial<BrandSource> = {}): BrandSource {
  return {
    id: "org-1",
    name: "Second Chance Animal Rescue",
    designSystem: {
      version: "1.0.0",
      extractedAt: "2026-09-01T00:00:00Z",
      sources: [],
      identity: { name: "SCAR", tagline: null, description: null, logo: { darkBg: null, lightBg: null, mark: null }, voice: { tone: "", sampleCopy: [] } },
      palette: {
        primary: "#2A6F97",
        secondary: "#61788a",
        accents: ["#e07a5f"],
        semantic: { success: "#0a0", warning: "#aa0", danger: "#a00", info: "#00a" },
        neutrals: {},
        surfaces: { background: "#fbfbf8", foreground: "#1d2a33", muted: "#eee", card: "#fff", border: "#ddd" },
      },
      typography: { families: { sans: "Inter", serif: null, mono: "Mono", display: "Fraunces" }, scale: {}, pairings: [] },
      components: {},
      tokens: {},
      confidence: { overall: 1, perField: {} },
      gaps: [],
      overrides: {},
    },
    logoUrl: null,
    address: { line1: "1 Shelter Road", city: "Springfield", region: "Illinois", postalCode: "62701", countryCode: "US" },
    ...overrides,
  };
}

describe("brandMasterInputFrom", () => {
  it("takes colours, fonts, paper and address from the Organization", () => {
    const input = brandMasterInputFrom(source(), null);
    expect(input).toMatchObject({
      organizationName: "Second Chance Animal Rescue",
      primary: "#2a6f97",
      secondary: "#61788a",
      background: "#fbfbf8",
      foreground: "#1d2a33",
      headingFont: "Fraunces",
      bodyFont: "Inter",
      paper: "letter",
      logo: null,
    });
    expect(input.addressLines[0]).toBe("1 Shelter Road");
  });

  it("falls back to neutral defaults, never to invented brand values", () => {
    const input = brandMasterInputFrom(source({ designSystem: null, address: { countryCode: "GB" } }), null);
    expect(input).toMatchObject({ primary: "#1f4e79", bodyFont: "Liberation Sans", paper: "a4" });
  });

  it("ignores a colour it cannot read as hex", () => {
    const org = source();
    (org.designSystem as { palette: { primary: string } }).palette.primary = "oklch(0.5 0.1 200)";
    expect(brandMasterInputFrom(org, null).primary).toBe("#1f4e79");
  });
});

describe("brandThemeFor", () => {
  it("gives charts and shapes the brand colours with readable text", () => {
    expect(brandThemeFor(brandMasterInputFrom(source(), null), source())).toEqual({
      chartColours: ["#2a6f97", "#61788a", "#e07a5f"],
      shapeFill: "#2a6f97",
      shapeStroke: "#61788a",
      shapeText: "#ffffff",
    });
  });
});

describe("logoFromDataUri", () => {
  it("embeds a PNG logo with its pixel size", () => {
    const logo = logoFromDataUri(`data:image/png;base64,${PNG_1X1.toString("base64")}`);
    expect(logo).toMatchObject({ mimeType: "image/png", widthPx: 1, heightPx: 1 });
  });

  it("skips a logo the engine should not embed", () => {
    expect(logoFromDataUri("data:image/svg+xml;base64,PHN2Zy8+")).toBeNull();
    expect(logoFromDataUri("https://example.org/logo.png")).toBeNull();
  });
});

describe("ensureBrandMaster", () => {
  function harness(current: { version: number; contentSha256: string | null } | null) {
    const storeVersion = vi.fn(async () => ({ version: (current?.version ?? 0) + 1 }));
    const deps: BrandMasterDeps = {
      loadOrganization: async () => source(),
      loadLogo: async () => null,
      loadCurrentVersion: async () => current,
      storeVersion,
    };
    return { deps, storeVersion };
  }

  it("stores the first master as version 1 of a per-organization, per-family document", async () => {
    const { deps, storeVersion } = harness(null);
    const master = await ensureBrandMaster({ organizationId: "org-1", family: "deck" }, deps);
    expect(master).toMatchObject({ documentId: "BRANDMASTER-org-1-deck", version: 1, ext: "fodp", regenerated: true });
    expect(master.xml).toContain('style:name="dpf-content"');
    expect(storeVersion).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "BRANDMASTER-org-1-deck", organizationId: "org-1", sha256: master.sha256 }),
    );
  });

  it("reuses the stored master while the brand is unchanged", async () => {
    const first = await ensureBrandMaster({ organizationId: "org-1", family: "report" }, harness(null).deps);
    const { deps, storeVersion } = harness({ version: 3, contentSha256: first.sha256 });
    const again = await ensureBrandMaster({ organizationId: "org-1", family: "report" }, deps);
    expect(again).toMatchObject({ version: 3, sha256: first.sha256, regenerated: false });
    expect(storeVersion).not.toHaveBeenCalled();
  });

  it("writes a new version when the brand changes", async () => {
    const { deps, storeVersion } = harness({ version: 3, contentSha256: "0".repeat(64) });
    const master = await ensureBrandMaster({ organizationId: "org-1", family: "report" }, deps);
    expect(master).toMatchObject({ version: 4, regenerated: true });
    expect(storeVersion).toHaveBeenCalledTimes(1);
  });

  it("refuses an organization that does not exist", async () => {
    const { deps } = harness(null);
    await expect(
      ensureBrandMaster({ organizationId: "nope", family: "deck" }, { ...deps, loadOrganization: async () => null }),
    ).rejects.toThrow(/no organization/i);
  });
});
