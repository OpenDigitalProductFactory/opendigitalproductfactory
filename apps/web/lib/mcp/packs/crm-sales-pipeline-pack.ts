// CRM sales-pipeline pack — customer accounts, opportunities, and quotes.
//
// The Customer workspace's qualify-and-quote loop: list/create customer
// accounts, review and open sales opportunities against them, and draft quotes
// against those opportunities. Reads come straight from the CRM tables (merge
// tombstones excluded by default); writes delegate to the CRM actions layer,
// which owns duplicate detection and quote math. Contact-level tools live in
// the separate crm-contacts pack.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";
import { prisma } from "@dpf/db";
import {
  CUSTOMER_ACCOUNT_STATUSES,
  CUSTOMER_TOMBSTONE_STATUSES,
  EXCLUDE_TOMBSTONED,
} from "@dpf/db/customer-lifecycle";
import { getErrorMessage } from "@/lib/shared/get-error-message";

// The full canonical account-lifecycle set an operator may set, minus the two system-managed
// tombstones (`superseded` = merge tombstone; `archived` = its own action). Surfaced here so
// create_customer_account exposes the whole lifecycle (BI-9078F4EE), not a hard-coded 4 —
// derived from the canonical union, no new enum invented.
const SETTABLE_ACCOUNT_STATUSES: string[] = CUSTOMER_ACCOUNT_STATUSES.filter(
  (status) => !(CUSTOMER_TOMBSTONE_STATUSES as readonly string[]).includes(status),
);

