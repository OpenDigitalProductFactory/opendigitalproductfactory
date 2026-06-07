import { describe, expect, it } from "vitest";
import {
  projectDeliberations,
  type DeliberationSourceRow,
} from "./project-deliberations";
import type { RoutingCoworkerSourceRow } from "./project-routing-topology";

const AGENTS: RoutingCoworkerSourceRow[] = [
  { agentId: "ceo-coworker", name: "CEO Coworker", stationLabel: "Direct" },
  { agentId: "ea-architect", name: "EA Architect", stationLabel: "Integrate" },
];

function run(overrides: Partial<DeliberationSourceRow> = {}): DeliberationSourceRow {
  return {
    id: "delib-1",
    coordinatorAgentId: "ceo-coworker",
    pattern: "Diversity review",
    diversityMode: "multi-provider-heterogeneous",
    consensusState: "consensus",
    startedAt: new Date("2026-06-05T10:00:00.000Z"),
    branches: [
      { nodeId: "n1", role: "reviewer", modelId: "claude-sonnet", providerId: "anthropic", status: "completed" },
      { nodeId: "n2", role: "skeptical_reviewer", modelId: "gpt-5", providerId: "openai", status: "completed" },
    ],
    ...overrides,
  };
}

describe("deliberation lens projection", () => {
  it("returns an empty list when there are no deliberations", () => {
    expect(projectDeliberations({ agents: AGENTS, deliberations: [] })).toEqual([]);
  });

  it("projects a deliberation with its coordinator label and branch roster", () => {
    const [delib] = projectDeliberations({ agents: AGENTS, deliberations: [run()] });
    expect(delib).toEqual(
      expect.objectContaining({
        id: "delib-1",
        coordinatorCoworkerId: "ceo-coworker",
        coordinatorLabel: "CEO Coworker",
        pattern: "Diversity review",
        diversityMode: "multi-provider-heterogeneous",
        consensusState: "consensus",
        occurredAt: "2026-06-05T10:00:00.000Z",
      }),
    );
    expect(delib.branches).toEqual([
      { nodeId: "n1", role: "reviewer", modelId: "claude-sonnet", providerId: "anthropic", status: "completed" },
      { nodeId: "n2", role: "skeptical_reviewer", modelId: "gpt-5", providerId: "openai", status: "completed" },
    ]);
  });

  it("titleizes an unknown coordinator id rather than dropping the run", () => {
    const [delib] = projectDeliberations({
      agents: AGENTS,
      deliberations: [run({ coordinatorAgentId: "hive-scout" })],
    });
    expect(delib.coordinatorCoworkerId).toBe("hive-scout");
    expect(delib.coordinatorLabel).toBe("Hive Scout");
  });

  it("keeps a coordinator-less run but marks it unattributed (never fabricates a coworker)", () => {
    const [delib] = projectDeliberations({
      agents: AGENTS,
      deliberations: [run({ coordinatorAgentId: null })],
    });
    expect(delib.coordinatorCoworkerId).toBeNull();
    expect(delib.coordinatorLabel).toBe("Unattributed coordinator");
  });

  it("preserves role-only branches for single-model-multi-persona runs (no model/provider)", () => {
    const [delib] = projectDeliberations({
      agents: AGENTS,
      deliberations: [
        run({
          diversityMode: "single-model-multi-persona",
          branches: [
            { nodeId: "n1", role: "reviewer", modelId: null, providerId: null, status: "completed" },
            { nodeId: "n2", role: "skeptical_reviewer", modelId: null, providerId: null, status: "running" },
          ],
        }),
      ],
    });
    expect(delib.branches.map((b) => b.role)).toEqual(["reviewer", "skeptical_reviewer"]);
    expect(delib.branches.every((b) => b.modelId === null && b.providerId === null)).toBe(true);
  });

  it("sorts deliberations newest-first", () => {
    const list = projectDeliberations({
      agents: AGENTS,
      deliberations: [
        run({ id: "old", startedAt: new Date("2026-06-05T08:00:00.000Z") }),
        run({ id: "new", startedAt: new Date("2026-06-05T12:00:00.000Z") }),
      ],
    });
    expect(list.map((d) => d.id)).toEqual(["new", "old"]);
  });
});
