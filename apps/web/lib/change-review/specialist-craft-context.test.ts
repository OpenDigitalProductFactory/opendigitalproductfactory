import { describe, expect, it } from "vitest";

import {
  describeSpecialistCraftContexts,
  layerCraftOntoSpecialistPrompt,
  resolveSpecialistCraftContexts,
  type SpecialistAgentRow,
  type SpecialistCraftClient,
} from "./specialist-craft-context";

/**
 * The identity tuple the seed actually persists for the four pre-commit
 * specialists. These role slugs are the ones docs/professions/registry.json
 * binds; the AGT-* ids are bound by nothing, which is the whole defect
 * (BI-39C7D449).
 */
const SEEDED_AGENTS: SpecialistAgentRow[] = [
  { agentId: "AGT-903", name: "ux-accessibility-agent", slugId: null },
  { agentId: "AGT-902", name: "data-governance-agent", slugId: null },
  { agentId: "AGT-131", name: "sbom-management-agent", slugId: null },
  { agentId: "AGT-181", name: "architecture-guardrail-agent", slugId: null },
];

function clientWith(
  agents: SpecialistAgentRow[],
  pages: Array<{ slug: string; title: string; abstract: string | null; body: string; metadata: unknown }>,
): SpecialistCraftClient {
  return {
    agent: { findMany: async () => agents },
    wikiPage: { findMany: async () => pages },
  } as unknown as SpecialistCraftClient;
}

const UX_PAGE = {
  slug: "professions/ux-design/error-prevention",
  title: "Error prevention over error messages",
  abstract: "Prefer designs that make the error unreachable.",
  body: "A confirmation dialog is not error prevention. Remove the path that produces the error, or make the destructive action reversible, before adding a warning about it.",
  metadata: {},
};

describe("the specialist consults the craft that claims it", () => {
  it("resolves a family from the role slug, which the agent id alone never matched", async () => {
    const { promptBlocks, contexts } = await resolveSpecialistCraftContexts({
      db: clientWith([SEEDED_AGENTS[0]!], [UX_PAGE]),
      agentIds: ["AGT-903"],
      query: "accessibility of a destructive confirmation dialog",
    });

    expect(contexts[0]?.professionKey).toBe("ux-design");
    expect(contexts[0]?.status).toBe("injected");
    expect(promptBlocks.get("AGT-903")).toContain("Error prevention");
  });

  /**
   * The regression that mattered. Before this change the lane passed the agent
   * id alone, and no family claims the literal string "AGT-903", so every
   * review resolved `missed-unmapped` and silently reviewed without craft.
   */
  it("would miss if the role slug were dropped from the identity tuple", async () => {
    const { contexts } = await resolveSpecialistCraftContexts({
      db: clientWith([{ agentId: "AGT-903", name: null, slugId: null }], [UX_PAGE]),
      agentIds: ["AGT-903"],
      query: "accessibility of a destructive confirmation dialog",
    });

    expect(contexts[0]?.professionKey).toBeNull();
    expect(contexts[0]?.status).toBe("missed-unmapped");
  });

  it("maps each of the four seeded specialists to a distinct craft", async () => {
    const { contexts } = await resolveSpecialistCraftContexts({
      db: clientWith(SEEDED_AGENTS, [UX_PAGE]),
      agentIds: SEEDED_AGENTS.map((a) => a.agentId),
      query: "review the committed diff",
    });

    expect(Object.fromEntries(contexts.map((c) => [c.agentId, c.professionKey]))).toEqual({
      "AGT-903": "ux-design",
      "AGT-902": "security",
      "AGT-131": "release-service-management",
      "AGT-181": "enterprise-architecture",
    });
  });
});

describe("craft is additive context, never a gate", () => {
  it("returns the persona unchanged when the corpus is empty", async () => {
    const { promptBlocks, contexts } = await resolveSpecialistCraftContexts({
      db: clientWith([SEEDED_AGENTS[0]!], []),
      agentIds: ["AGT-903"],
      query: "anything",
    });

    expect(promptBlocks.size).toBe(0);
    expect(contexts[0]?.status).toBe("missed-empty-corpus");
    expect(layerCraftOntoSpecialistPrompt("BASE", promptBlocks.get("AGT-903"))).toBe("BASE");
  });

  it("fails open when the agent read throws", async () => {
    const db = {
      agent: { findMany: async () => { throw new Error("db down"); } },
      wikiPage: { findMany: async () => [] },
    } as unknown as SpecialistCraftClient;

    const { promptBlocks, contexts } = await resolveSpecialistCraftContexts({
      db,
      agentIds: ["AGT-903"],
      query: "anything",
    });

    expect(promptBlocks.size).toBe(0);
    expect(contexts[0]?.status).toBe("error-agent-read");
  });

  it("reports an agent the registry has never heard of, rather than throwing", async () => {
    const { contexts } = await resolveSpecialistCraftContexts({
      db: clientWith([], []),
      agentIds: ["AGT-NOPE"],
      query: "anything",
    });

    expect(contexts[0]?.status).toBe("missed-unknown-agent");
  });

  it("says nothing for a review with no specialist branches", async () => {
    const { contexts } = await resolveSpecialistCraftContexts({
      db: clientWith(SEEDED_AGENTS, [UX_PAGE]),
      agentIds: [],
      query: "anything",
    });
    expect(contexts).toEqual([]);
  });
});

describe("the persona keeps the branch's scope", () => {
  it("orders persona before corpus, so a page cannot widen the branch", () => {
    const layered = layerCraftOntoSpecialistPrompt("Review only accessibility risks.", "CRAFT BLOCK");
    expect(layered.indexOf("Review only accessibility risks.")).toBeLessThan(layered.indexOf("CRAFT BLOCK"));
  });
});

describe("a silent miss stops being invisible", () => {
  it("names the craft, the status and the page count per specialist", () => {
    expect(describeSpecialistCraftContexts([
      { agentId: "AGT-903", professionKey: "ux-design", status: "injected", pages: 3 },
      { agentId: "AGT-902", professionKey: null, status: "missed-unmapped", pages: 0 },
    ])).toBe("AGT-903→ux-design (injected, 3 page(s)); AGT-902→unmapped (missed-unmapped, 0 page(s))");
  });
});
