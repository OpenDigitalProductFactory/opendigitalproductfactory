import { describe, it, expect, vi } from "vitest";

import {
  groundPromptWithProfessionCorpus,
  type ProfessionGroundingDeps,
} from "./profession-grounding";
import type { ProfessionCorpusContext } from "@/lib/decision-perspective/profession-corpus";

const INJECTED: ProfessionCorpusContext = {
  status: "injected",
  professionKey: "operations",
  familyLabel: "Operations",
  profileId: "wsid-operations",
  pages: [{ slug: "professions/operations/wiki/x", title: "X", abstract: "a", excerpt: "e", score: 3 }],
  promptBlock: "## Profession corpus — Operations\n- X: e",
  compactBlock: "Operations: X",
  tokenCount: 12,
  compactTokenCount: 4,
  lowRelevance: false,
  missingTopic: "warehouse receiving",
  suggestedSource: null,
};

const MISS: ProfessionCorpusContext = {
  status: "missed-empty-corpus",
  professionKey: "operations",
  familyLabel: "Operations",
  profileId: "wsid-operations",
  pages: [],
  promptBlock: "",
  compactBlock: "",
  tokenCount: 0,
  compactTokenCount: 0,
  lowRelevance: false,
  missingTopic: "warehouse receiving",
  suggestedSource: "gs1/logistics",
};

function deps(over: Partial<ProfessionGroundingDeps> = {}): ProfessionGroundingDeps {
  return {
    loadIdentity: vi.fn(async (agentId) => ({ agentId, slugId: "ops", name: "Ops" })),
    resolveInstallContext: vi.fn(async () => ({})),
    resolveCorpus: vi.fn(async () => INJECTED),
    recordEvidence: vi.fn(async () => {}),
    ...over,
  };
}

describe("groundPromptWithProfessionCorpus", () => {
  it("appends the corpus promptBlock to the system prompt on a hit", async () => {
    const d = deps();
    const r = await groundPromptWithProfessionCorpus(
      { systemPrompt: "BASE", agentId: "build-qa-engineer", query: "how do I verify a receipt?", routeContext: "build" },
      d,
    );
    expect(r.grounded).toBe(true);
    expect(r.systemPrompt).toBe(`BASE\n\n${INJECTED.promptBlock}`);
  });

  it("records evidence with promptInjected=true on a hit", async () => {
    const d = deps();
    await groundPromptWithProfessionCorpus(
      { systemPrompt: "BASE", agentId: "a", query: "q q", routeContext: "build" },
      d,
    );
    // fire-and-forget — allow the microtask to run
    await Promise.resolve();
    expect(d.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "a", promptInjected: true, context: INJECTED }),
    );
  });

  it("still records evidence on a MISS (feeds the growth loop) but does not change the prompt", async () => {
    const d = deps({ resolveCorpus: vi.fn(async () => MISS) });
    const r = await groundPromptWithProfessionCorpus(
      { systemPrompt: "BASE", agentId: "a", query: "obscure thing", routeContext: "build" },
      d,
    );
    expect(r.grounded).toBe(false);
    expect(r.systemPrompt).toBe("BASE");
    await Promise.resolve();
    expect(d.recordEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ promptInjected: false, context: MISS }),
    );
  });

  it("is fail-open: a resolver throw returns the original prompt unchanged", async () => {
    const d = deps({
      resolveCorpus: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const r = await groundPromptWithProfessionCorpus(
      { systemPrompt: "BASE", agentId: "a", query: "q q", routeContext: "build" },
      d,
    );
    expect(r.grounded).toBe(false);
    expect(r.systemPrompt).toBe("BASE");
  });

  it("no-ops on an empty query without calling the resolver", async () => {
    const d = deps();
    const r = await groundPromptWithProfessionCorpus(
      { systemPrompt: "BASE", agentId: "a", query: "   ", routeContext: "build" },
      d,
    );
    expect(r.grounded).toBe(false);
    expect(r.systemPrompt).toBe("BASE");
    expect(d.resolveCorpus).not.toHaveBeenCalled();
  });
});
