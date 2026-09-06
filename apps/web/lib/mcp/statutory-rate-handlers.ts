// apps/web/lib/mcp/statutory-rate-handlers.ts — the tools a research coworker
// needs to actually finish the job (BI-8E1FD1BD).
//
// Before this, the Compliance Officer and the Licensing Specialist could both
// research — they hold web_search — and neither could deliver. The grant
// catalog had 157 grants and not one wrote statutory reference data, so a
// researched IRS figure could become a paragraph in a backlog item and nothing
// more. These two tools are the missing delivery path.
//
// The safety split is the whole design: an agent PROPOSES with a citation, a
// person RATIFIES, and only a ratified figure computes money. Ratification is
// deliberately NOT exposed as a tool — it lives on the finance surface where a
// human is signed in. An agent that could confirm its own research would make
// the split decorative.

import { prisma } from "@dpf/db";
import { newId } from "@/lib/shared/new-id";
import {
  checkStatutoryProposal,
  type StatutoryRuleKind,
} from "@/lib/finance/statutory-rules";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/mcp-tools";

const RULE_KINDS: readonly StatutoryRuleKind[] = ["rate", "wage_base", "threshold", "amount"];

/** Mirrors the PayrollTaxKind Prisma enum. A new payroll tax is a migration. */
const PAYROLL_TAX_KINDS = [
  "federal_withholding",
  "social_security",
  "medicare",
  "additional_medicare",
  "futa",
  "state_withholding",
  "suta",
  "local_withholding",
] as const;
type PayrollTaxKindValue = (typeof PAYROLL_TAX_KINDS)[number];

export const STATUTORY_RATE_TOOLS: ToolDefinition[] = [
  {
    name: "list_statutory_rate_gaps",
    description:
      "List the statutory figures this install still cannot compute payroll with, and the authority each belongs to. Read this BEFORE researching so you work the real gaps rather than guessing what is missing. Reports both figures nobody has researched and figures already proposed and waiting on a human.",
    inputSchema: {
      type: "object",
      properties: {
        countryCode: {
          type: "string",
          description: "Optional ISO 3166-1 alpha-2 filter, e.g. US.",
        },
      },
      required: [],
    },
    requiredCapability: null,
    sideEffect: false,
    coworkerArtifact: false,
  },
  {
    name: "propose_statutory_rate",
    description:
      "Record ONE published statutory figure you have read from an authority's own publication, as a PROPOSAL for a human to confirm. It does NOT compute anything and does NOT file anything until a person ratifies it. You MUST supply the authority's own URL and the date you read it — a figure that cannot be checked is refused, not stored. Never infer, average, or carry a figure over from a prior year: if you cannot find it, say so instead of proposing one.",
    inputSchema: {
      type: "object",
      properties: {
        jurisdictionRefId: {
          type: "string",
          description: "Semantic jurisdiction id, e.g. TAX-JUR-US-FEDERAL.",
        },
        taxType: {
          type: "string",
          description: "e.g. social_security | medicare | futa | federal_withholding | suta",
        },
        ruleKind: {
          type: "string",
          description: "rate | wage_base | threshold | amount",
        },
        side: {
          type: "string",
          description:
            "employee_withheld | employer_contribution. Omit for a figure that is not side-specific, such as a deposit threshold.",
        },
        taxYear: { type: "number", description: "Tax year the authority published this under." },
        value: {
          type: "number",
          description:
            "The figure. A rate is a DECIMAL FRACTION (0.062 for 6.2%), never a percentage.",
        },
        currency: { type: "string", description: "ISO 4217, for amounts and wage bases." },
        qualifiers: {
          type: "object",
          description:
            "Bracket bounds, filing status, or any other qualifier the authority publishes alongside the figure.",
        },
        effectiveFrom: { type: "string", description: "ISO 8601 date the figure starts applying." },
        effectiveTo: { type: "string", description: "ISO 8601 date it stops (exclusive), if known." },
        sourceUrl: { type: "string", description: "The authority's OWN publication URL. Required." },
        sourceExcerpt: {
          type: "string",
          description:
            "Quote the sentence or table cell the figure came from, so a reviewer can check your reading without re-fetching a page that may have changed.",
        },
        retrievedAt: { type: "string", description: "ISO 8601 timestamp you read the source. Required." },
        notes: { type: "string", description: "Anything a reviewer should know before confirming." },
      },
      required: [
        "jurisdictionRefId",
        "taxType",
        "ruleKind",
        "taxYear",
        "value",
        "effectiveFrom",
        "sourceUrl",
        "retrievedAt",
      ],
    },
    requiredCapability: null,
    sideEffect: true,
    coworkerArtifact: true,
  },
];

function ok(message: string, entityId?: string): ToolResult {
  return { success: true, message, ...(entityId ? { entityId } : {}) };
}

