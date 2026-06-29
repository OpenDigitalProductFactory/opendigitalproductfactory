import type { AttentionItem } from "@/lib/attention/types";

import type { AiReadinessSummary } from "./readiness-summary";

function attentionId(domainId: string, blockerCode: string): string {
  return `ai-readiness-blocker:${domainId}:${blockerCode}`;
}

export function projectAiReadinessAttentionItems(
  summary: AiReadinessSummary,
  nowIso = new Date().toISOString(),
): AttentionItem[] {
  return summary.domains
    .filter((domain) => domain.state === "blocked" && domain.blocker)
    .map((domain) => {
      const blocker = domain.blocker!;
      return {
        id: attentionId(domain.id, blocker.code),
        source: "ai-readiness-blocker",
        title: `AI readiness blocked: ${domain.label}`,
        context: domain.summary,
        decisionClass: { scorability: "unscorable" },
        riskClass: "bounded-write",
        triage: {
          timeToAct: "none",
          residueReason: "needs-credential",
          blastRadius: blocker.message,
          decideEffort: "one-tap",
          irreversible: false,
        },
        createdAtIso: nowIso,
        actions: [
          {
            kind: "open-in-context",
            label: blocker.primaryActionLabel,
            href: blocker.href ?? domain.diagnosticsHref,
          },
        ],
        deepLink: `/platform/ai/readiness#${domain.id}`,
        audience: { operator: true },
      } satisfies AttentionItem;
    });
}
