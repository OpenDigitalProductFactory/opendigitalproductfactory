import { describe, expect, it } from "vitest";

import {
  AUTH_POPULATIONS,
  buildEffectiveAuthContext,
} from "./effective-auth-context";

const baseUser = {
  id: "user-1",
  type: "admin" as const,
  platformRole: "HR-300",
  isSuperuser: false,
  accountId: null,
  contactId: null,
};

describe("buildEffectiveAuthContext", () => {
  it("normalizes authoritative workforce scope deterministically", () => {
    const context = buildEffectiveAuthContext({
      user: baseUser,
      grantedCapabilities: ["view_employee", "view_admin", "view_employee"],
      principal: {
        principalId: "PRN-000123",
        kind: "human",
        sensitivityClearance: ["restricted", "public", "restricted"],
        aliases: [
          { aliasType: "user", aliasValue: "user-1", issuer: "" },
          { aliasType: "employee", aliasValue: "EMP-1", issuer: "" },
        ],
      },
      employeeProfile: {
        id: "emp-1",
        directReportIds: ["emp-3", "emp-2", "emp-3"],
        indirectReportIds: ["emp-5", "emp-4"],
      },
      teamIds: ["team-b", "team-a", "team-b"],
      authentication: {
        source: "bearer",
        methods: ["otp", "pwd", "otp"],
        contextClassReference: "urn:example:assurance:2",
      },
      delegationGrantIds: ["DGR-2", "DGR-1", "DGR-2"],
    });

    expect(context).toMatchObject({
      principalId: "PRN-000123",
      population: "workforce",
      employeeId: "emp-1",
      managerScope: {
        directReportIds: ["emp-2", "emp-3"],
        indirectReportIds: ["emp-4", "emp-5"],
      },
      teamIds: ["team-a", "team-b"],
      sensitivityClearance: ["public", "restricted"],
      authentication: {
        source: "bearer",
        methods: ["otp", "pwd"],
        contextClassReference: "urn:example:assurance:2",
      },
      delegationGrantIds: ["DGR-1", "DGR-2"],
      grantedCapabilities: ["view_admin", "view_employee"],
    });
  });

  it.each([
    ["workforce", "human", "admin"],
    ["customer", "customer", "customer"],
    ["partner", "partner", "customer"],
    ["service", "service", "admin"],
    ["ai-coworker", "agent", "admin"],
  ] as const)(
    "builds a fail-closed %s population fixture",
    (expectedPopulation, principalKind, userType) => {
      const context = buildEffectiveAuthContext({
        user: {
          ...baseUser,
          type: userType,
          accountId: userType === "customer" ? "ACC-1" : null,
          contactId: userType === "customer" ? "CONTACT-1" : null,
        },
        grantedCapabilities: [],
        principal: {
          principalId: `PRN-${expectedPopulation}`,
          kind: principalKind,
        },
      });

      expect(context.population).toBe(expectedPopulation);
      expect(context.sensitivityClearance).toEqual(["public"]);
      expect(context.authentication).toEqual({
        source: "unknown",
        methods: [],
        contextClassReference: null,
      });
    },
  );

  it("represents an AI coworker acting with a human only through explicit evidence", () => {
    const context = buildEffectiveAuthContext({
      user: baseUser,
      grantedCapabilities: [],
      population: "ai-coworker",
      actingHumanUserId: "user-owner",
      actingAgentId: "AGT-100",
      delegationGrantIds: ["DGR-001"],
    });

    expect(context.actingHumanUserId).toBe("user-owner");
    expect(context.actingAgentId).toBe("AGT-100");
    expect(context.delegationGrantIds).toEqual(["DGR-001"]);
  });

  it("keeps the fixture matrix aligned with the closed population vocabulary", () => {
    expect(AUTH_POPULATIONS).toEqual([
      "workforce",
      "customer",
      "partner",
      "service",
      "ai-coworker",
    ]);
  });

  it("rejects unknown sensitivity instead of widening clearance", () => {
    expect(() =>
      buildEffectiveAuthContext({
        user: baseUser,
        grantedCapabilities: [],
        principal: {
          principalId: "PRN-1",
          kind: "human",
          sensitivityClearance: ["secret"],
        },
      }),
    ).toThrow("Unknown principal sensitivity clearance: secret");
  });
});
