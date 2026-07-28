import { describe, expect, it, vi } from "vitest";
import { crmSalesPipelinePack } from "./crm-sales-pipeline-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const READ_TOOLS = ["list_customer_accounts", "list_opportunities", "get_opportunity", "list_quotes"] as const;
const WRITE_TOOLS = ["create_customer_account", "create_opportunity", "create_quote"] as const;
const ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS] as const;

describe("crm-sales-pipeline pack", () => {
  it("registers all seven account/opportunity/quote tools with handlers", () => {
    const names = crmSalesPipelinePack.definitions.map((d) => d.name).sort();
    expect(names).toEqual([...ALL_TOOLS].sort());
    for (const name of ALL_TOOLS) {
      expect(crmSalesPipelinePack.handlers[name]).toBeTypeOf("function");
    }
  });

  it("marks reads view_customer/non-side-effecting and writes operate_customer/side-effecting artifacts", () => {
    for (const name of READ_TOOLS) {
      const def = crmSalesPipelinePack.definitions.find((d) => d.name === name)!;
      expect(def.requiredCapability).toBe("view_customer");
      expect(def.sideEffect).toBe(false);
    }
    for (const name of WRITE_TOOLS) {
      const def = crmSalesPipelinePack.definitions.find((d) => d.name === name)!;
      expect(def.requiredCapability).toBe("operate_customer");
      expect(def.sideEffect).toBe(true);
      expect(def.coworkerArtifact).toBe(true);
    }
  });

  it("mirrors the crm_read / crm_write grants and gates against the gating source", () => {
    for (const name of READ_TOOLS) {
      expect(crmSalesPipelinePack.grants[name]).toEqual(["crm_read"]);
      expect(isToolAllowedByGrants(name, ["crm_read"])).toBe(true);
      expect(isToolAllowedByGrants(name, ["backlog_write"])).toBe(false);
    }
    for (const name of WRITE_TOOLS) {
      expect(crmSalesPipelinePack.grants[name]).toEqual(["crm_write"]);
      expect(isToolAllowedByGrants(name, ["crm_write"])).toBe(true);
      expect(isToolAllowedByGrants(name, ["crm_read"])).toBe(false);
    }
  });

  it("keeps every tool description provenance-free", () => {
    for (const def of crmSalesPipelinePack.definitions) {
      expect(def.description).not.toMatch(/BI-|Phase \d|apps\/web|EP-/);
    }
  });

  it("validates required fields before touching services (create_customer_account)", async () => {
    const res = await crmSalesPipelinePack.handlers.create_customer_account({}, "user-1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_name");
  });

  it("create_opportunity requires title and accountId", async () => {
    const res = await crmSalesPipelinePack.handlers.create_opportunity({ title: "x" }, "user-1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_fields");
  });

  it("create_quote requires opportunityId, validUntil, and lineItems", async () => {
    const res = await crmSalesPipelinePack.handlers.create_quote({ opportunityId: "OPP-1" }, "user-1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_fields");
  });

  it("mirrors the catalog-first quote seam while retaining the legacy DigitalProduct field", () => {
    const definition = crmSalesPipelinePack.definitions.find(
      (candidate) => candidate.name === "create_quote",
    )!;
    const inputSchema = definition.inputSchema as {
      properties: {
        lineItems: {
          items?: {
            properties?: Record<string, {
              type?: string;
              description?: string;
            }>;
          };
        };
      };
    };
    const lineItem = inputSchema.properties.lineItems.items;

    expect(lineItem?.properties).toMatchObject({
      catalogItemId: { type: "string" },
      catalogSkuId: { type: "string" },
      configurationSnapshot: { type: "object" },
      productId: {
        type: "string",
        description: expect.stringMatching(/Legacy.*DigitalProduct/i),
      },
    });
  });

  it("get_opportunity requires an opportunityId", async () => {
    const res = await crmSalesPipelinePack.handlers.get_opportunity({}, "user-1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_opportunityId");
  });

  it("create_customer_account delegates to the CRM action and surfaces duplicates", async () => {
    vi.resetModules();
    vi.doMock("@/lib/actions/crm", () => ({
      createCustomerAccount: vi.fn(async () => ({
        outcome: "duplicates-found",
        check: {
          candidates: [
            { id: "acc-1", label: "Acme Inc", detail: "active", score: 92, reasons: [{ attribute: "name" }] },
          ],
        },
      })),
    }));
    const { crmSalesPipelinePack: freshPack } = await import("./crm-sales-pipeline-pack");
    const res = await freshPack.handlers.create_customer_account({ name: "Acme" }, "user-1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("duplicates_found");
    expect((res.data as { candidates: unknown[] }).candidates).toHaveLength(1);
    vi.doUnmock("@/lib/actions/crm");
    vi.resetModules();
  });

  it("create_opportunity returns the created opportunity envelope", async () => {
    vi.resetModules();
    vi.doMock("@/lib/actions/crm", () => ({
      createOpportunity: vi.fn(async () => ({
        id: "opp-1",
        opportunityId: "OPP-100",
        title: "New deal",
        stage: "qualification",
        account: { name: "Acme Inc" },
      })),
    }));
    const { crmSalesPipelinePack: freshPack } = await import("./crm-sales-pipeline-pack");
    const res = await freshPack.handlers.create_opportunity({ title: "New deal", accountId: "acc-1" }, "user-1");
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ opportunityId: "opp-1", opportunityRef: "OPP-100" });
    vi.doUnmock("@/lib/actions/crm");
    vi.resetModules();
  });
});
