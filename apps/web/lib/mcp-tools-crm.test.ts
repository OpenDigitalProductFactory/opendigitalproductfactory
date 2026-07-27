import { describe, expect, it, vi } from "vitest";
import { getAvailableTools } from "./mcp-tools";
import { getAgentToolGrants, isToolAllowedByGrants } from "@/lib/agent-grants";

const CUSTOMER_ADVISOR_GRANTS = vi.hoisted(() => [
  "backlog_read",
  "registry_read",
  "consumer_read",
  "crm_read",
  "crm_write",
  "web_search",
]);

vi.mock("@/lib/agent-grants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-grants")>();
  return {
    ...actual,
    getAgentToolGrants: vi.fn((agentId: string) =>
      agentId === "customer-advisor" ? CUSTOMER_ADVISOR_GRANTS : actual.getAgentToolGrants(agentId),
    ),
    getAgentToolGrantsAsync: vi.fn(async (agentId: string) =>
      agentId === "customer-advisor" ? CUSTOMER_ADVISOR_GRANTS : actual.getAgentToolGrantsAsync(agentId),
    ),
  };
});

// EP-CRM-COWORKER. The Customer Success Manager (customer-advisor) previously
// resolved to a backlog/build tool surface with no CRM tools and a dangerous
// backlog_write grant (it retired live backlog items while flailing). These
// tests pin the re-scoped surface: CRM read/write in, backlog mutation out.

const adminUser = { userId: "user-1", platformRole: "HR-000", isSuperuser: false };
const inventoryUser = { userId: "user-2", platformRole: "HR-300", isSuperuser: false };

const CRM_READ_TOOLS = ["list_customer_accounts", "list_opportunities", "get_opportunity", "list_quotes"];
const CRM_WRITE_TOOLS = ["create_customer_account", "create_opportunity", "create_quote"];

describe("CRM coworker tools", () => {
  it("exposes the CRM read + write tools to the customer-advisor coworker", async () => {
    const tools = await getAvailableTools(adminUser, {
      externalAccessEnabled: false,
      agentId: "customer-advisor",
    });
    const names = tools.map((t) => t.name);
    for (const t of [...CRM_READ_TOOLS, ...CRM_WRITE_TOOLS]) {
      expect(names, `expected ${t} on the customer-advisor surface`).toContain(t);
    }
  });

  it("CRM read tools require only view_customer and are not side-effecting", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false, agentId: "customer-advisor" });
    for (const name of CRM_READ_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool, name).toBeDefined();
      expect(tool.requiredCapability).toBe("view_customer");
      expect(tool.sideEffect ?? false).toBe(false);
    }
  });

  it("CRM draft-create tools are coworkerArtifacts so they survive advise (hands-off) mode", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false, agentId: "customer-advisor" });
    for (const name of CRM_WRITE_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool, name).toBeDefined();
      expect(tool.requiredCapability).toBe("operate_customer");
      expect(tool.sideEffect).toBe(true);
      expect(tool.coworkerArtifact).toBe(true);
    }
  });

  it("a user without view_customer does not see CRM tools even via the agent", async () => {
    const tools = await getAvailableTools(inventoryUser, { externalAccessEnabled: false, agentId: "customer-advisor" });
    const names = tools.map((t) => t.name);
    for (const t of [...CRM_READ_TOOLS, ...CRM_WRITE_TOOLS]) {
      expect(names).not.toContain(t);
    }
  });

  it("drops the dangerous backlog-mutation tools from the customer-advisor surface", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false, agentId: "customer-advisor" });
    const names = tools.map((t) => t.name);
    for (const t of ["retire_backlog_item", "create_backlog_item", "create_epic", "propose_build_decomposition"]) {
      expect(names, `${t} must NOT be on the customer-advisor surface`).not.toContain(t);
    }
  });

  it("customer-advisor registry grants drop backlog_write and add crm grants", () => {
    const grants = getAgentToolGrants("customer-advisor");
    expect(grants).toBeTruthy();
    expect(grants).not.toContain("backlog_write");
    expect(grants).toEqual(expect.arrayContaining(["crm_read", "crm_write", "backlog_read", "registry_read"]));
  });

  // The Customer Success Manager researches prospects online, so it holds the
  // web_search grant. Without it, flipping the "web access" toggle on was a
  // no-op — the grant filter stripped search_public_web / fetch_public_website.
  it("customer-advisor holds web_search so the web-access toggle is not a no-op", () => {
    const grants = getAgentToolGrants("customer-advisor");
    expect(grants).toContain("web_search");
    expect(isToolAllowedByGrants("search_public_web", grants!)).toBe(true);
    expect(isToolAllowedByGrants("fetch_public_website", grants!)).toBe(true);
  });

  it("exposes web research tools to customer-advisor only when external access is enabled", async () => {
    const withWeb = (await getAvailableTools(adminUser, {
      externalAccessEnabled: true,
      agentId: "customer-advisor",
    })).map((t) => t.name);
    for (const t of ["search_public_web", "fetch_public_website"]) {
      expect(withWeb, `expected ${t} when web access is on`).toContain(t);
    }

    const withoutWeb = (await getAvailableTools(adminUser, {
      externalAccessEnabled: false,
      agentId: "customer-advisor",
    })).map((t) => t.name);
    for (const t of ["search_public_web", "fetch_public_website"]) {
      expect(withoutWeb, `${t} must stay gated behind the web-access toggle`).not.toContain(t);
    }
  });

  it("crm_write authorizes CRM writes and implies crm_read; backlog_write does not couple in", () => {
    expect(isToolAllowedByGrants("create_quote", ["crm_write"])).toBe(true);
    expect(isToolAllowedByGrants("create_opportunity", ["crm_write"])).toBe(true);
    expect(isToolAllowedByGrants("create_customer_account", ["crm_write"])).toBe(true);
    // crm_write → crm_read implication: a writer can always read the pipeline it drafts against
    expect(isToolAllowedByGrants("list_opportunities", ["crm_write"])).toBe(true);
    // crm_read alone is read-only — never authorizes a write
    expect(isToolAllowedByGrants("create_quote", ["crm_read"])).toBe(false);
    // no accidental coupling: the engineering backlog grant must not open CRM writes
    expect(isToolAllowedByGrants("create_quote", ["backlog_write"])).toBe(false);
    // and the CRM grant must not open the backlog
    expect(isToolAllowedByGrants("retire_backlog_item", ["crm_write"])).toBe(false);
  });

  it("crm_read authorizes CRM reads but not writes", () => {
    for (const t of CRM_READ_TOOLS) {
      expect(isToolAllowedByGrants(t, ["crm_read"])).toBe(true);
    }
    for (const t of CRM_WRITE_TOOLS) {
      expect(isToolAllowedByGrants(t, ["crm_read"])).toBe(false);
    }
  });
});
