import type { SurfaceDefinition, SurfaceJson, SurfaceNodeDefinition } from "@dpf/types";
import type { PlatformFundingSetupView } from "@/lib/portfolio/platform-funding-setup";
import type { ActionResult } from "@/lib/shared/action-result";
import type { SurfaceLoaderResult } from "../authorized-surface-runtime";

export const PLATFORM_FUNDING_SETUP_ID = "portfolio.platform-funding-setup";
export const PLATFORM_FUNDING_SETUP_LOADER_ID = "platform-funding-setup.view-model";
const root = "platform-funding-setup";
const readyNode = "platform-funding-setup-available";
const field = (nodeId: string, accessibleName: string, fieldType: "select" | "text" | "checkbox"): SurfaceNodeDefinition => ({
  nodeId, accessibleName, fieldType, kind: "field", parentId: root, valuePolicy: "read", sensitivity: "confidential",
  when: { nodeId: readyNode, equals: true },
});
const control = (nodeId: string, accessibleName: string): SurfaceNodeDefinition => ({
  nodeId, accessibleName, kind: "action", parentId: root, valuePolicy: "read", sensitivity: "confidential",
});
export const PLATFORM_FUNDING_SETUP_SURFACE: SurfaceDefinition = {
  contractVersion: "1.0", surfaceId: PLATFORM_FUNDING_SETUP_ID, label: "Platform ownership",
  purpose: "Review and explicitly confirm initial platform policy and funding ownership without changing allocation history or ratifying a policy version.",
  supportedModes: ["browser", "headless", "workroom", "scheduled", "background", "external", "mobile"],
  entryPoints: [{ kind: "route", pattern: "/ops/demand" }], loaderId: PLATFORM_FUNDING_SETUP_LOADER_ID,
  nodes: [
    { nodeId: root, kind: "surface", accessibleName: "Platform ownership", valuePolicy: "none", sensitivity: "confidential" },
    control("platform-funding-setup-toggle", "Confirm platform ownership"),
    control("platform-funding-setup-reload", "Reload ownership record"),
    field("platform-funding-organization", "Organization", "select"),
    field("platform-funding-reason", "Reason for recording ownership", "text"),
    field("platform-funding-attestation", "I am authorized to record this platform policy and funding owner.", "checkbox"),
    { ...control("platform-funding-confirm", "Confirm platform owner"), when: { nodeId: readyNode, equals: true } },
    { ...control("platform-funding-record-toggle", "Review the exact ownership record"), when: { nodeId: "platform-funding-has-record", equals: true } },
    { ...control("platform-funding-more-organizations", "More organizations"), when: { nodeId: "platform-funding-has-more", equals: true } },
    { nodeId: "platform-funding-setup-record", kind: "record", accessibleName: "Current ownership and prospective allocations", parentId: root, valuePolicy: "read", sensitivity: "confidential", rendered: false },
    { nodeId: readyNode, kind: "record", accessibleName: "Initial ownership confirmation available", parentId: root, valuePolicy: "read", sensitivity: "confidential", rendered: false },
    { nodeId: "platform-funding-has-record", kind: "record", accessibleName: "Ownership record loaded", parentId: root, valuePolicy: "read", sensitivity: "confidential", rendered: false },
    { nodeId: "platform-funding-has-more", kind: "record", accessibleName: "More eligible organizations available", parentId: root, valuePolicy: "read", sensitivity: "confidential", rendered: false },
  ],
  actions: [
    ...[
      ["platform-funding-setup-toggle", "Show or hide ownership setup"],
      ["platform-funding-record-toggle", "Show or hide the exact ownership record"],
      ["platform-funding-organization", "Choose an organization"],
      ["platform-funding-reason", "Enter the ownership reason"],
      ["platform-funding-attestation", "Set the explicit ownership attestation"],
    ].map(([nodeId, label]) => ({ actionId: nodeId!, label: label!, actionClass: "ui-local" as const,
      localEffect: { kind: "set-value" as const, targetNodeId: nodeId! }, risk: "low" as const, confirmation: "none" as const })),
    { actionId: "platform-funding-confirm", label: "Confirm platform owner", actionClass: "domain", tool: "confirm_platform_funding_owner",
      // A completed ownership receipt remains valid only while current state
      // matches; every retry must reach authorization and the governed writer.
      risk: "high", confirmation: "required", idempotent: false,
      description: "An agent still needs the selected person's actual human approval through the existing governed tool. A virtual attestation is not human approval.",
      argMap: { organizationId: "platform-funding-organization", reason: "platform-funding-reason", attestation: "platform-funding-attestation" },
      inputSchema: { type: "object", additionalProperties: false, properties: { expectedDigest: { type: "string", pattern: "^[a-f0-9]{64}$" } }, required: ["expectedDigest"] },
    },
  ],
};

export function fundingSetupCanConfirm(result: ActionResult<PlatformFundingSetupView>): boolean {
  return result.ok && result.data.status === "available" && !!result.data.installationId && !!result.data.person
    && !!result.data.profile && result.data.profile.ownerPrincipalId === null && result.data.profile.ownerOrganizationId === null
    && result.data.organizations.length > 0;
}

export function projectPlatformFundingSetupSurface(result: ActionResult<PlatformFundingSetupView>): SurfaceLoaderResult {
  const view = result.ok ? result.data : null;
  const ready = fundingSetupCanConfirm(result);
  return {
    // Bind the complete source DTO, including validity, policy revision, current
    // ownership and every per-organization digest. Virtual drafts bind separately
    // through the existing session runtime; they never replace source evidence.
    revisionSeed: JSON.stringify(result),
    summary: { label: "Platform ownership", purpose: PLATFORM_FUNDING_SETUP_SURFACE.purpose,
      status: view?.status ?? "unavailable", highlights: [
        "Confirmation records both the platform policy owner and funding owner on this installation.",
        "Existing allocations, spending history and policy ratification are unchanged; funding bindings are separate.",
      ] },
    values: {
      "platform-funding-setup-record": JSON.parse(JSON.stringify(result)) as SurfaceJson,
      [readyNode]: ready,
      "platform-funding-has-record": result.ok, "platform-funding-has-more": !!view?.nextCursor,
      "platform-funding-setup-toggle": false, "platform-funding-record-toggle": false,
      "platform-funding-organization": "", "platform-funding-reason": "", "platform-funding-attestation": false,
      "platform-funding-more-organizations": view?.nextCursor ?? null,
    },
    states: {
      "platform-funding-organization": { choices: view?.organizations.map(({ id }) => id) ?? [], labels: view?.organizations.map(({ name }) => name) ?? [], disabled: !ready },
      "platform-funding-reason": { required: true, maxLength: 2000, disabled: !ready },
      "platform-funding-attestation": { required: true, disabled: !ready },
      "platform-funding-confirm": { disabled: !ready },
      "platform-funding-more-organizations": { disabled: !view?.nextCursor },
    },
    help: {
      [root]: "Read state belongs only to the authenticated person. Initial setup cannot replace existing or conflicting ownership.",
      "platform-funding-setup-record": "Use the chosen organization's exact expectedDigest from this current bounded read. Actor and ownership facts are resolved by the server.",
      "platform-funding-setup-reload": "Refresh with surface_snapshot or read_platform_funding_setup; neither confirms ownership.",
      "platform-funding-more-organizations": "Use read_platform_funding_setup with afterOrganizationId equal to this node's cursor for the next bounded page. No ownership action is implied.",
      "platform-funding-confirm": "Set organization, reason and attestation through their UI-local actions. Supply only that organization's expectedDigest here. The governed writer rechecks current state and actual human authority.",
    },
  };
}
