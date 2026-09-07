import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/tak/agent-grants", () => ({
  getAgentToolGrantsAsync: vi.fn().mockResolvedValue(["backlog_write"]),
  isToolAllowedByGrants: (_tool: string, grants: string[]) => grants.includes("backlog_write"),
}));
import { getAgentToolGrantsAsync } from "@/lib/tak/agent-grants";
import { createSemanticReviewRequest } from "./semantic-review-request";
import { verifySemanticReviewAuthority } from "./semantic-review-authority";

function fixture() {
  const packet = createSemanticReviewRequest({ surface: "external", authorSurface: "codex", artifactType: "code-change",
    title: "Review", artifact: "diff", changedFiles: ["a.ts"], verificationEvidence: "Test passed",
    identity: { capsuleId: "WC-TEST", baseTreeHash: "a".repeat(40), headTreeHash: "b".repeat(40),
      diffDigest: createHash("sha256").update("diff").digest("hex"), specialistIds: [] },
  }, { userId: "user-1", agentId: "agent-1", apiTokenId: "token-1", authSource: "pat" });
  const db = {
    user: { findUnique: vi.fn().mockResolvedValue({ isActive: true, isSuperuser: true, groups: [] }) },
    mcpApiToken: { findFirst: vi.fn().mockResolvedValue({ scope: "write", scopes: ["backlog_write"] }) },
    taskRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", userId: "user-1", initiatingAgentId: "agent-1" }) },
    workroom: { findUnique: vi.fn().mockResolvedValue({ id: "room-1", executorRef: "agent-1", participants: [] }) },
  };
  return { packet, db };
}
beforeEach(() => { vi.mocked(getAgentToolGrantsAsync).mockResolvedValue(["backlog_write"]); });
describe("durable review authority", () => {
  it("uses current token, user and TaskRun authority", async () => {
    const { packet, db } = fixture();
    expect(await verifySemanticReviewAuthority(packet, "TR-1", db as never)).toBe(true);
    expect(db.mcpApiToken.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: "token-1", userId: "user-1", agentId: "agent-1", revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
    }) }));
  });
  it.each(["inactive-user", "revoked-token", "read-token", "revoked-grant", "reassigned-run"])("refuses %s", async (condition) => {
    const { packet, db } = fixture();
    if (condition === "inactive-user") db.user.findUnique.mockResolvedValue({ isActive: false, isSuperuser: true, groups: [] });
    if (condition === "revoked-token") db.mcpApiToken.findFirst.mockResolvedValue(null);
    if (condition === "read-token") db.mcpApiToken.findFirst.mockResolvedValue({ scope: "read", scopes: ["backlog_write"] });
    if (condition === "revoked-grant") vi.mocked(getAgentToolGrantsAsync).mockResolvedValue([]);
    if (condition === "reassigned-run") db.taskRun.findUnique.mockResolvedValue({ id: "run-1", userId: "other", initiatingAgentId: "other" });
    expect(await verifySemanticReviewAuthority(packet, "TR-1", db as never)).toBe(false);
  });
});