/** A refusal a coworker can act on: what was wrong, not merely that it failed. */
function refuse(message: string, error: string): ToolResult {
  return { success: false, message, error };
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function listStatutoryRateGapsHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const countryCode = typeof args.countryCode === "string" ? args.countryCode.trim() : "";
  const where = countryCode ? { countryCode: countryCode.toUpperCase() } : {};

  const jurisdictions = await prisma.taxJurisdictionReference.findMany({
    where,
    select: {
      id: true,
      jurisdictionRefId: true,
      authorityName: true,
      countryCode: true,
      lastVerifiedAt: true,
      payrollTaxRules: {
        select: { taxType: true, ruleKind: true, side: true, status: true },
      },
    },
    orderBy: [{ countryCode: "asc" }, { authorityName: "asc" }],
    take: 200,
  });

  if (jurisdictions.length === 0) {
    return ok("No tax jurisdictions are seeded, so there is nothing to research yet.");
  }

  const lines = jurisdictions.map((jurisdiction) => {
    const ratified = jurisdiction.payrollTaxRules.filter((rule) => rule.status === "ratified").length;
    const proposed = jurisdiction.payrollTaxRules.filter((rule) => rule.status === "proposed").length;
    const verified = jurisdiction.lastVerifiedAt
      ? `verified ${jurisdiction.lastVerifiedAt.toISOString().slice(0, 10)}`
      : "NEVER verified against its own site";
    return `- ${jurisdiction.jurisdictionRefId} (${jurisdiction.authorityName}, ${jurisdiction.countryCode}): ${ratified} confirmed, ${proposed} awaiting a human, ${verified}`;
  });

  return ok(
    [
      "Statutory figure coverage. A figure only computes payroll once a PERSON has confirmed it.",
      "",
      ...lines,
      "",
      "Propose each figure you find with propose_statutory_rate, one call per figure, each with the authority's own URL and the date you read it.",
    ].join("\n"),
  );
}

export async function proposeStatutoryRateHandler(
  args: Record<string, unknown>,
  _userId: string,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const jurisdictionRefId = String(args.jurisdictionRefId ?? "").trim();
  const jurisdiction = await prisma.taxJurisdictionReference.findFirst({
    where: { jurisdictionRefId },
    select: { id: true, authorityName: true },
  });
  if (!jurisdiction) {
    return refuse(
      `No jurisdiction "${jurisdictionRefId}" exists. Call list_statutory_rate_gaps to see the real ids rather than guessing one.`,
      "unknown_jurisdiction",
    );
  }

  const ruleKind = String(args.ruleKind ?? "") as StatutoryRuleKind;
  if (!RULE_KINDS.includes(ruleKind)) {
    return refuse(`ruleKind must be one of: ${RULE_KINDS.join(", ")}.`, "invalid_rule_kind");
  }

  // Closed axis: refuse an unknown tax rather than store a typo that would then
  // never resolve against the emitter's own union.
  const taxType = String(args.taxType ?? "").trim() as PayrollTaxKindValue;
  if (!PAYROLL_TAX_KINDS.includes(taxType)) {
    return refuse(
      `taxType must be one of: ${PAYROLL_TAX_KINDS.join(", ")}. If the authority publishes a payroll tax not on that list, say so rather than mapping it onto a near-match.`,
      "invalid_tax_type",
    );
  }

  const effectiveFrom = parseDate(args.effectiveFrom);
  if (!effectiveFrom) return refuse("effectiveFrom must be an ISO 8601 date.", "invalid_effective_from");

  const proposal = {
    jurisdictionRefId: jurisdiction.id,
    taxType,
    ruleKind,
    side: args.side ? String(args.side) : null,
    taxYear: Number(args.taxYear),
    value: Number(args.value),
    currency: args.currency ? String(args.currency) : null,
    effectiveFrom,
    effectiveTo: parseDate(args.effectiveTo),
    sourceUrl: args.sourceUrl ? String(args.sourceUrl) : null,
    sourceExcerpt: args.sourceExcerpt ? String(args.sourceExcerpt) : null,
    retrievedAt: parseDate(args.retrievedAt),
  };

  // The citation check runs BEFORE the write. An uncited figure is refused
  // rather than stored-and-flagged: a row that exists tends to get used.
  const check = checkStatutoryProposal(proposal);
  if (!check.valid) {
    return refuse(check.detail, check.refusal);
  }

  const created = await prisma.payrollTaxRule.create({
    data: {
      payrollTaxRuleId: `PTR-${newId()}`,
      jurisdictionRefId: jurisdiction.id,
      taxType,
      ruleKind: proposal.ruleKind,
      side: proposal.side,
      taxYear: proposal.taxYear,
      value: proposal.value,
      currency: proposal.currency,
      qualifiers: (args.qualifiers as object) ?? {},
      effectiveFrom: proposal.effectiveFrom,
      effectiveTo: proposal.effectiveTo,
      status: "proposed",
      sourceUrl: proposal.sourceUrl,
      sourceExcerpt: proposal.sourceExcerpt,
      retrievedAt: proposal.retrievedAt,
      proposedByAgentId: context?.agentId ?? null,
      notes: args.notes ? String(args.notes) : null,
    },
    select: { payrollTaxRuleId: true },
  });

  return ok(
    [
      `Recorded ${created.payrollTaxRuleId} as a PROPOSAL for ${jurisdiction.authorityName}.`,
      "",
      "It does not compute anything yet. A person must confirm it against your cited source first —",
      "that is deliberate, and you cannot confirm it yourself.",
    ].join("\n"),
    created.payrollTaxRuleId,
  );
}