const definitions: ToolDefinition[] = [
  {
    name: "list_customer_accounts",
    description: "List customer accounts in the CRM (name, status, industry, and open-opportunity count). Use this on the Customer workspace to see who the accounts/prospects are before qualifying opportunities or drafting a quote.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional status filter, e.g. prospect, active, at_risk, closed." },
        limit: { type: "number", description: "Max rows (default 25, max 100)." },
      },
      required: [],
    },
    requiredCapability: "view_customer",
    sideEffect: false,
  },
  {
    name: "list_opportunities",
    description: "List sales-pipeline opportunities (title, stage, probability, expected value, account). Use this to review the pipeline and find the strongest candidates to qualify. Stages: qualification, discovery, proposal, negotiation, closed_won, closed_lost.",
    inputSchema: {
      type: "object",
      properties: {
        stage: { type: "string", description: "Optional stage filter." },
        accountId: { type: "string", description: "Filter to one account (CustomerAccount.id)." },
        includeDormant: { type: "boolean", description: "Include dormant opportunities (default false)." },
        limit: { type: "number", description: "Max rows (default 25, max 100)." },
      },
      required: [],
    },
    requiredCapability: "view_customer",
    sideEffect: false,
  },
  {
    name: "get_opportunity",
    description: "Get one opportunity with its account, contact, and existing quotes. Use this to confirm an opportunity's details and its id before drafting a quote against it.",
    inputSchema: {
      type: "object",
      properties: {
        opportunityId: { type: "string", description: "Opportunity.id or the OPP-… opportunityId." },
      },
      required: ["opportunityId"],
    },
    requiredCapability: "view_customer",
    sideEffect: false,
  },
  {
    name: "list_quotes",
    description: "List quotes (number, status, total, account, opportunity). Use this to see existing quotes before drafting a new one. Quote statuses: draft, sent, accepted, rejected, expired, superseded.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional status filter, e.g. draft, sent, accepted." },
        opportunityId: { type: "string", description: "Filter to one opportunity (Opportunity.id)." },
        limit: { type: "number", description: "Max rows (default 25, max 100)." },
      },
      required: [],
    },
    requiredCapability: "view_customer",
    sideEffect: false,
  },
  {
    name: "create_customer_account",
    description: "Create a customer account (a company or prospect) in the CRM. ONLY `name` is required — do not ask the user for website/industry/notes; include them only when already known. The tool checks for duplicates before creating (normalized + fuzzy name, web domain): when likely matches exist it returns error `duplicates_found` with scored candidates instead of creating. Then either reuse the existing account (its id is in the candidates — just use it as accountId downstream, or pass duplicateResolution `use-existing:<id>`), or — only when the user confirms it is genuinely a different company — retry with duplicateResolution `confirm-new` plus a short duplicateReason. Never create a second account for a company that already exists under a slightly different spelling. Creates an internal record only; nothing is sent to the customer.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Company / account name. The ONLY required field." },
        website: { type: "string", description: "Optional website URL — include when known; it strengthens duplicate detection." },
        industry: { type: "string", description: "Optional industry." },
        status: { type: "string", enum: SETTABLE_ACCOUNT_STATUSES, description: "Optional account-lifecycle status (default prospect). Full lifecycle: prospect → qualified → onboarding → active, plus at_risk / suspended / closed. Tombstones (superseded/archived) are system-managed and not settable here." },
        notes: { type: "string", description: "Optional free-text notes." },
        duplicateResolution: { type: "string", description: "Optional duplicate decision after a duplicates_found response: `use-existing:<accountId>` to reuse that account, or `confirm-new` to create anyway once the user confirms it is a different company." },
        duplicateReason: { type: "string", description: "Required with duplicateResolution `confirm-new`: one line on why this is not a duplicate (audited)." },
      },
      required: ["name"],
    },
    requiredCapability: "operate_customer",
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "create_opportunity",
    description: "Create (propose) a sales-pipeline opportunity against an existing account. Use this to turn a qualified lead into a tracked opportunity. Defaults to the 'qualification' stage. Creates an internal record for human review; nothing is sent externally.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short opportunity title." },
        accountId: { type: "string", description: "CustomerAccount.id this opportunity belongs to (from list_customer_accounts)." },
        stage: { type: "string", description: "qualification (default) | discovery | proposal | negotiation." },
        expectedValue: { type: "number", description: "Estimated deal value." },
        currency: { type: "string", description: "ISO currency code, default USD." },
        expectedClose: { type: "string", description: "ISO date the deal is expected to close." },
        notes: { type: "string", description: "Optional qualification notes." },
      },
      required: ["title", "accountId"],
    },
    requiredCapability: "operate_customer",
    sideEffect: true,
    coworkerArtifact: true,
  },
  {
    name: "create_quote",
    description: "Draft a quote against an existing opportunity with one or more line items. Line totals, subtotal, discount, tax, and grand total are computed automatically and the quote is saved in 'draft' status — it is NOT sent to the customer. Get the opportunity id from list_opportunities / get_opportunity first.",
    inputSchema: {
      type: "object",
      properties: {
        opportunityId: { type: "string", description: "Opportunity.id the quote is for (from list_opportunities)." },
        validUntil: { type: "string", description: "ISO date the quote is valid until, e.g. 2026-07-31." },
        lineItems: {
          type: "array",
          description: "One or more quote line items.",
          items: {
            type: "object",
            properties: {
              description: { type: "string", description: "Line description." },
              quantity: { type: "number", description: "Quantity (default 1)." },
              unitPrice: { type: "number", description: "Unit price." },
              discountPercent: { type: "number", description: "Optional per-line discount %." },
              taxPercent: { type: "number", description: "Optional per-line tax %." },
              catalogItemId: {
                type: "string",
                description: "Preferred exact CatalogItem.id for the sellable configuration.",
              },
              catalogSkuId: {
                type: "string",
                description: "Optional exact reusable CatalogSku.id selected for this quote line.",
              },
              configurationSnapshot: {
                type: "object",
                description: "Optional immutable one-off configuration captured on this quote line. Reusable standard configurations should use a published SKU instead.",
                additionalProperties: true,
              },
              productId: {
                type: "string",
                description: "Legacy optional DigitalProduct id retained during catalog migration.",
              },
            },
            required: ["description", "quantity", "unitPrice"],
          },
        },
        currency: { type: "string", description: "ISO currency code, default USD." },
        discountType: { type: "string", description: "percentage (default) | fixed — header-level discount." },
        discountValue: { type: "number", description: "Header discount amount (percent or fixed per discountType)." },
        terms: { type: "string", description: "Optional terms text." },
        notes: { type: "string", description: "Optional notes." },
      },
      required: ["opportunityId", "validUntil", "lineItems"],
    },
    requiredCapability: "operate_customer",
    sideEffect: true,
    coworkerArtifact: true,
  },
];

