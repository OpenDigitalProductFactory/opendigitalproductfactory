import { describe, expect, it } from "vitest";
import { crmContactsPack } from "./crm-contacts-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

describe("crm-contacts pack", () => {
  it("registers create_customer_contact with an operate_customer capability and side-effect flag", () => {
    const def = crmContactsPack.definitions.find((d) => d.name === "create_customer_contact");
    expect(def).toBeDefined();
    expect(def!.requiredCapability).toBe("operate_customer");
    expect(def!.sideEffect).toBe(true);
    expect(def!.coworkerArtifact).toBe(true);
    expect(crmContactsPack.handlers.create_customer_contact).toBeTypeOf("function");
  });

  it("gates the tool behind crm_write so the CSM's grant set covers it", () => {
    expect(crmContactsPack.grants.create_customer_contact).toEqual(["crm_write"]);
    expect(isToolAllowedByGrants("create_customer_contact", ["crm_write"])).toBe(true);
    expect(isToolAllowedByGrants("create_customer_contact", ["crm_read"])).toBe(false);
    expect(isToolAllowedByGrants("create_customer_contact", ["backlog_write"])).toBe(false);
  });

  it("keeps the tool description provenance-free (no BI/phase/source-path leakage)", () => {
    const def = crmContactsPack.definitions[0]!;
    expect(def.description).not.toMatch(/BI-|Phase \d|apps\/web|EP-/);
  });
});
