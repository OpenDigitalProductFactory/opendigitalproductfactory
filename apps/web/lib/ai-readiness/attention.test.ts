import { describe, expect, it } from "vitest";

import { projectAiReadinessAttentionItems } from "./attention";
import type { AiReadinessSummary } from "./readiness-summary";

const baseSummary: AiReadinessSummary = {
  state: "blocked",
  summary: "AI readiness is blocked by 1 domain.",
  generatedAt: "2026-06-29T00:00:00.000Z",
  domains: [
    {
      id: "model-supply",
      label: "Model Supply",
      state: "blocked",
      summary: "No AI model providers are configured.",
      evidence: [],
      blocker: {
        code: "no-model-providers",
        message: "DPF cannot route model work until at least one provider is connected.",
        primaryActionLabel: "Connect provider",
        href: "/platform/ai/providers",
      },
      diagnosticsHref: "/platform/ai/providers",
    },
    {
      id: "routing-confidence",
      label: "Routing Confidence",
      state: "attention",
      summary: "New model scores are being refreshed.",
      evidence: [],
      diagnosticsHref: "/platform/ai/runtime-health",
    },
  ],
};

describe("projectAiReadinessAttentionItems", () => {
  it("projects blocked readiness domains into one operator attention item each", () => {
    const items = projectAiReadinessAttentionItems(
      baseSummary,
      "2026-06-29T12:00:00.000Z",
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "ai-readiness-blocker:model-supply:no-model-providers",
      source: "ai-readiness-blocker",
      title: "AI readiness blocked: Model Supply",
      context: "No AI model providers are configured.",
      deepLink: "/platform/ai/readiness#model-supply",
      riskClass: "bounded-write",
      triage: {
        timeToAct: "none",
        residueReason: "needs-credential",
        decideEffort: "one-tap",
        irreversible: false,
      },
      actions: [
        {
          kind: "open-in-context",
          label: "Connect provider",
          href: "/platform/ai/providers",
        },
      ],
      audience: { operator: true },
    });
  });

  it("does not project non-blocking readiness attention into the inbox", () => {
    const items = projectAiReadinessAttentionItems({
      ...baseSummary,
      state: "attention",
      domains: baseSummary.domains.map((domain) => ({
        ...domain,
        state: domain.id === "model-supply" ? "ready" : domain.state,
        blocker: undefined,
      })),
    });

    expect(items).toEqual([]);
  });
});
