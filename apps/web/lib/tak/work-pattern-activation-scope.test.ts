import { describe, expect, it } from "vitest";

import {
  deriveMaximumActivationScope,
  type WorkPatternCorroborationEvidence,
} from "./work-pattern-activation-scope";

const SOURCE = {
  installScope: "dpf_dogfood" as const,
  organizationId: "org-dogfood",
  taskCorpusKey: "dpf-repository",
  modelProfileId: "frontier-coding",
};

function corroboration(
  overrides: Partial<WorkPatternCorroborationEvidence> = {},
): WorkPatternCorroborationEvidence {
  return {
    taskRunId: "TR-customer-1",
    installScope: "customer_overlay",
    organizationId: "org-customer-1",
    taskCorpusKey: "customer-brownfield",
    modelProfileId: "frontier-coding",
    terminal: true,
    effective: true,
    fresh: true,
    egressApproved: true,
    materiallyDifferentCorpus: true,
    ...overrides,
  };
}

describe("deriveMaximumActivationScope", () => {
  it("caps dogfood-only evidence to the same install, corpus, and model", () => {
    expect(deriveMaximumActivationScope({
      source: SOURCE,
      portableCanonicalCorpus: null,
      corroborations: [],
    })).toEqual({
      installScopes: ["dpf_dogfood"],
      organizationIds: ["org-dogfood"],
      taskCorpusKeys: ["dpf-repository"],
      modelProfileIds: ["frontier-coding"],
      corroborationTaskRunIds: [],
      ceiling: "same-install",
      blockers: ["broader_scope_requires_portable_corpus_or_customer_corroboration"],
    });
  });

  it("widens only the portable canonical corpus dimension", () => {
    const scope = deriveMaximumActivationScope({
      source: SOURCE,
      portableCanonicalCorpus: {
        taskCorpusKey: "canonical-build-replay",
        verified: true,
      },
      corroborations: [],
    });
    expect(scope.installScopes).toEqual(["canonical", "dpf_dogfood"]);
    expect(scope.taskCorpusKeys).toEqual(["canonical-build-replay", "dpf-repository"]);
    expect(scope.organizationIds).toEqual(["org-dogfood"]);
    expect(scope.modelProfileIds).toEqual(["frontier-coding"]);
    expect(scope.ceiling).toBe("canonical-corpus");
  });

  it("adds only valid non-dogfood corroboration", () => {
    const scope = deriveMaximumActivationScope({
      source: SOURCE,
      portableCanonicalCorpus: null,
      corroborations: [
        corroboration(),
        corroboration({ taskRunId: "TR-stale", fresh: false }),
        corroboration({ taskRunId: "TR-dangling", effective: false }),
      ],
    });
    expect(scope.installScopes).toEqual(["customer_overlay", "dpf_dogfood"]);
    expect(scope.organizationIds).toEqual(["org-customer-1", "org-dogfood"]);
    expect(scope.taskCorpusKeys).toEqual(["customer-brownfield", "dpf-repository"]);
    expect(scope.corroborationTaskRunIds).toEqual(["TR-customer-1"]);
    expect(scope.ceiling).toBe("corroborated");
  });

  it("does not turn frontier evidence into local-model authority", () => {
    const scope = deriveMaximumActivationScope({
      source: SOURCE,
      portableCanonicalCorpus: null,
      corroborations: [
        corroboration({
          taskRunId: "TR-local-model",
          modelProfileId: "local-9b",
        }),
      ],
    });
    expect(scope.modelProfileIds).toEqual(["frontier-coding"]);
    expect(scope.corroborationTaskRunIds).toEqual([]);
  });
});
