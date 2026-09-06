import { describe, it, expect } from "vitest";
import {
  can,
  canAccessEmployeeRecord,
  getAccessibleSectionNavEntries,
  getGrantedCapabilities,
  getShellNavSections,
  getWorkspaceSections,
  getWorkspaceTiles,
  type CapabilityKey,
} from "./permissions.js";

const hr000 = { platformRole: "HR-000", isSuperuser: false };
const hr300 = { platformRole: "HR-300", isSuperuser: false };
const hr500 = { platformRole: "HR-500", isSuperuser: false };
const hr600 = { platformRole: "HR-600", isSuperuser: false };
const noRole = { platformRole: null, isSuperuser: false };
const superuser = { platformRole: null, isSuperuser: true };

describe("can()", () => {
  it("HR-000 can access everything", () => {
    const keys: CapabilityKey[] = ["view_ea_modeler", "view_admin", "view_portfolio", "view_operations"];
    keys.forEach((k) => expect(can(hr000, k)).toBe(true));
  });

  it("HR-300 can view EA Modeler but not admin", () => {
    expect(can(hr300, "view_ea_modeler")).toBe(true);
    expect(can(hr300, "view_admin")).toBe(false);
  });

  it("HR-500 can view operations but not portfolio", () => {
    expect(can(hr500, "view_operations")).toBe(true);
    expect(can(hr500, "view_portfolio")).toBe(false);
  });

  it("grants business Performance only to owners and operations managers", () => {
    expect(can(hr000, "view_business_performance")).toBe(true);
    expect(can(hr500, "view_business_performance")).toBe(true);
    expect(can(hr300, "view_business_performance")).toBe(false);
    expect(can(hr600, "view_business_performance")).toBe(false);
  });

  it("HR-500 can manage_backlog", () => {
    expect(can(hr500, "manage_backlog")).toBe(true);
  });

  it("keeps animal-welfare operations separate from finance authority", () => {
    expect(can(hr500, "view_animal_welfare")).toBe(true);
    expect(can(hr500, "operate_animal_welfare")).toBe(true);
    expect(can(hr500, "view_finance")).toBe(false);
    expect(can(hr600, "view_animal_welfare")).toBe(false);
  });

  it("HR-300 cannot manage_backlog", () => {
    expect(can(hr300, "manage_backlog")).toBe(false);
  });

  it("user with no role cannot view admin", () => {
    expect(can(noRole, "view_admin")).toBe(false);
  });

  it("superuser with no role can access any capability", () => {
    expect(can(superuser, "view_admin")).toBe(true);
    expect(can(superuser, "manage_provider_connections")).toBe(true);
  });
});

describe("getWorkspaceTiles()", () => {
  it("HR-000 gets all tiles", () => {
    expect(getWorkspaceTiles(hr000).length).toBeGreaterThanOrEqual(6);
  });

  it("HR-500 only gets tiles they can access", () => {
    const tiles = getWorkspaceTiles(hr500).map((t) => t.key);
    expect(tiles).toContain("backlog");
    expect(tiles).not.toContain("agents");
    expect(tiles).not.toContain("admin");
  });

  it("HR-300 gets EA Modeler and Portfolio without a top-level inventory tile", () => {
    const tiles = getWorkspaceTiles(hr300).map((t) => t.key);
    expect(tiles).toContain("ea_modeler");
    expect(tiles).toContain("portfolio");
    expect(tiles).not.toContain("inventory");
  });

  it("superuser gets all 13 top-level tiles regardless of role", () => {
    const tiles = getWorkspaceTiles(superuser);

    expect(tiles.length).toBe(13);
    expect(tiles.map((tile) => tile.key)).toContain("documents");
    // Workbooks is demoted under Platform Hub (EP-GRID-WORKBOOKS) — no longer a top-level tile.
    expect(tiles.map((tile) => tile.key)).not.toContain("workbooks");
  });
});

