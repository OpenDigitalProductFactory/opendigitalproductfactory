import { describe, expect, it, vi } from "vitest";
import { toPortfolioNodeViewModel } from "./portfolio-node-view-model";

describe("toPortfolioNodeViewModel", () => {
  describe("about", () => {
    it("uses description verbatim", () => {
      const vm = toPortfolioNodeViewModel({
        description: "Compute servers running production workloads.",
        governance: null,
        enrichment: null,
      });
      expect(vm.about).toBe("Compute servers running production workloads.");
    });

    it("treats empty string as absent", () => {
      const vm = toPortfolioNodeViewModel({ description: "", governance: null, enrichment: null });
      expect(vm.about).toBeNull();
    });

    it("treats null as absent", () => {
      const vm = toPortfolioNodeViewModel({ description: null, governance: null, enrichment: null });
      expect(vm.about).toBeNull();
    });
  });

  describe("governance", () => {
    it("projects promotion policy when mode is present", () => {
      const vm = toPortfolioNodeViewModel({
        description: null,
        governance: { promotion: { mode: "auto", classifyAs: "infrastructure_endpoint" } },
        enrichment: null,
      });
      expect(vm.governance.promotion).toEqual({ mode: "auto", classifyAs: "infrastructure_endpoint" });
    });

    it("returns null promotion when governance has no promotion key", () => {
      const vm = toPortfolioNodeViewModel({
        description: null,
        governance: { somethingElse: 1 },
        enrichment: null,
      });
      expect(vm.governance.promotion).toBeNull();
    });

    it("captures requiredFields when present as an array of strings", () => {
      const vm = toPortfolioNodeViewModel({
        description: null,
        governance: { requiredFields: ["manufacturer", "observedVersion"] },
        enrichment: null,
      });
      expect(vm.governance.requiredFields).toEqual(["manufacturer", "observedVersion"]);
    });

    it("ignores requiredFields when shape is wrong", () => {
      const vm = toPortfolioNodeViewModel({
        description: null,
        governance: { requiredFields: "not-an-array" },
        enrichment: null,
      });
      expect(vm.governance.requiredFields).toBeNull();
    });

    it("populates raw when governance is a non-null object", () => {
      const gov = { promotion: { mode: "auto" }, custom: 42 };
      const vm = toPortfolioNodeViewModel({ description: null, governance: gov, enrichment: null });
      expect(vm.governance.raw).toEqual(gov);
      // raw should be a clone, not the same reference
      expect(vm.governance.raw).not.toBe(gov);
    });

    it("returns null governance views when input is null", () => {
      const vm = toPortfolioNodeViewModel({ description: null, governance: null, enrichment: null });
      expect(vm.governance).toEqual({ promotion: null, requiredFields: null, raw: null });
    });
  });

  describe("enrichment", () => {
    it("projects standards/patterns/references when shapes are correct", () => {
      const vm = toPortfolioNodeViewModel({
        description: null,
        governance: null,
        enrichment: {
          standards: ["ISO-27001", "SOC-2"],
          patterns: ["leader-follower"],
          references: [
            { label: "RFC", href: "https://example.com" },
            { label: "Bad", href: 123 }, // malformed; should be filtered
          ],
        },
      });
      expect(vm.enrichment.standards).toEqual(["ISO-27001", "SOC-2"]);
      expect(vm.enrichment.patterns).toEqual(["leader-follower"]);
      expect(vm.enrichment.references).toEqual([{ label: "RFC", href: "https://example.com" }]);
    });

    it("projects workbook-derived market and product guidance", () => {
      const vm = toPortfolioNodeViewModel({
        description: null,
        governance: null,
        enrichment: {
          sampleServices: "Capability mapping; Product fit review",
          offeringConsiderations: "Lightweight advisory vs managed program",
          commercialMarket: "Representative vendors: ServiceNow SPM; Planview; Jira.",
          industryMarkets: {
            retail: "Shopify; Square; Lightspeed",
            banking: "Fiserv; Temenos",
          },
        },
      });

      expect(vm.enrichment).toMatchObject({
        sampleServices: "Capability mapping; Product fit review",
        offeringConsiderations: "Lightweight advisory vs managed program",
        commercialMarket: "Representative vendors: ServiceNow SPM; Planview; Jira.",
        sectorCommercialMarkets: [
          { sector: "retail", market: "Shopify; Square; Lightspeed" },
          { sector: "banking", market: "Fiserv; Temenos" },
        ],
      });
    });

    it("warns and returns null for malformed enrichment shape", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const vm = toPortfolioNodeViewModel({
        description: null,
        governance: null,
        enrichment: { standards: "not-an-array" },
      });
      expect(vm.enrichment.standards).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[view-model]"));
      warnSpy.mockRestore();
    });
  });

  describe("isolation", () => {
    it("input objects are not mutated", () => {
      const node = {
        description: "x",
        governance: { promotion: { mode: "auto" } },
        enrichment: { standards: ["A"] },
      };
      const snapshot = JSON.stringify(node);
      toPortfolioNodeViewModel(node);
      expect(JSON.stringify(node)).toBe(snapshot);
    });
  });
});
