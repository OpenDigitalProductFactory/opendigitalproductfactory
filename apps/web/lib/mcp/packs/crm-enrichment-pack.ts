// Proactive CRM enrichment tool pack (BI-B2497DFB).
//
// Two governed doors on top of the deterministic core in lib/crm/enrichment:
//   - propose_crm_enrichment: after the human confirms scope, the coworker
//     hands the facts it researched (via its granted web tools) to this tool,
//     which drops fabrications, computes the scant→enriched diff, and FILES the
//     proposal to the steward queue — nothing is written to the record yet.
//   - apply_crm_enrichment: writes an approved proposal to the record WITH
//     provenance and records the diff — the consequential write, gated by
//     crm_write through governedExecuteTool.
//
// The split keeps the platform invariant: research/propose is non-destructive;
// the record change is a separate, approved, governed step.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  ENRICHMENT_SOURCE_KINDS,
  enrichableFieldsFor,
  type EnrichableField,
  type EnrichmentAnchor,
  type EnrichmentFinding,
  type EnrichmentRecordKind,
  type EnrichmentScope,
  type EnrichmentSourceKind,
} from "@/lib/crm/enrichment/types";

const definitions: ToolDefinition[] = [
  {
    name: "propose_crm_enrichment",
    description:
      "File a proactive enrichment proposal for a thin customer account or contact. Call this AFTER the human has agreed to enrichment and confirmed scope (which sources, which fields). Pass the identity you resolved as `anchor` (the company's domain — the strongest key — plus name/location) and the facts you researched as `findings` (each with its source + citation). The tool first CONFIRMS the researched company is the same entity as the record: if the record's own domain conflicts with your researched domain it REFUSES (a same-named different company); a weak match is filed but flagged for you to double-check. It then drops anything masked/partial/placeholder (never fabricates), computes the before→after diff, cites every field, and files the proposal to the data-steward queue. Nothing is written to the record here — apply it with apply_crm_enrichment after the human reviews the diff. Unverifiable fields are returned as gaps to confirm.",
    inputSchema: {
      type: "object",
      properties: {
        recordKind: {
          type: "string",
          enum: ["customer-account", "customer-contact"],
          description: "Which record is being enriched. Defaults to customer-account.",
        },
        recordId: { type: "string", description: "CustomerAccount.id or CustomerContact.id." },
        anchor: {
          type: "object",
          description: "The identity you resolved for the researched company — used to confirm it matches the record before harvesting. Domain is the strongest key.",
          properties: {
            domain: { type: "string", description: "The company's own domain, e.g. acme.com (no scheme/path)." },
            name: { type: "string" },
            location: { type: "string" },
          },
        },
        scope: {
          type: "object",
          description: "The human-confirmed scope: which public sources and which fields you may touch.",
          properties: {
            sources: {
              type: "array",
              items: { type: "string", enum: ["website", "linkedin", "web-search"] },
            },
            fields: { type: "array", items: { type: "string" } },
          },
          required: ["sources", "fields"],
        },
        findings: {
          type: "array",
          description: "Researched facts to propose. Each: field, value, source (website|linkedin|web-search), sourceRef (URL/citation), optional confidence 0..1, optional retrievedAt (ISO date), optional supportingPassage (the text the value was read from).",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              value: { type: "string" },
              source: { type: "string", enum: ["website", "linkedin", "web-search"] },
              sourceRef: { type: "string" },
              confidence: { type: "number" },
              retrievedAt: { type: "string" },
              supportingPassage: { type: "string" },
            },
            required: ["field", "value", "source", "sourceRef"],
          },
        },
      },
      required: ["recordId", "scope", "findings"],
    },
    requiredCapability: "operate_customer",
    sideEffect: true,
  },
  {
    name: "apply_crm_enrichment",
    description:
      "Apply an enrichment proposal filed by propose_crm_enrichment: write the accepted fields to the customer record WITH provenance, record the before→after diff on the account timeline, and resolve the steward task. This is the consequential write — call it only after the human has reviewed the proposed diff. Pass the steward task id (STEW-…) returned by propose_crm_enrichment.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The enrichment steward task id (STEW-…) to apply." },
      },
      required: ["taskId"],
    },
    requiredCapability: "operate_customer",
    sideEffect: true,
  },
];

