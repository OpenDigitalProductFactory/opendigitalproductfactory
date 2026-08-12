// SavedConnectionsPanel — saved DiscoveryConnection rows with management UX.
//
// Renders the empty-state "Add Connection" hero when no connections exist,
// or a list of SavedConnectionRow widgets when there are. Either way the
// Add CTA is always reachable so operators can stack multiple connections
// (e.g. UniFi + a second SNMP target).
//
// Server component on purpose: row interactivity lives in SavedConnectionRow
// (client) but the data fetch + permission check stay server-side.

import { listDiscoveryConnections, type DiscoveryConnectionSummary } from "@/lib/actions/discovery";
import { AddDiscoveryConnection } from "./AddDiscoveryConnection";
import { SavedConnectionRow } from "./SavedConnectionRow";
import type { GatewayCandidate } from "@/lib/discovery-connection/gateway-candidate";

type Props = {
  detectedGateway: string | null;
  /** Shared page/surface read model; omitted only by legacy callers. */
  connections?: DiscoveryConnectionSummary[];
  gatewayCandidates?: GatewayCandidate[];
};

export async function SavedConnectionsPanel({
  detectedGateway,
  gatewayCandidates = [],
  connections: projectedConnections,
}: Props) {
  const result = projectedConnections
    ? { ok: true as const, connections: projectedConnections }
    : await listDiscoveryConnections();

  // Auth failure — fall back to the first-run hero so the page still renders.
  // The CTA itself is gated by the same permission server-side, so the
  // operator just gets the same "Unauthorized" if they try to save.
  if (!result.ok) {
    return <AddDiscoveryConnection detectedGateway={detectedGateway} gatewayCandidates={gatewayCandidates} />;
  }

  const { connections } = result;

  if (connections.length === 0) {
    return <AddDiscoveryConnection detectedGateway={detectedGateway} gatewayCandidates={gatewayCandidates} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
          Discovery Connections
        </p>
        <p className="text-[11px] text-[var(--dpf-muted)]">
          {connections.length} configured
        </p>
      </div>
      <div className="space-y-2">
        {connections.map((connection) => (
          <SavedConnectionRow key={connection.id} connection={connection} />
        ))}
      </div>
      <AddDiscoveryConnection
        detectedGateway={detectedGateway}
        gatewayCandidates={gatewayCandidates}
        variant="compact"
      />
    </div>
  );
}