describe("getShellNavSections()", () => {
  it("groups navigation into durable areas for admin users", () => {
    const sections = getShellNavSections(hr000);

    expect(sections.map((section) => section.key)).toEqual([
      "workspace",
      "business",
      "products",
      "delivery",
      "platform",
      "knowledge",
    ]);
    expect(sections.find((section) => section.key === "products")?.items.map((item) => item.key)).toContain("portfolio");
    expect(sections.find((section) => section.key === "products")?.items.map((item) => item.key)).not.toContain("inventory");
    expect(sections.find((section) => section.key === "platform")?.items.map((item) => item.key)).toContain("ai_workforce");
  });

  it("worker mode condenses the rail to day-to-day surfaces, hiding operator/platform chrome", () => {
    const keys = (sections: ReturnType<typeof getShellNavSections>) =>
      sections.flatMap((section) => section.items.map((item) => item.key));

    const operator = getShellNavSections(hr000, { mode: "operator" });
    const worker = getShellNavSections(hr000, { mode: "worker" });

    // Operator mode keeps the operator/platform surfaces…
    expect(keys(operator)).toEqual(expect.arrayContaining(["platform", "admin", "ai_workforce", "backlog"]));
    // …worker mode hides them and keeps the business/workspace day-to-day surfaces.
    expect(keys(worker)).not.toContain("platform");
    expect(keys(worker)).not.toContain("admin");
    expect(keys(worker)).not.toContain("ai_workforce");
    expect(keys(worker)).toEqual(expect.arrayContaining(["workspace", "customer", "finance"]));
    expect(keys(operator)).toContain("performance");
    expect(keys(worker)).not.toContain("performance");
  });

  it("shows Operations to workforce members while server-gating Performance", () => {
    const keys = getShellNavSections(hr600, { mode: "operator" })
      .flatMap((section) => section.items.map((item) => item.key));

    expect(keys).toContain("workspace");
    expect(keys).not.toContain("performance");
  });

  it("presents Operations and Performance as owner/manager rail siblings", () => {
    for (const user of [hr000, hr500]) {
      const workspaceItems = getShellNavSections(user, { mode: "operator" })
        .find((section) => section.key === "workspace")
        ?.items ?? [];

      expect(workspaceItems.map((item) => [item.key, item.label, item.href])).toEqual(
        expect.arrayContaining([
          ["workspace", "Operations", "/workspace"],
          ["performance", "Performance", "/performance"],
        ]),
      );
    }
  });

  it("treats no mode as the full operator rail (backward compatible)", () => {
    const keys = (sections: ReturnType<typeof getShellNavSections>) =>
      sections.flatMap((section) => section.items.map((item) => item.key));
    expect(keys(getShellNavSections(hr000))).toEqual(keys(getShellNavSections(hr000, { mode: "operator" })));
  });

  it("omits empty sections for more limited roles", () => {
    const sections = getShellNavSections(hr500);

    expect(sections.map((section) => section.key)).toEqual([
      "workspace",
      "business",
      "products",
      "knowledge",
    ]);
    expect(sections.find((section) => section.key === "platform")).toBeUndefined();
  });

  it("hides archetype-gated entries unless the org capability is active", () => {
    const businessItems = (sections: ReturnType<typeof getShellNavSections>) =>
      sections.find((section) => section.key === "business")?.items.map((item) => item.key) ?? [];

    // No org context → civic entries hidden (safe default), permission entries unaffected.
    const withoutOrg = getShellNavSections(hr000);
    expect(businessItems(withoutOrg)).not.toContain("governance");
    expect(businessItems(withoutOrg)).not.toContain("service-requests");
    expect(businessItems(withoutOrg)).toContain("compliance");

    // Public-body org → civic entries render for a permitted user.
    const withCivicOrg = getShellNavSections(hr000, {
      activeOrgCapabilities: new Set(["public-body-governance", "service-request-311"]),
    });
    expect(businessItems(withCivicOrg)).toContain("governance");
    expect(businessItems(withCivicOrg)).toContain("service-requests");

    // Commercial org (empty set) → still hidden.
    const withCommercialOrg = getShellNavSections(hr000, { activeOrgCapabilities: new Set() });
    expect(businessItems(withCommercialOrg)).not.toContain("governance");
  });

  it("renders the shared /governance entry for either governance flavor via the any-of gate", () => {
    const governanceItems = (capabilities: Set<string>) =>
      getShellNavSections(hr000, { activeOrgCapabilities: capabilities })
        .find((section) => section.key === "business")
        ?.items.filter((item) => item.href === "/governance") ?? [];

    // Member-owned org: governance via the any-of gate, plus member equity.
    const memberOwned = getShellNavSections(hr000, {
      activeOrgCapabilities: new Set(["member-governance", "member-equity"]),
    });
    expect(governanceItems(new Set(["member-governance", "member-equity"]))).toHaveLength(1);
    expect(
      memberOwned.find((section) => section.key === "business")?.items.map((item) => item.key),
    ).toContain("member-equity");

    // Public body: same single entry.
    expect(governanceItems(new Set(["public-body-governance"]))).toHaveLength(1);

    // Commercial: none.
    expect(governanceItems(new Set())).toHaveLength(0);
  });
});

