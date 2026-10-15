// BI-54469E18 — data-governance registration for AgentToolchainObservation
// (design 2026-10-07-agent-toolchain-release-delivery §5.2b). Kept beside
// assets.ts, like the other domain families, so the registry stays within
// its module-size ceiling.
import type { DataAssetDefinition } from "./asset-types";

export const AGENT_TOOLCHAIN_OBSERVATION_ASSETS: readonly DataAssetDefinition[] = [
  {
    // BI-54469E18: connection-observed agent toolchain copies, one row per
    // credential and loaded digest. Operational drift telemetry, no subject or
    // business data. telemetry-bounded (30d); safe to prune.
    id: "data:agent-toolchain-observation",
    physical: { prismaModel: "AgentToolchainObservation" },
    domain: "agent-toolchain",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["telemetry", "system-internal"],
    sensitivity: "internal",
    criticality: "low",
    subjectLocators: [],
    lifecycleClass: "telemetry-bounded",
    purposeCapabilities: ["platform-operations"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-10-08" },
    fields: [
      {
        id: "data:agent-toolchain-observation#credentialRef",
        physicalName: "credentialRef",
        resolution: "not-applicable",
        resolutionReason:
          "Server-derived credential identity (oauth:<OAuthClient.id> or token:<McpApiToken.id>) — an operational key, not a data subject.",
        categories: ["system-internal"],
        sensitivity: "internal",
        provenance: { source: "manual", state: "confirmed", assertedBy: "data-steward", effectiveFrom: "2026-10-08" },
      },
      {
        id: "data:agent-toolchain-observation#loadedDigest",
        physicalName: "loadedDigest",
        resolution: "not-applicable",
        resolutionReason:
          "First 16 hex of the declared delivered-content digest of the loaded dpf-platform pack, or 'undeclared'.",
        categories: ["system-internal"],
        sensitivity: "internal",
        provenance: { source: "manual", state: "confirmed", assertedBy: "data-steward", effectiveFrom: "2026-10-08" },
      },
      {
        id: "data:agent-toolchain-observation#clientKind",
        physicalName: "clientKind",
        resolution: "not-applicable",
        resolutionReason:
          "Which DPF-managed client kind the connection declared (claude-code, codex, grok, antigravity) — an operational classification.",
        categories: ["system-internal"],
        sensitivity: "internal",
        provenance: { source: "manual", state: "confirmed", assertedBy: "data-steward", effectiveFrom: "2026-10-08" },
      },
      {
        id: "data:agent-toolchain-observation#probableClient",
        physicalName: "probableClient",
        resolution: "not-applicable",
        resolutionReason:
          "User-Agent product token, kept for display only and never used for enforcement.",
        categories: ["system-internal"],
        sensitivity: "internal",
        provenance: { source: "manual", state: "confirmed", assertedBy: "data-steward", effectiveFrom: "2026-10-08" },
      },
      {
        id: "data:agent-toolchain-observation#loadedPackVersion",
        physicalName: "loadedPackVersion",
        resolution: "not-applicable",
        resolutionReason:
          "The pack version the connection declared it loaded.",
        categories: ["system-internal"],
        sensitivity: "internal",
        provenance: { source: "manual", state: "confirmed", assertedBy: "data-steward", effectiveFrom: "2026-10-08" },
      },
      {
        id: "data:agent-toolchain-observation#authMode",
        physicalName: "authMode",
        resolution: "not-applicable",
        resolutionReason:
          "How the connection authenticated (oauth, bearer, session) — operational status only.",
        categories: ["system-internal"],
        sensitivity: "internal",
        provenance: { source: "manual", state: "confirmed", assertedBy: "data-steward", effectiveFrom: "2026-10-08" },
      },
      {
        id: "data:agent-toolchain-observation#clientInfoName",
        physicalName: "clientInfoName",
        resolution: "not-applicable",
        resolutionReason:
          "MCP initialize clientInfo.name reported by the client application.",
        categories: ["system-internal"],
        sensitivity: "internal",
        provenance: { source: "manual", state: "confirmed", assertedBy: "data-steward", effectiveFrom: "2026-10-08" },
      },
      {
        id: "data:agent-toolchain-observation#clientInfoVersion",
        physicalName: "clientInfoVersion",
        resolution: "not-applicable",
        resolutionReason:
          "MCP initialize clientInfo.version reported by the client application.",
        categories: ["system-internal"],
        sensitivity: "internal",
        provenance: { source: "manual", state: "confirmed", assertedBy: "data-steward", effectiveFrom: "2026-10-08" },
      },
    ],
  },
];
