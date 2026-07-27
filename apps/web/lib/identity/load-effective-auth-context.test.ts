import { describe, expect, it, vi } from "vitest";

import {
  loadEffectiveAuthContext,
  resolveManagerScope,
} from "./load-effective-auth-context";

describe("resolveManagerScope", () => {
  it("computes direct and transitive indirect reports", () => {
    expect(
      resolveManagerScope(
        [
          { id: "manager", userId: "user-1", managerEmployeeId: null },
          { id: "direct-b", userId: "user-2", managerEmployeeId: "manager" },
          { id: "direct-a", userId: "user-3", managerEmployeeId: "manager" },
          { id: "indirect", userId: "user-4", managerEmployeeId: "direct-a" },
        ],
        "user-1",
      ),
    ).toEqual({
      employeeId: "manager",
      directReportIds: ["direct-a", "direct-b"],
      indirectReportIds: ["indirect"],
    });
  });

  it("terminates a malformed reporting cycle without granting self", () => {
    const result = resolveManagerScope(
      [
        { id: "manager", userId: "user-1", managerEmployeeId: "indirect" },
        { id: "direct", userId: "user-2", managerEmployeeId: "manager" },
        { id: "indirect", userId: "user-3", managerEmployeeId: "direct" },
      ],
      "user-1",
    );

    expect(result).toEqual({
      employeeId: "manager",
      directReportIds: ["direct"],
      indirectReportIds: ["indirect"],
    });
  });
});

describe("loadEffectiveAuthContext", () => {
  it("hydrates canonical workforce scope and filters exhausted delegation grants", async () => {
    const db = {
      principalAlias: {
        findFirst: vi.fn().mockResolvedValue({
          principal: {
            principalId: "PRN-1",
            kind: "human",
            status: "active",
            sensitivityClearance: ["confidential", "public"],
            aliases: [{ aliasType: "user", aliasValue: "user-1", issuer: "" }],
          },
        }),
      },
      employeeProfile: {
        findMany: vi.fn().mockResolvedValue([
          { id: "manager", userId: "user-1", managerEmployeeId: null },
          { id: "direct", userId: "user-2", managerEmployeeId: "manager" },
          { id: "indirect", userId: "user-3", managerEmployeeId: "direct" },
        ]),
      },
      teamMembership: {
        findMany: vi.fn().mockResolvedValue([{ teamId: "team-b" }, { teamId: "team-a" }]),
      },
      delegationGrant: {
        findMany: vi.fn().mockResolvedValue([
          { grantId: "DGR-ACTIVE", maxUses: 2, useCount: 1 },
          { grantId: "DGR-EXHAUSTED", maxUses: 1, useCount: 1 },
        ]),
      },
    };

    const context = await loadEffectiveAuthContext(
      {
        user: {
          id: "user-1",
          email: "manager@example.com",
          type: "admin",
          platformRole: "HR-300",
          isSuperuser: false,
          accountId: null,
          accountName: null,
          contactId: null,
        },
        grantedCapabilities: ["view_employee"],
        authentication: {
          source: "bearer",
          methods: ["pwd", "otp"],
          contextClassReference: "urn:example:aal2",
        },
        actingAgentId: "AGT-1",
        now: new Date("2026-07-27T12:00:00Z"),
      },
      db,
    );

    expect(context).toMatchObject({
      principalId: "PRN-1",
      teamIds: ["team-a", "team-b"],
      managerScope: {
        directReportIds: ["direct"],
        indirectReportIds: ["indirect"],
      },
      sensitivityClearance: ["public", "confidential"],
      actingHumanUserId: "user-1",
      actingAgentId: "AGT-1",
      delegationGrantIds: ["DGR-ACTIVE"],
    });
  });

  it("uses canonical partner identity and authenticated account scope", async () => {
    const db = {
      principalAlias: {
        findFirst: vi.fn().mockResolvedValue({
          principal: {
            principalId: "PRN-PARTNER",
            kind: "partner",
            status: "active",
            sensitivityClearance: ["public"],
            aliases: [
              { aliasType: "partner_contact", aliasValue: "contact-1", issuer: "" },
            ],
          },
        }),
      },
      employeeProfile: { findMany: vi.fn() },
      teamMembership: { findMany: vi.fn() },
      delegationGrant: { findMany: vi.fn() },
    };

    const context = await loadEffectiveAuthContext(
      {
        user: {
          id: "contact-1",
          email: "partner@example.com",
          type: "customer",
          platformRole: null,
          isSuperuser: false,
          accountId: "ACC-PARTNER",
          accountName: "Partner",
          contactId: "contact-1",
        },
        grantedCapabilities: [],
        authentication: { source: "session" },
      },
      db,
    );

    expect(context.population).toBe("partner");
    expect(context.accountScope).toEqual({
      accountIds: ["ACC-PARTNER"],
      contactIds: ["contact-1"],
      partnerAccountIds: ["ACC-PARTNER"],
    });
    expect(db.employeeProfile.findMany).not.toHaveBeenCalled();
  });

  it("rejects an inactive canonical principal", async () => {
    const db = {
      principalAlias: {
        findFirst: vi.fn().mockResolvedValue({
          principal: {
            principalId: "PRN-INACTIVE",
            kind: "human",
            status: "inactive",
            sensitivityClearance: ["public"],
            aliases: [],
          },
        }),
      },
      employeeProfile: { findMany: vi.fn().mockResolvedValue([]) },
      teamMembership: { findMany: vi.fn().mockResolvedValue([]) },
      delegationGrant: { findMany: vi.fn() },
    };

    await expect(
      loadEffectiveAuthContext(
        {
          user: {
            id: "user-1",
            email: "inactive@example.com",
            type: "admin",
            platformRole: null,
            isSuperuser: false,
            accountId: null,
            accountName: null,
            contactId: null,
          },
          grantedCapabilities: [],
          authentication: { source: "session" },
        },
        db,
      ),
    ).rejects.toThrow("Principal PRN-INACTIVE is not active");
  });
});