describe("getAccessibleSectionNavEntries()", () => {
  it("builds customer domain tabs from the canonical navigation model", () => {
    const tabs = getAccessibleSectionNavEntries(hr000, "/customer");

    expect(tabs.map((tab) => tab.label)).toEqual([
      "Accounts",
      "Engagements",
      "Pipeline",
      "Quotes",
      "Orders",
      "Sales Funnel",
      "Marketing",
    ]);
    expect(tabs.map((tab) => tab.href)).toContain("/customer/marketing");
  });

  it("keeps marketing reachable for marketing-only users without exposing CRM tabs", () => {
    const tabs = getAccessibleSectionNavEntries(hr300, "/customer");

    expect(tabs.map((tab) => tab.label)).toEqual(["Marketing"]);
    expect(tabs[0]?.href).toBe("/customer/marketing");
  });
});

describe("getWorkspaceSections()", () => {
  it("prioritizes AI coworker oversight for admins", () => {
    const sections = getWorkspaceSections(hr000);

    expect(sections[0]?.key).toBe("ai-control");
    expect(sections[0]?.tiles.map((tile) => tile.key)).toContain("ai_workforce");
    expect(sections[0]?.tiles.map((tile) => tile.key)).toContain("build");
  });

  it("organizes workspace by jobs to be done instead of one flat launcher", () => {
    const sections = getWorkspaceSections(hr000);

    expect(sections.map((section) => section.key)).toEqual([
      "ai-control",
      "product-oversight",
      "business-operations",
    ]);
    expect(sections.find((section) => section.key === "product-oversight")?.tiles.map((tile) => tile.key)).not.toContain("inventory");
    expect(sections.find((section) => section.key === "business-operations")?.tiles.map((tile) => tile.key)).toContain("finance");
  });
});

describe("finance permissions", () => {
  it("grants view_finance to HR-000 and HR-200", () => {
    expect(can({ platformRole: "HR-000", isSuperuser: false }, "view_finance")).toBe(true);
    expect(can({ platformRole: "HR-200", isSuperuser: false }, "view_finance")).toBe(true);
  });

  it("denies view_finance to HR-400", () => {
    expect(can({ platformRole: "HR-400", isSuperuser: false }, "view_finance")).toBe(false);
  });

  it("grants manage_finance to HR-000 and HR-200", () => {
    expect(can({ platformRole: "HR-000", isSuperuser: false }, "manage_finance")).toBe(true);
    expect(can({ platformRole: "HR-200", isSuperuser: false }, "manage_finance")).toBe(true);
  });

  it("includes Finance workspace tile for HR-200", () => {
    const tiles = getWorkspaceTiles({ platformRole: "HR-200", isSuperuser: false });
    expect(tiles.some((t) => t.key === "finance")).toBe(true);
  });

  it("superuser gets finance access", () => {
    expect(can({ platformRole: null, isSuperuser: true }, "view_finance")).toBe(true);
    expect(can({ platformRole: null, isSuperuser: true }, "manage_finance")).toBe(true);
  });
});

