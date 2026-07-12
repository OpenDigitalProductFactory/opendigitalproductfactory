import { describe, expect, it } from "vitest";
import { sorReadPack, ENTITY_TYPES } from "./sor-read-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

describe("sor-read pack", () => {
  it("registers read_operational_record as a read-only view_customer tool", () => {
    const def = sorReadPack.definitions.find((d) => d.name === "read_operational_record");
    expect(def).toBeDefined();
    expect(def!.requiredCapability).toBe("view_customer");
    expect(def!.sideEffect).toBe(false);
    expect(sorReadPack.handlers.read_operational_record).toBeTypeOf("function");
  });

  it("gates the tool behind crm_read so a CRM/finance coworker's grants reach it", () => {
    expect(sorReadPack.grants.read_operational_record).toEqual(["crm_read"]);
    expect(isToolAllowedByGrants("read_operational_record", ["crm_read"])).toBe(true);
    // crm_write implies crm_read, so a drafting coworker also reaches it.
    expect(isToolAllowedByGrants("read_operational_record", ["crm_write"])).toBe(true);
    expect(isToolAllowedByGrants("read_operational_record", ["backlog_read"])).toBe(false);
  });

  it("keeps the description provenance-free (no BI/phase/source-path leakage)", () => {
    const def = sorReadPack.definitions[0]!;
    expect(def.description).not.toMatch(/BI-|Phase \d|apps\/web|EP-/);
  });

  it("exposes the invoice + payment reader convention (extensible registry)", () => {
    expect(ENTITY_TYPES).toContain("invoice");
    expect(ENTITY_TYPES).toContain("payment");
    // The tool's enum stays in sync with the reader registry.
    const def = sorReadPack.definitions[0]!;
    const enumVals = (def.inputSchema.properties as Record<string, { enum?: string[] }>).entityType.enum;
    expect(new Set(enumVals)).toEqual(new Set(ENTITY_TYPES));
  });

  it("returns a clear error for an unknown entityType (no throw)", async () => {
    const res = await sorReadPack.handlers.read_operational_record!({ entityType: "spaceship" }, "user-1");
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/Unknown entityType/i);
  });
});