function parseScope(raw: unknown, recordKind: EnrichmentRecordKind): EnrichmentScope | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const validSources = new Set<string>(ENRICHMENT_SOURCE_KINDS);
  const validFields = new Set<string>(enrichableFieldsFor(recordKind));
  const sources = Array.isArray(obj["sources"])
    ? (obj["sources"].filter((s) => typeof s === "string" && validSources.has(s)) as EnrichmentSourceKind[])
    : [];
  const fields = Array.isArray(obj["fields"])
    ? (obj["fields"].filter((f) => typeof f === "string" && validFields.has(f)) as EnrichableField[])
    : [];
  if (sources.length === 0 || fields.length === 0) return null;
  return { sources, fields };
}

function parseFindings(raw: unknown): EnrichmentFinding[] {
  if (!Array.isArray(raw)) return [];
  const validSources = new Set<string>(ENRICHMENT_SOURCE_KINDS);
  const out: EnrichmentFinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const field = typeof o["field"] === "string" ? o["field"] : "";
    const value = typeof o["value"] === "string" ? o["value"] : "";
    const source = typeof o["source"] === "string" ? o["source"] : "";
    const sourceRef = typeof o["sourceRef"] === "string" ? o["sourceRef"] : "";
    if (!field || !value || !validSources.has(source) || !sourceRef) continue;
    out.push({
      field: field as EnrichableField,
      value,
      source: source as EnrichmentSourceKind,
      sourceRef,
      ...(typeof o["confidence"] === "number" ? { confidence: o["confidence"] } : {}),
      ...(typeof o["retrievedAt"] === "string" ? { retrievedAt: o["retrievedAt"] } : {}),
      ...(typeof o["supportingPassage"] === "string" ? { supportingPassage: o["supportingPassage"] } : {}),
    });
  }
  return out;
}

function parseAnchor(raw: unknown): EnrichmentAnchor | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" && o[k].trim().length > 0 ? o[k].trim() : null);
  const anchor: EnrichmentAnchor = { domain: str("domain"), name: str("name"), location: str("location") };
  return anchor.domain || anchor.name || anchor.location ? anchor : null;
}

