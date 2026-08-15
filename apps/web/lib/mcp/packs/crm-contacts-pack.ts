// CRM contacts pack (BI-D873CD28, EP-B51FA3BC). Gives the Customer Success
// Manager a structured-contact door: before this, CustomerContact was a full
// model but unreachable — no tool existed, so the coworker parked real people
// ("Ian Pruden — email to be added") in free-text account notes.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "create_customer_contact",
    description:
      "Add a person as a structured contact on an existing customer account (from list_customer_accounts). " +
      "Email is required and is the contact's unique identity — if a contact with that email already exists, " +
      "it is returned instead of duplicated. Near-duplicates (same name/phone) are surfaced for a decision. " +
      "Use this instead of stashing contact details in account notes.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string", description: "CustomerAccount.id the contact belongs to." },
        firstName: { type: "string", description: "First name." },
        lastName: { type: "string", description: "Last name (optional)." },
        email: { type: "string", description: "Email — the contact's unique identity key." },
        phone: { type: "string", description: "Optional phone number." },
        jobTitle: { type: "string", description: "Optional job title." },
        confirmNew: {
          type: "boolean",
          description:
            "Set true ONLY after the employee confirms a flagged near-duplicate really is a different person.",
        },
      },
      required: ["accountId", "firstName", "email"],
    },
    requiredCapability: "operate_customer",
    sideEffect: true,
    coworkerArtifact: true,
  },
];

/** Proactive enrichment offer on thin contact intake (BI-B2497DFB, AC1). */
async function buildCreatedContactEnrichmentOffer(
  contact: { id: string; name: string | null; email: string },
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
      recordKind: "customer-contact",
      recordId: contact.id,
      recordLabel: contact.name ?? contact.email,
      intake: {
        firstName: params["firstName"],
        lastName: params["lastName"],
        jobTitle: params["jobTitle"],
        phone: params["phone"],
      },
      plan,
    });
  } catch {
    return null;
  }
}

async function createCustomerContactTool(
  params: Record<string, unknown>,
  _userId?: string,
  context?: { agentId?: string | null; routeContext?: string | null },
): Promise<ToolResult> {
  const { createCustomerContact } = await import("@/lib/actions/customer-contacts");
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const accountId = str("accountId");
  const firstName = str("firstName");
  const email = str("email");
  if (!accountId || !firstName || !email) {
    return { success: false, error: "accountId, firstName, and email are required.", message: "accountId, firstName, and email are required." };
  }

  const result = await createCustomerContact(
    {
      accountId,
      firstName,
      lastName: str("lastName"),
      email,
      phone: str("phone"),
      jobTitle: str("jobTitle"),
    },
    params["confirmNew"] === true
      ? { kind: "confirm-new", reason: "employee confirmed different person via coworker" }
      : undefined,
  );

  if (result.outcome === "duplicates-found") {
    return {
      success: false,
      message:
        "Possible duplicate contact(s) found — ask the employee whether one of these is the same person: " +
        result.check.candidates.map((c) => `${c.label}${c.detail ? ` (${c.detail})` : ""}`).join("; ") +
        ". If they confirm it's a different person, call again with confirmNew=true.",
      data: { candidates: result.check.candidates } as unknown as Record<string, unknown>,
    };
  }

  const c = result.contact;
  const enrichmentOffer =
    result.outcome === "existing" ? null : await buildCreatedContactEnrichmentOffer(c, params, context);
  const offerMsg = enrichmentOffer ? ` ${enrichmentOffer.message}` : "";
  return {
    success: true,
    message:
      result.outcome === "existing"
        ? `Contact already exists: ${c.name ?? c.email} (${c.email}).`
        : `Created contact ${c.name ?? c.email} (${c.email}).${offerMsg}`,
    data: {
      id: c.id,
      email: c.email,
      name: c.name,
      outcome: result.outcome,
      ...(enrichmentOffer ? { enrichmentOffer } : {}),
    },
  };
}

export const crmContactsPack: ToolPack = {
  packId: "crm-contacts",
  definitions,
  handlers: {
    create_customer_contact: createCustomerContactTool,
  },
  grants: {
    create_customer_contact: ["crm_write"],
  },
};
