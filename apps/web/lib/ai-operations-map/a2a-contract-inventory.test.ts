/**
 * BI-D5348705 — structural contract: inventory doc must stay grounded in the
 * real A2A edge kinds exported by project-a2a-interactions (shipped code).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  A2A_INTERACTION_LEGEND,
  projectA2aInteractions,
} from "./project-a2a-interactions";

const INVENTORY_REL =
  "docs/superpowers/specs/2026-08-04-a2a-coworker-collaboration-contract-inventory.md";

function inventoryBody(): string {
  // Resolve from monorepo root (apps/web → ../..)
  const root = join(__dirname, "..", "..", "..", "..");
  return readFileSync(join(root, INVENTORY_REL), "utf8");
}

describe("BI-D5348705 A2A contract inventory grounding", () => {
  it("documents every shipped A2A edge kind from A2A_INTERACTION_LEGEND", () => {
    const body = inventoryBody();
    expect(body).toMatch(/BI-D5348705/);
    expect(body).toMatch(/MCP/);
    expect(body).toMatch(/partially sufficient|Partially sufficient/i);
    for (const item of A2A_INTERACTION_LEGEND) {
      expect(body, `inventory missing edgeKind ${item.edgeKind}`).toContain(
        item.edgeKind,
      );
    }
  });

  it("projectA2aInteractions still yields the four legend kinds from real substrate rows", () => {
    const started = new Date("2026-08-04T12:00:00.000Z");
    const projection = projectA2aInteractions({
      agents: [
        {
          agentId: "platform-engineer",
          name: "AI Ops",
          role: "ops",
          status: "active",
        } as never,
        {
          agentId: "marketing-specialist",
          name: "Marketing",
          role: "marketing",
          status: "active",
        } as never,
      ],
      delegationChains: [
        {
          id: "dc1",
          chainId: "c1",
          depth: 1,
          fromAgentId: "platform-engineer",
          toAgentId: "marketing-specialist",
          skillId: "dpf-tdd",
          authorityScope: ["backlog_write"],
          status: "completed",
          reason: "test",
          startedAt: started,
          completedAt: started,
        },
      ],
      phaseHandoffs: [
        {
          id: "ph1",
          buildId: "FB-1",
          fromPhase: "plan",
          toPhase: "build",
          fromAgentId: "platform-engineer",
          toAgentId: "marketing-specialist",
          summary: "gate ok",
          gatePassed: true,
          gateLabel: "ok",
          tokenBudgetUsed: 10,
          createdAt: started,
        },
      ],
      taskLineage: [
        {
          id: "tr1",
          taskRunId: "TR-1",
          initiatingAgentId: "platform-engineer",
          currentAgentId: "marketing-specialist",
          parentTaskRunId: null,
          parentAgentId: null,
          title: "t",
          objective: null,
          status: "completed",
          buildId: null,
          startedAt: started,
        },
      ],
      deliberations: [
        {
          id: "del1",
          coordinatorAgentId: "platform-engineer",
          patternLabel: "pair",
          consensusState: "open",
          taskRunId: "TR-D",
          startedAt: started,
          branches: [
            {
              nodeId: "n1",
              agentId: "marketing-specialist",
              workerRole: "critic",
              status: "done",
            },
          ],
        },
      ],
    });

    const kinds = new Set(projection.a2aEdges.map((e) => e.edgeKind));
    for (const item of A2A_INTERACTION_LEGEND) {
      expect(kinds.has(item.edgeKind), `missing projection for ${item.edgeKind}`).toBe(
        true,
      );
    }
    expect(projection.legend).toEqual(A2A_INTERACTION_LEGEND);
  });

  it("documents that A2A deliberation edges are loader-deferred (empty deliberations input path)", () => {
    const body = inventoryBody();
    expect(body).toMatch(/deliberations:\s*\[\]|loader passes `deliberations: \[\]`/i);
    // Empty deliberation list must not invent edges from the projector.
    const empty = projectA2aInteractions({
      agents: [],
      delegationChains: [],
      phaseHandoffs: [],
      taskLineage: [],
      deliberations: [],
    });
    expect(empty.a2aEdges.filter((e) => e.edgeKind === "a2a-deliberation")).toHaveLength(
      0,
    );
  });
});