async function listCustomerAccountsTool(params: Record<string, unknown>): Promise<ToolResult> {
  const status = typeof params["status"] === "string" ? params["status"].trim() : undefined;
  const take = typeof params["limit"] === "number" ? Math.min(Math.max(1, params["limit"]), 100) : 25;
  const accounts = await prisma.customerAccount.findMany({
    // Default reads exclude merge tombstones (superseded rows).
    where: status ? { status } : EXCLUDE_TOMBSTONED,
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true, accountId: true, name: true, status: true, industry: true,
      _count: { select: { opportunities: true, quotes: true } },
    },
  });
  if (accounts.length === 0) {
    return { success: true, message: "No customer accounts yet. Use create_customer_account to add the first one.", data: { accounts: [] } };
  }
  const lines = accounts.map((a) =>
    `${a.name} (${a.accountId}) — ${a.status}${a.industry ? `, ${a.industry}` : ""} · ${a._count.opportunities} opp / ${a._count.quotes} quote`);
  return { success: true, message: `${accounts.length} account(s):\n${lines.join("\n")}`, data: { accounts } };
}

async function listOpportunitiesTool(params: Record<string, unknown>): Promise<ToolResult> {
  const stage = typeof params["stage"] === "string" ? params["stage"].trim() : undefined;
  const accountId = typeof params["accountId"] === "string" ? params["accountId"].trim() : undefined;
  const includeDormant = params["includeDormant"] === true;
  const take = typeof params["limit"] === "number" ? Math.min(Math.max(1, params["limit"]), 100) : 25;
  const opportunities = await prisma.opportunity.findMany({
    where: {
      ...(stage ? { stage } : {}),
      ...(accountId ? { accountId } : {}),
      ...(includeDormant ? {} : { isDormant: false }),
    },
    orderBy: { stageChangedAt: "desc" },
    take,
    select: {
      id: true, opportunityId: true, title: true, stage: true, probability: true,
      expectedValue: true, currency: true, expectedClose: true,
      account: { select: { name: true } },
    },
  });
  if (opportunities.length === 0) {
    return { success: true, message: "No opportunities in the pipeline yet. Use create_opportunity to add one against an account.", data: { opportunities: [] } };
  }
  const lines = opportunities.map((o) =>
    `${o.title} (${o.opportunityId}) — ${o.stage} ${o.probability}% · ${o.account.name}${o.expectedValue != null ? ` · ${o.currency} ${Number(o.expectedValue).toLocaleString()}` : ""}`);
  return { success: true, message: `${opportunities.length} opportunit${opportunities.length === 1 ? "y" : "ies"}:\n${lines.join("\n")}`, data: { opportunities } };
}

async function getOpportunityTool(params: Record<string, unknown>): Promise<ToolResult> {
  const idRaw = typeof params["opportunityId"] === "string" ? params["opportunityId"].trim() : "";
  if (!idRaw) return { success: false, error: "missing_opportunityId", message: "opportunityId is required." };
  const opp = await prisma.opportunity.findFirst({
    where: { OR: [{ id: idRaw }, { opportunityId: idRaw }] },
    include: {
      account: { select: { id: true, accountId: true, name: true } },
      quotes: { select: { quoteNumber: true, status: true, totalAmount: true, currency: true } },
    },
  });
  if (!opp) return { success: false, error: "not_found", message: `Opportunity ${idRaw} not found.` };
  const quoteLine = opp.quotes.length
    ? `\nQuotes: ${opp.quotes.map((q) => `${q.quoteNumber} (${q.status}, ${q.currency} ${Number(q.totalAmount).toLocaleString()})`).join("; ")}`
    : "\nQuotes: none yet";
  return {
    success: true,
    message: `${opp.title} (${opp.opportunityId}) — ${opp.stage} ${opp.probability}% · account ${opp.account.name} (id ${opp.account.id})${opp.expectedValue != null ? ` · ${opp.currency} ${Number(opp.expectedValue).toLocaleString()}` : ""}${quoteLine}`,
    data: { opportunity: opp },
  };
}