const proposeCrmEnrichmentTool: ToolPackHandler = async (params, _userId, context) => {
  const recordKind: EnrichmentRecordKind =
    params["recordKind"] === "customer-contact" ? "customer-contact" : "customer-account";
  const recordId = typeof params["recordId"] === "string" ? params["recordId"].trim() : "";
  if (!recordId) {
    return { success: false, error: "missing_fields", message: "recordId is required." };
  }
  const scope = parseScope(params["scope"], recordKind);
  if (!scope) {
    return {
      success: false,
      error: "missing_scope",
      message: "scope.sources and scope.fields are required (the human-confirmed enrichment scope). Confirm scope before researching.",
    };
  }
  const findings = parseFindings(params["findings"]);
  const anchor = parseAnchor(params["anchor"]);

  const { loadRecordForEnrichment, fileEnrichmentProposal } = await import("@/lib/crm/enrichment/enrichment-service");
  const { buildEnrichmentProposal } = await import("@/lib/crm/enrichment/enrichment-proposal");
  const { resolveProactivityPlan } = await import("@/lib/proactivity/proactivity-resolver");

  const record = await loadRecordForEnrichment(recordKind, recordId);
  if (!record) {
    return { success: false, error: "record_not_found", message: `No ${recordKind} ${recordId}.` };
  }

  const proposal = buildEnrichmentProposal({
    recordKind,
    recordId,
    current: record.current,
    findings,
    scope,
    anchor,
  });

  // Identity-resolution gate (BI-E2449835): a domain conflict means the research
  // is about a different, similarly-named company — refuse and file nothing.
  if (proposal.blocked) {
    return {
      success: false,
      error: "identity_conflict",
      message: `Not filed for "${record.label}" — ${proposal.blocked.reason}`,
      data: { blocked: proposal.blocked, identity: proposal.identity },
    };
  }

  const plan = resolveProactivityPlan({
    activityFamily: "crm-record-enrichment",
    agentId: context?.agentId ?? null,
    routeContext: context?.routeContext ?? null,
  });

  try {
    const taskId = await fileEnrichmentProposal(proposal, {
      proactivity: { level: plan.resolvedLevel, policyId: plan.policyId },
    });
    const diff = proposal.changes.map((c) => `${c.field}: ${c.current ?? "∅"} → "${c.proposed}" (${c.source})`).join("; ");
    const gaps = proposal.unresolvedGaps.map((g) => g.field).join(", ");
    const identityWarning =
      proposal.identity.verdict === "weak"
        ? ` ⚠ Identity only weakly confirmed (match ${Math.round(proposal.identity.score * 100)}%, agreed on: ${proposal.identity.agreements.join("+") || "none"}) — double-check this is the right company before applying.`
        : "";
    if (!taskId) {
      return {
        success: true,
        message: `Nothing to propose for "${record.label}" — no new verifiable values.${gaps ? ` Still unverified: ${gaps}.` : ""}`,
        data: { proposal, taskId: null },
      };
    }
    return {
      success: true,
      message:
        `Filed enrichment proposal ${taskId} for "${record.label}": ${proposal.changes.length} change(s)` +
        `${diff ? ` [${diff}]` : ""}` +
        `${proposal.rejected.length ? `; dropped ${proposal.rejected.length} unverifiable/masked value(s)` : ""}` +
        `${gaps ? `; confirm-what's-needed: ${gaps}` : ""}. ` +
        `Review the diff, then apply with apply_crm_enrichment taskId "${taskId}" — nothing written yet.` +
        identityWarning,
      data: { proposal, taskId },
    };
  } catch (err) {
    return { success: false, error: "propose_failed", message: `propose_crm_enrichment failed: ${getErrorMessage(err)}` };
  }
};

const applyCrmEnrichmentTool: ToolPackHandler = async (params, userId) => {
  const taskId = typeof params["taskId"] === "string" ? params["taskId"].trim() : "";
  if (!taskId) {
    return { success: false, error: "missing_fields", message: "taskId is required (STEW-… from propose_crm_enrichment)." };
  }
  const { applyEnrichmentProposal } = await import("@/lib/crm/enrichment/enrichment-service");
  const result = await applyEnrichmentProposal(taskId, { resolvedBy: userId || null });
  if (!result.ok) {
    return { success: false, error: "apply_failed", message: result.message };
  }
  const applied = result.result.applied
    .map((a) => `${a.field}="${a.value}" (${a.source}: ${a.sourceRef})`)
    .join("; ");
  return {
    success: true,
    message: `Applied enrichment ${taskId} to ${result.result.recordKind} ${result.result.recordId}: ${applied}. Provenance recorded; diff on the account timeline.`,
    data: result.result,
  };
};

export const crmEnrichmentPack: ToolPack = {
  packId: "crm-enrichment",
  definitions,
  handlers: {
    propose_crm_enrichment: proposeCrmEnrichmentTool,
    apply_crm_enrichment: applyCrmEnrichmentTool,
  },
  grants: {
    // Mirrors agent-grants.ts TOOL_TO_GRANTS (the gating source): proposing is
    // web-research stewardship inside the CRM-read envelope; applying is the
    // consequential CRM write.
    propose_crm_enrichment: ["web_search", "crm_read"],
    apply_crm_enrichment: ["crm_write"],
  },
};
