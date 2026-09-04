// The aggregator — fan out the source adapters, order by the tiered triage rule,
// scope by audience. Read-only and idempotent; never mutates a source row.
// A failing source degrades to `failedSources` — never a blank inbox (spec §6.3).
// Spec: docs/superpowers/specs/2026-06-23-human-attention-surface-design.md §4.1, §6.2.

import type { prisma } from "@dpf/db";
import type { AttentionItem, AttentionSource } from "./types";
import { orderAttention } from "./triage";
import { loadEscalationItems } from "./sources/escalation";
import { loadAiDecisionItems } from "./sources/ai-decision";
import { loadPausedAiItems } from "./sources/paused-ai";
import { loadScheduledTaskItems } from "./sources/scheduled-task";
import { loadAgentProposalItems } from "./sources/agent-proposal";
import { loadSkillProposalItems } from "./sources/skill-proposal";
import { loadCoworkerEnvelopeItems } from "./sources/coworker-envelope";
import { loadPlatformHealthItems } from "./sources/platform-health";
import {
  loadCoworkerMemoryItems,
  type CoworkerMemoryAttentionDb,
} from "./sources/coworker-memory";
import { loadProviderCredentialItems, loadProviderSuitabilityDriftItems } from "./sources/provider-credential";
import { loadComplianceSourceFreshnessItems } from "./sources/compliance-source-freshness";
import { loadReservationExceptionItems } from "./sources/reservation-exception";
import { loadHospitalityCapacityAttentionItems } from "./sources/hospitality-capacity";
import { loadStorefrontInquiryItems } from "./sources/storefront-inquiry";
import { loadBusinessJourneyItems } from "./sources/business-journey";
import {
  loadOutboundItems,
  loadBillItems,
  loadExpenseItems,
  loadRegulatoryItems,
  loadResearchItems,
} from "./sources/business-approvals";
import { getAiReadinessSummary } from "@/lib/ai-readiness/readiness-summary";
import { projectAiReadinessAttentionItems } from "@/lib/ai-readiness/attention";

type Db = typeof prisma;

export type AttentionSourceLoader = {
  source: AttentionSource;
  load: () => Promise<AttentionItem[]>;
};

export type AttentionResult = {
  /** Ordered by the tiered triage rule (override → time → risk → blast → age). */
  items: AttentionItem[];
  /** Sources whose adapter threw — surfaced as a "couldn't load <source>" note. */
  failedSources: AttentionSource[];
};

/** Fan out the source loaders in parallel, collect, and order. Deps-injected so
 *  the fan-out + resilience is unit-testable without a live database. */
export async function aggregateAttention(loaders: AttentionSourceLoader[]): Promise<AttentionResult> {
  const settled = await Promise.all(
    loaders.map(async (l) => {
      try {
        return { source: l.source, items: await l.load() };
      } catch {
        return { source: l.source, items: null };
      }
    }),
  );

  const items: AttentionItem[] = [];
  const failedSources: AttentionSource[] = [];
  for (const r of settled) {
    if (r.items === null) failedSources.push(r.source);
    else items.push(...r.items);
  }
  return { items: orderAttention(items), failedSources };
}

export type AttentionAudienceQuery = { operator: boolean; principalId?: string };

/** Audience scoping (pure). Operators see the full residue; a worker sees only
 *  the items assigned to their principal. Spec §6.2. */
export function filterAttentionForAudience(
  items: AttentionItem[],
  q: AttentionAudienceQuery,
): AttentionItem[] {
  if (q.operator) return items.filter((i) => i.audience.operator);
  return items.filter(
    (i) => q.principalId != null && i.audience.assigneePrincipalId === q.principalId,
  );
}

/** Options every caller resolves from the authenticated session. Both ids are
 *  the READING user: attention is projected for one person at a time. */
export type AttentionLoadOptions = {
  aiReadinessUserId?: string;
  /** The reader's user id, used to scope CoworkerActionEnvelope proposals to
   *  their delegating user. Omitted → the envelope source is not registered at
   *  all, so an unidentified reader can never see another user's envelope
   *  (BI-7CB2CCDE). */
  delegatingUserId?: string;
};

/** The real source loaders for a reading user. Exported so the wiring — which
 *  sources exist, and which are user-scoped — is testable without a database. */
export function attentionSourceLoaders(
  db: Db,
  opts: AttentionLoadOptions = {},
): AttentionSourceLoader[] {
  const loaders: AttentionSourceLoader[] = [
    { source: "escalation", load: () => loadEscalationItems() },
    { source: "ai-decision", load: () => loadAiDecisionItems(db) },
    { source: "paused-ai", load: () => loadPausedAiItems(db) },
    { source: "scheduled-task", load: () => loadScheduledTaskItems(db) },
    { source: "agent-proposal", load: () => loadAgentProposalItems(db) },
    { source: "skill-proposal", load: () => loadSkillProposalItems(db) },
    { source: "approval-outbound", load: () => loadOutboundItems(db) },
    { source: "approval-bill", load: () => loadBillItems(db) },
    { source: "approval-expense", load: () => loadExpenseItems(db) },
    { source: "compliance-submission", load: () => loadRegulatoryItems(db) },
    { source: "research-proposal", load: () => loadResearchItems(db) },
    { source: "coworker-memory", load: () => loadCoworkerMemoryItems(db as unknown as CoworkerMemoryAttentionDb) },
    { source: "platform-health", load: () => loadPlatformHealthItems(db) },
    { source: "business-journey", load: () => loadBusinessJourneyItems(db) },
    { source: "reservation-exception", load: () => loadReservationExceptionItems(db) },
    {
      source: "hospitality-capacity",
      load: () => loadHospitalityCapacityAttentionItems(db),
    },
    { source: "storefront-inquiry", load: () => loadStorefrontInquiryItems(db) },
    {
      // Pure registry arithmetic — no query, so it costs nothing per load.
      source: "compliance-source-freshness",
      load: async () => loadComplianceSourceFreshnessItems(),
    },
    {
      source: "provider-credential",
      load: async () => [
        ...(await loadProviderCredentialItems()),
        ...(await loadProviderSuitabilityDriftItems(db)),
      ],
    },
  ];
  if (opts.aiReadinessUserId) {
    loaders.push({
      source: "ai-readiness-blocker",
      load: async () =>
        projectAiReadinessAttentionItems(
          await getAiReadinessSummary(opts.aiReadinessUserId),
        ),
    });
  }
  if (opts.delegatingUserId) {
    loaders.push({
      source: "coworker-envelope",
      load: () => loadCoworkerEnvelopeItems(db, opts.delegatingUserId),
    });
  }
  return loaders;
}

/** Production entry point — wires the real source loaders over the db client. */
export async function loadAttentionItems(
  db: Db,
  opts: AttentionLoadOptions = {},
): Promise<AttentionResult> {
  return aggregateAttention(attentionSourceLoaders(db, opts));
}