async function listQuotesTool(params: Record<string, unknown>): Promise<ToolResult> {
  const status = typeof params["status"] === "string" ? params["status"].trim() : undefined;
  const opportunityId = typeof params["opportunityId"] === "string" ? params["opportunityId"].trim() : undefined;
  const take = typeof params["limit"] === "number" ? Math.min(Math.max(1, params["limit"]), 100) : 25;
  const quotes = await prisma.quote.findMany({
    where: { ...(status ? { status } : {}), ...(opportunityId ? { opportunityId } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      quoteId: true, quoteNumber: true, status: true, totalAmount: true, currency: true, version: true,
      account: { select: { name: true } },
      opportunity: { select: { title: true } },
    },
  });
  if (quotes.length === 0) {
    return { success: true, message: "No quotes yet. Use create_quote to draft one against an opportunity.", data: { quotes: [] } };
  }
  const lines = quotes.map((q) =>
    `${q.quoteNumber} v${q.version} — ${q.status} · ${q.currency} ${Number(q.totalAmount).toLocaleString()} · ${q.account.name} / ${q.opportunity.title}`);
  return { success: true, message: `${quotes.length} quote(s):\n${lines.join("\n")}`, data: { quotes } };
}

/**
 * Proactive enrichment offer on thin account intake (BI-B2497DFB, AC1). Pure +
 * proactivity-bound: silent at quiet, offers at balanced/assertive. Never
 * throws — an offer is a nicety, not part of the create contract.
 */
async function buildCreatedAccountEnrichmentOffer(
  account: { id: string; name: string },
  params: Record<string, unknown>,
  context?: { agentId?: string | null; routeContext?: string | null },
) {
  try {
    const { buildEnrichmentOfferForIntake } = await import("@/lib/crm/enrichment/enrichment-offer");
    const { resolveProactivityPlan } = await import("@/lib/proactivity/proactivity-resolver");
    const plan = resolveProactivityPlan({
      activityFamily: "crm-record-enrichment",
      agentId: context?.agentId ?? null,
      routeContext: context?.routeContext ?? null,
    });
    return buildEnrichmentOfferForIntake({
      recordKind: "customer-account",
      recordId: account.id,
      recordLabel: account.name,
      intake: {
        name: account.name,
        website: params["website"],
        industry: params["industry"],
        notes: params["notes"],
      },
      plan,
    });
  } catch {
    return null;
  }
}

async function createCustomerAccountTool(
  params: Record<string, unknown>,
  _userId?: string,
  context?: { agentId?: string | null; routeContext?: string | null },
): Promise<ToolResult> {
  const name = typeof params["name"] === "string" ? params["name"].trim() : "";
  if (!name) return { success: false, error: "missing_name", message: "name is required to create a customer account." };
  const requestedStatus = typeof params["status"] === "string" ? params["status"].trim() : "";
  if (requestedStatus && !SETTABLE_ACCOUNT_STATUSES.includes(requestedStatus)) {
    return {
      success: false,
      error: "invalid_status",
      message: `"${requestedStatus}" is not a settable account status. Choose one of: ${SETTABLE_ACCOUNT_STATUSES.join(", ")}.`,
    };
  }
  const { createCustomerAccount } = await import("@/lib/actions/crm");
  const rawResolution = typeof params["duplicateResolution"] === "string" ? params["duplicateResolution"].trim() : "";
  const duplicateReason = typeof params["duplicateReason"] === "string" ? params["duplicateReason"].trim() : "";
  let dedup: import("@/lib/mdm/dedup-gate").DedupResolution | undefined;
  if (rawResolution.startsWith("use-existing:")) {
    dedup = { kind: "use-existing", existingId: rawResolution.slice("use-existing:".length).trim() };
  } else if (rawResolution === "confirm-new") {
    if (!duplicateReason) {
      return { success: false, error: "missing_duplicate_reason", message: "duplicateReason is required with duplicateResolution 'confirm-new' — state in one line why this is a different company." };
    }
    dedup = { kind: "confirm-new", reason: duplicateReason };
  }
  try {
    const result = await createCustomerAccount({
      name,
      website: typeof params["website"] === "string" ? params["website"] : undefined,
      industry: typeof params["industry"] === "string" ? params["industry"] : undefined,
      status: typeof params["status"] === "string" ? params["status"] : undefined,
      notes: typeof params["notes"] === "string" ? params["notes"] : undefined,
    }, dedup);
    if (result.outcome === "duplicates-found") {
      const candidates = result.check.candidates.slice(0, 5).map((c) => ({
        accountId: c.id,
        name: c.label,
        status: c.detail,
        score: c.score,
        matchedOn: c.reasons.map((r) => r.attribute).join("+"),
      }));
      return {
        success: false,
        error: "duplicates_found",
        message: `Not created — ${candidates.length} existing account(s) look like "${name}": ${candidates.map((c) => `${c.name} (${c.accountId}, score ${c.score}, ${c.matchedOn})`).join("; ")}. If one of these is the same company, use its accountId directly (or pass duplicateResolution "use-existing:<accountId>"). Only pass duplicateResolution "confirm-new" + duplicateReason if the user confirms it is a different company.`,
        data: { candidates },
      };
    }
    const account = result.account;
    if (result.outcome === "existing") {
      return { success: true, message: `Reused existing customer account "${account.name}" (${account.accountId}) instead of creating a duplicate. Use its id ${account.id} as accountId downstream.`, data: { accountId: account.id, accountRef: account.accountId, reusedExisting: true } };
    }
    const enrichmentOffer = await buildCreatedAccountEnrichmentOffer(account, params, context);
    const offerMsg = enrichmentOffer ? ` ${enrichmentOffer.message}` : "";
    return { success: true, message: `Created customer account "${account.name}" (${account.accountId}). Use its id ${account.id} as accountId when creating an opportunity.${offerMsg}`, data: { accountId: account.id, accountRef: account.accountId, ...(enrichmentOffer ? { enrichmentOffer } : {}) } };
  } catch (err) {
    const msg = getErrorMessage(err);
    return { success: false, error: "create_failed", message: `create_customer_account failed: ${msg}` };
  }
}

async function createOpportunityTool(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const title = typeof params["title"] === "string" ? params["title"].trim() : "";
  const accountId = typeof params["accountId"] === "string" ? params["accountId"].trim() : "";
  if (!title || !accountId) {
    return { success: false, error: "missing_fields", message: "title and accountId are required. Use list_customer_accounts to find the accountId." };
  }
  const { createOpportunity } = await import("@/lib/actions/crm");
  try {
    const opp = await createOpportunity({
      title,
      accountId,
      stage: typeof params["stage"] === "string" ? params["stage"] : undefined,
      expectedValue: typeof params["expectedValue"] === "number" ? params["expectedValue"] : undefined,
      currency: typeof params["currency"] === "string" ? params["currency"] : undefined,
      expectedClose: typeof params["expectedClose"] === "string" ? params["expectedClose"] : undefined,
      notes: typeof params["notes"] === "string" ? params["notes"] : undefined,
      userId,
    });
    return { success: true, message: `Created opportunity "${opp.title}" (${opp.opportunityId}) in ${opp.stage} for ${opp.account.name}. Use its id ${opp.id} as opportunityId when drafting a quote.`, data: { opportunityId: opp.id, opportunityRef: opp.opportunityId } };
  } catch (err) {
    const msg = getErrorMessage(err);
    return { success: false, error: "create_failed", message: `create_opportunity failed: ${msg}` };
  }
}

async function createQuoteTool(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const opportunityId = typeof params["opportunityId"] === "string" ? params["opportunityId"].trim() : "";
  const validUntil = typeof params["validUntil"] === "string" ? params["validUntil"].trim() : "";
  const rawLines = Array.isArray(params["lineItems"]) ? params["lineItems"] : [];
  if (!opportunityId || !validUntil || rawLines.length === 0) {
    return { success: false, error: "missing_fields", message: "opportunityId, validUntil, and at least one lineItem are required." };
  }
  const lineItems = rawLines.map((li) => {
    const o = (li ?? {}) as Record<string, unknown>;
    return {
      description: typeof o["description"] === "string" ? o["description"] : "",
      quantity: typeof o["quantity"] === "number" ? o["quantity"] : 1,
      unitPrice: typeof o["unitPrice"] === "number" ? o["unitPrice"] : 0,
      discountPercent: typeof o["discountPercent"] === "number" ? o["discountPercent"] : undefined,
      taxPercent: typeof o["taxPercent"] === "number" ? o["taxPercent"] : undefined,
      catalogItemId: typeof o["catalogItemId"] === "string" ? o["catalogItemId"] : undefined,
      catalogSkuId: typeof o["catalogSkuId"] === "string" ? o["catalogSkuId"] : undefined,
      configurationSnapshot:
        o["configurationSnapshot"] !== null &&
        typeof o["configurationSnapshot"] === "object" &&
        !Array.isArray(o["configurationSnapshot"])
          ? o["configurationSnapshot"] as import("@dpf/db").Prisma.InputJsonObject
          : undefined,
      productId: typeof o["productId"] === "string" ? o["productId"] : undefined,
    };
  });
  if (lineItems.some((l) => !l.description)) {
    return { success: false, error: "invalid_line", message: "every lineItem needs a description." };
  }
  const { createQuote } = await import("@/lib/actions/crm");
  try {
    const quote = await createQuote({
      opportunityId,
      validUntil,
      lineItems,
      discountType: typeof params["discountType"] === "string" ? params["discountType"] : undefined,
      discountValue: typeof params["discountValue"] === "number" ? params["discountValue"] : undefined,
      currency: typeof params["currency"] === "string" ? params["currency"] : undefined,
      terms: typeof params["terms"] === "string" ? params["terms"] : undefined,
      notes: typeof params["notes"] === "string" ? params["notes"] : undefined,
      userId,
    });
    return { success: true, message: `Drafted quote ${quote.quoteNumber} — ${quote.currency} ${Number(quote.totalAmount).toLocaleString()} (status ${quote.status}). It is a draft and has not been sent to the customer.`, data: { quoteId: quote.quoteId, quoteNumber: quote.quoteNumber, totalAmount: Number(quote.totalAmount) } };
  } catch (err) {
    const msg = getErrorMessage(err);
    return { success: false, error: "create_failed", message: `create_quote failed: ${msg}` };
  }
}

export const crmSalesPipelinePack: ToolPack = {
  packId: "crm-sales-pipeline",
  definitions,
  handlers: {
    list_customer_accounts: listCustomerAccountsTool,
    list_opportunities: listOpportunitiesTool,
    get_opportunity: getOpportunityTool,
    list_quotes: listQuotesTool,
    create_customer_account: createCustomerAccountTool,
    create_opportunity: createOpportunityTool,
    create_quote: createQuoteTool,
  },
  grants: {
    list_customer_accounts: ["crm_read"],
    list_opportunities: ["crm_read"],
    get_opportunity: ["crm_read"],
    list_quotes: ["crm_read"],
    create_customer_account: ["crm_write"],
    create_opportunity: ["crm_write"],
    create_quote: ["crm_write"],
  },
};
