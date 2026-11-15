// Data-governance registration for the MCP transport's operational models
// (BI-D8101329). The live-schema coverage gate (coverage.live.test.ts) requires
// every Prisma model to be registered or baselined; registering the model here
// resolves its fields at the model-level default (coverage.ts). Kept in its own
// module so the core assets registry stays under the module-size ceiling.

import type { DataAssetDefinition } from "./asset-types";

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-08-07",
} as const;

export const MCP_ASSETS: readonly DataAssetDefinition[] = [
  {
    // Per-token deferred-tool-loading session: which extra MCP tool names a
    // token pulled into scope via load_tools, plus its short TTL. Operational
    // discovery state, no PII — the token id scopes the session, not a person,
    // so there is no data subject to locate or mask.
    id: "data:mcp-tool-session",
    physical: { prismaModel: "McpToolSession" },
    domain: "platform-operations",
    ownerRole: "platform-operator",
    stewardRole: "data-steward",
    categories: ["configuration"],
    sensitivity: "internal",
    criticality: "low",
    subjectLocators: [],
    lifecycleClass: "ephemeral",
    purposeCapabilities: ["platform-operations"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: CLASSIFICATION,
    fields: [],
  },
  {
    // BI-ED52AB82: a connected MCP client's subscription to one Work Room
    // resource. Keyed by the auth context (OAuth refresh family or credential),
    // the room URI and the room's work item; it holds no message content and
    // lapses a day after the client last subscribed or listened.
    id: "data:mcp-resource-subscription",
    physical: { prismaModel: "McpResourceSubscription" },
    domain: "platform-operations",
    ownerRole: "platform-operator",
    stewardRole: "data-steward",
    categories: ["configuration"],
    sensitivity: "internal",
    criticality: "low",
    subjectLocators: [],
    lifecycleClass: "ephemeral",
    purposeCapabilities: ["platform-operations"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: { ...CLASSIFICATION, effectiveFrom: "2026-11-12" },
    fields: [],
  },
];
