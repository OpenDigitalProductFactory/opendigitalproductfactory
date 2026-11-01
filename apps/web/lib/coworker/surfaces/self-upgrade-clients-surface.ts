import type { SurfaceDefinition } from "@dpf/types";
import { connectedClientsPromptFacts, type ConnectedClientsView } from "@/lib/agent-toolchain/connected-clients";
import type { SurfaceLoaderResult } from "../authorized-surface-runtime";

export const SELF_UPGRADE_CLIENTS_LOADER_ID = "self-upgrade.connected-clients";
export const SELF_UPGRADE_CLIENTS_SURFACE: SurfaceDefinition = {
  contractVersion: "1.0",
  surfaceId: "operations.connected-agent-clients",
  label: "Connected agent clients",
  purpose: "Explain the connected-client section of Updates & health. This section supplies no verdict about LLM availability, upgrade execution or background-job health.",
  supportedModes: ["browser", "headless", "workroom", "scheduled", "background", "external", "mobile"],
  entryPoints: [{ kind: "route", pattern: "/ops/self-upgrade" }],
  loaderId: SELF_UPGRADE_CLIENTS_LOADER_ID,
  nodes: [
    { nodeId: "surface", kind: "surface", accessibleName: "Connected agent clients", valuePolicy: "none", sensitivity: "internal" },
    { nodeId: "clients.health", parentId: "surface", kind: "record", accessibleName: "Authorized connected-client health", valuePolicy: "read", sensitivity: "internal", rendered: false },
  ],
  actions: [],
};

export function projectSelfUpgradeClientsSurface(view: ConnectedClientsView | null): SurfaceLoaderResult {
  const facts = connectedClientsPromptFacts(view);
  return {
    revisionSeed: JSON.stringify(facts),
    summary: {
      label: "Connected agent clients",
      purpose: SELF_UPGRADE_CLIENTS_SURFACE.purpose,
      status: facts.status,
      highlights: [
        "For client details, open Connected agent clients on /ops/self-upgrade. This read does not update or repair clients.",
        ...(facts.status === "unavailable" ? ["Connected-client health is unavailable; do not infer client status from upgrade or background-job health."] : []),
      ],
    },
    values: { "clients.health": JSON.stringify(facts) },
  };
}
