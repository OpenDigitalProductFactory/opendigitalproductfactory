import { describe, expect, it, vi } from "vitest";

import { resolveQualificationLeasePrincipalId } from "./qualification-admission-ownership";

describe("resolveQualificationLeasePrincipalId", () => {
  it("returns the Principal record id stored by the Workroom lease, not its public principalId", async () => {
    const findUnique = vi.fn().mockResolvedValue({ principalId: "principal-row-id" });
    await expect(resolveQualificationLeasePrincipalId({ principalAlias: { findUnique } }, "AGT-EXT-CODEX"))
      .resolves.toBe("principal-row-id");
    expect(findUnique).toHaveBeenCalledWith({
      where: { aliasType_aliasValue_issuer: { aliasType: "agent", aliasValue: "AGT-EXT-CODEX", issuer: "" } },
      select: { principalId: true },
    });
  });

  it("fails closed when the agent has no canonical principal alias", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    await expect(resolveQualificationLeasePrincipalId({ principalAlias: { findUnique } }, "unknown"))
      .resolves.toBeNull();
  });
});
