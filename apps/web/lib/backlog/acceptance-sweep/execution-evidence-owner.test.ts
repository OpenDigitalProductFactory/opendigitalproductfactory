// BI-A8679D84 — the execution-evidence lane names an owner that can also write
// the verify stage's evidence. Live, DEV 2026-10-20→10-28: AGT-102 (holds
// backlog_write, so record_execution_evidence) was bound to 16 acceptance rooms
// whose verify stage owes record_workroom_evidence, which it is not authorized
// for; all 93 of its stage runs were refused before dispatch.
import { describe, expect, it } from "vitest";

import { resolveExecutionEvidenceOwner } from "./execution-evidence-owner";
import type { InPlatformGrants } from "./in-platform-owners";

const agent = (agentId: string) => ({ agentId, displayName: agentId, status: "active", archived: false, lifecycleStage: "production" });
const HELD: Record<string, string[]> = {
  "AGT-102": ["backlog_write"],
  "AGT-WS-PORTFOLIO": ["backlog_write", "workroom_evidence_write"],
};
const grants: InPlatformGrants = {
  db: {
    agentToolGrant: {
      findMany: async (args: unknown) => {
        const wanted = new Set((args as { where: { grantKey: { in: string[] } } }).where.grantKey.in);
        return Object.entries(HELD).flatMap(([agentId, keys]) =>
          keys.filter((grantKey) => wanted.has(grantKey)).map((grantKey) => ({ grantKey, agent: agent(agentId) })));
      },
    },
  },
  externalHoldersOf: () => [],
};
const entries = [{ code: "ACCEPTANCE_EVIDENCE_REQUIRED" as const }];

describe("resolveExecutionEvidenceOwner and the stage's own writer (BI-A8679D84)", () => {
  it("skips a holder that cannot write the stage evidence", async () => {
    const owned = await resolveExecutionEvidenceOwner({
      entries, authorAgentId: null, grants,
      satisfyingGrants: ["build_evidence", "backlog_write"],
      stageWriterGrants: ["workroom_evidence_write", "work_capsule_write"],
    });
    expect(owned.reviewerRoutes.map((route) => route.targetAgentId)).toEqual(["AGT-WS-PORTFOLIO"]);
  });

  it("escalates instead of naming an owner that cannot write the stage evidence", async () => {
    const owned = await resolveExecutionEvidenceOwner({
      entries, authorAgentId: "AGT-WS-PORTFOLIO", grants,
      satisfyingGrants: ["build_evidence", "backlog_write"],
      stageWriterGrants: ["workroom_evidence_write", "work_capsule_write"],
    });
    expect(owned.reviewerRoutes).toEqual([]);
    expect(owned.escalations[0]?.reason).toBe("no-eligible-reviewer");
  });

  it("is unchanged when no stage writer is required", async () => {
    const owned = await resolveExecutionEvidenceOwner({
      entries, authorAgentId: null, grants, satisfyingGrants: ["build_evidence", "backlog_write"],
    });
    expect(owned.reviewerRoutes.map((route) => route.targetAgentId)).toEqual(["AGT-102"]);
  });
});
