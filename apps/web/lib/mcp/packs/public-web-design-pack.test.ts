import { beforeEach, describe, expect, it, vi } from "vitest";

const publicWeb = vi.hoisted(() => ({
  searchPublicWeb: vi.fn(),
  fetchPublicWebsiteEvidence: vi.fn(),
  analyzePublicWebsiteBranding: vi.fn(),
}));
vi.mock("@/lib/public-web-tools", () => publicWeb);

const designIntelligence = vi.hoisted(() => ({
  searchDesignDomain: vi.fn(),
  formatSearchResults: vi.fn(),
  generateDesignSystem: vi.fn(),
}));
vi.mock("@/lib/design-intelligence", () => designIntelligence);

const externalEvidence = vi.hoisted(() => ({ recordExternalEvidence: vi.fn() }));
vi.mock("@/lib/actions/external-evidence", () => externalEvidence);

import { publicWebDesignPack } from "./public-web-design-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "search_public_web",
  "fetch_public_website",
  "analyze_public_website_branding",
  "extract_brand_design_system",
  "evaluate_page",
  "search_design_intelligence",
  "generate_design_system",
  "analyze_brand_document",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("public-web-design pack — registration", () => {
  it("exposes exactly the eight tools in both definitions and handlers", () => {
    expect(publicWebDesignPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(publicWebDesignPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of publicWebDesignPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("exposes source-cited operational precedents as a design-intelligence domain", () => {
    const definition = publicWebDesignPack.definitions.find(
      (candidate) => candidate.name === "search_design_intelligence",
    );
    const properties = definition?.inputSchema["properties"] as
      | Record<string, { enum?: string[]; description?: string }>
      | undefined;
    const domain = properties?.["domain"];

    expect(domain?.enum).toContain("precedent");
    expect(domain?.description).toContain("physical operational workspace");
  });

  it("grants mirror agent-grants: read tools need read grants, mutating tools need write grants", () => {
    // Read-only design/reference tools gate on file_read.
    for (const t of ["evaluate_page", "search_design_intelligence", "generate_design_system", "analyze_brand_document"]) {
      expect(publicWebDesignPack.grants[t]).toEqual(["file_read"]);
      expect(isToolAllowedByGrants(t, ["file_read"])).toBe(true);
    }
    // Public web tools gate on web_search.
    for (const t of ["search_public_web", "fetch_public_website", "analyze_public_website_branding"]) {
      expect(publicWebDesignPack.grants[t]).toEqual(["web_search"]);
      expect(isToolAllowedByGrants(t, ["web_search"])).toBe(true);
    }
    // Brand extraction writes: needs the compound grant set.
    expect(publicWebDesignPack.grants.extract_brand_design_system).toEqual(["web_search", "file_read", "admin_write"]);
    expect(isToolAllowedByGrants("extract_brand_design_system", ["web_search", "file_read", "admin_write"])).toBe(true);
  });
});

describe("public-web-design pack — handler behavior (delegation preserved)", () => {
  it("search_public_web delegates to the public-web service and returns results", async () => {
    publicWeb.searchPublicWeb.mockResolvedValue([{ title: "T", url: "https://x.test" }]);
    const res = await publicWebDesignPack.handlers.search_public_web({ query: "coffee shops" }, "u1", {});
    expect(res.success).toBe(true);
    expect(publicWeb.searchPublicWeb).toHaveBeenCalledWith("coffee shops");
    // No routeContext → no evidence write.
    expect(externalEvidence.recordExternalEvidence).not.toHaveBeenCalled();
  });

  it("search_public_web surfaces a service failure without throwing", async () => {
    publicWeb.searchPublicWeb.mockRejectedValue(new Error("brave down"));
    const res = await publicWebDesignPack.handlers.search_public_web({ query: "x" }, "u1", {});
    expect(res.success).toBe(false);
    expect(res.error).toBe("brave down");
  });

  it("search_design_intelligence rejects an empty query without calling the service", async () => {
    const res = await publicWebDesignPack.handlers.search_design_intelligence({ domain: "style" }, "u1");
    expect(res.success).toBe(false);
    expect(designIntelligence.searchDesignDomain).not.toHaveBeenCalled();
  });

  it("generate_design_system delegates to the design-intelligence service", async () => {
    designIntelligence.generateDesignSystem.mockReturnValue("# Design System");
    const res = await publicWebDesignPack.handlers.generate_design_system({ query: "fintech dashboard" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("# Design System");
    expect(designIntelligence.generateDesignSystem).toHaveBeenCalledWith("fintech dashboard", undefined);
  });

  it("analyze_brand_document echoes the received document as a pure lookup", async () => {
    const res = await publicWebDesignPack.handlers.analyze_brand_document(
      { fileName: "brand.pdf", fileContent: "base64", fileType: "pdf" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("brand.pdf");
  });
});
