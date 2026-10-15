// BI-957915CB: the one rule for who may read a managed document. An
// organization document is readable across the organization; any other scope
// is restricted to its owner, its creator and unexpired grantees.
import { describe, expect, it } from "vitest";
import { canManageDocumentAccess, isDocumentReadable, readableDocumentWhere } from "./document-access";
import { matchesWhere } from "./document-access.test-support";

const NOW = new Date("2026-10-14T12:00:00Z");

function doc(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "DOC-1",
    accessScope: "restricted",
    ownerPrincipalId: "owner",
    createdByPrincipalId: "creator",
    accessGrants: [
      { principalId: "grantee", expiresAt: null },
      { principalId: "expired", expiresAt: new Date("2026-10-01T00:00:00Z") },
      { principalId: "later", expiresAt: new Date("2026-11-01T00:00:00Z") },
    ],
    ...overrides,
  };
}

describe("readableDocumentWhere", () => {
  const cases: Array<[string, string | null, boolean]> = [
    ["owner", "owner", true],
    ["creator", "creator", true],
    ["grantee without expiry", "grantee", true],
    ["grantee with a future expiry", "later", true],
    ["grantee whose grant expired", "expired", false],
    ["stranger", "stranger", false],
    ["viewer with no principal", null, false],
  ];
  for (const [label, principalId, readable] of cases) {
    it(`restricted document: ${label} → ${readable ? "readable" : "refused"}`, () => {
      const where = readableDocumentWhere({ principalId }, NOW);
      expect(matchesWhere(doc(), where, NOW)).toBe(readable);
      expect(isDocumentReadable(doc(), { principalId }, NOW)).toBe(readable);
    });
  }

  it("an organization document is readable by every viewer, even one with no principal", () => {
    for (const principalId of ["stranger", null]) {
      const where = readableDocumentWhere({ principalId }, NOW);
      expect(matchesWhere(doc({ accessScope: "organization" }), where, NOW)).toBe(true);
      expect(isDocumentReadable(doc({ accessScope: "organization" }), { principalId }, NOW)).toBe(true);
    }
  });

  it("an unknown scope fails closed", () => {
    const where = readableDocumentWhere({ principalId: "stranger" }, NOW);
    expect(matchesWhere(doc({ accessScope: "everyone" }), where, NOW)).toBe(false);
    expect(isDocumentReadable(doc({ accessScope: "everyone" }), { principalId: "stranger" }, NOW)).toBe(false);
  });
});

describe("canManageDocumentAccess", () => {
  it("lets only the owner or creator change scope or owner of a restricted document", () => {
    expect(canManageDocumentAccess(doc(), { principalId: "owner" })).toBe(true);
    expect(canManageDocumentAccess(doc(), { principalId: "creator" })).toBe(true);
    expect(canManageDocumentAccess(doc(), { principalId: "grantee" })).toBe(false);
    expect(canManageDocumentAccess(doc(), { principalId: null })).toBe(false);
  });

  it("leaves an organization document's scope to anyone who may write it", () => {
    expect(canManageDocumentAccess(doc({ accessScope: "organization" }), { principalId: "stranger" })).toBe(true);
  });
});