describe("marketing permissions", () => {
  it("grants view_marketing to HR-300", () => {
    expect(can({ platformRole: "HR-300", isSuperuser: false }, "view_marketing")).toBe(true);
  });

  it("grants operate_marketing to HR-300", () => {
    expect(can({ platformRole: "HR-300", isSuperuser: false }, "operate_marketing")).toBe(true);
  });

  it("denies publish_marketing to HR-300", () => {
    expect(can({ platformRole: "HR-300", isSuperuser: false }, "publish_marketing")).toBe(false);
  });

  it("denies all marketing capabilities to HR-500", () => {
    const user = { platformRole: "HR-500", isSuperuser: false } as const;
    expect(can(user, "view_marketing")).toBe(false);
    expect(can(user, "operate_marketing")).toBe(false);
    expect(can(user, "publish_marketing")).toBe(false);
  });
});

describe("canAccessEmployeeRecord()", () => {
  it("allows access to a direct report when the user can view employees", () => {
    expect(
      canAccessEmployeeRecord(
        {
          principalId: "PRN-USER-user-1",
          principalAliases: [],
          population: "workforce",
          platformRole: "HR-100",
          isSuperuser: false,
          employeeId: "emp-manager",
          managerScope: {
            directReportIds: ["emp-report-1"],
            indirectReportIds: [],
          },
          teamIds: [],
          accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
          sensitivityClearance: ["public"],
          authentication: {
            source: "session",
            methods: [],
            contextClassReference: null,
          },
          actingHumanUserId: "user-1",
          actingAgentId: null,
          delegationGrantIds: [],
          grantedCapabilities: ["view_employee"],
        },
        "emp-report-1",
      ),
    ).toBe(true);
  });

  it("denies access without the employee-view capability", () => {
    expect(
      canAccessEmployeeRecord(
        {
          principalId: "PRN-USER-user-1",
          principalAliases: [],
          population: "workforce",
          platformRole: "HR-100",
          isSuperuser: false,
          employeeId: "emp-manager",
          managerScope: {
            directReportIds: ["emp-report-1"],
            indirectReportIds: [],
          },
          teamIds: [],
          accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
          sensitivityClearance: ["public"],
          authentication: {
            source: "session",
            methods: [],
            contextClassReference: null,
          },
          actingHumanUserId: "user-1",
          actingAgentId: null,
          delegationGrantIds: [],
          grantedCapabilities: [],
        },
        "emp-report-1",
      ),
    ).toBe(false);
  });
});

// EP-EMPLOYEE-OCCUPATION P0.1 (BI-6A79A315): HR-600 "Workforce Member" is the
// least-privilege base access floor for in-trench employees. These tests pin the
// floor so a later change cannot silently widen it (the security half of the
// non-widening invariant, spec §5.4).
describe("HR-600 Workforce Member base floor", () => {
  const hr600 = { platformRole: "HR-600", isSuperuser: false };

  it("is a valid, recognized platform role", () => {
    // A recognized role returns a real (possibly empty) capability set, not the
    // null-role short-circuit. HR-600 grants the workbooks pair, so this is non-empty.
    expect(getGrantedCapabilities(hr600).length).toBeGreaterThan(0);
  });

  it("grants only the workbooks work-surface pair", () => {
    expect(can(hr600, "view_workbooks")).toBe(true);
    expect(can(hr600, "manage_workbooks")).toBe(true);
  });

  it("denies every platform-management capability (deny by default)", () => {
    const denied: CapabilityKey[] = [
      "view_admin",
      "view_finance",
      "manage_finance",
      "view_customer",
      "operate_customer",
      "view_employee",
      "manage_user_lifecycle",
      "manage_backlog",
      "view_operations",
      "view_business_performance",
      "view_platform",
      "manage_platform",
      "manage_users",
      "manage_agents",
      "view_portfolio",
    ];
    denied.forEach((k) => expect(can(hr600, k)).toBe(false));
  });

  it("sees no platform-management workspace tiles by default", () => {
    // The occupation dimension focuses the surface on top; the raw role floor is bare.
    const tiles = getWorkspaceTiles(hr600);
    expect(tiles.every((t) => t.capabilityKey !== "view_admin")).toBe(true);
    expect(tiles.every((t) => t.capabilityKey !== "view_finance")).toBe(true);
  });
});
