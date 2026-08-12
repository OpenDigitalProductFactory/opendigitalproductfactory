"use client";

import { useState } from "react";
import { ConfigureConnectionInline } from "./ConfigureConnectionInline";
import type { GatewayCandidate } from "@/lib/discovery-connection/gateway-candidate";

type Props = {
  /** Gateway IP detected from discovered network interfaces (e.g., "192.168.0.1") */
  detectedGateway?: string | null;
  gatewayCandidates?: GatewayCandidate[];
  /**
   * "hero" (default) is the empty-state pitch with detected-gateway copy.
   * "compact" is the small "+ Add another" tile shown beneath an existing list.
   */
  variant?: "hero" | "compact";
};

export function AddDiscoveryConnection({ detectedGateway, gatewayCandidates = [], variant = "hero" }: Props) {
  const [showForm, setShowForm] = useState(false);

  if (showForm) {
    return (
      <ConfigureConnectionInline
        gatewayCandidates={gatewayCandidates}
        gatewayName={gatewayCandidates[0]?.name ?? (detectedGateway ? `Gateway ${detectedGateway}` : "Network Gateway")}
        gatewayAddress={detectedGateway ?? undefined}
        onComplete={() => setShowForm(false)}
      />
    );
  }

  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={() => setShowForm(true)}
        className="w-full rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs text-[var(--dpf-muted)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-text)]"
      >
        + Add another connection (UniFi, SNMP, or ARP scan)
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
            Network Discovery
          </p>
          {gatewayCandidates.length > 0 ? (
            <>
              <p className="text-sm text-[var(--dpf-text)] mt-1">
                {gatewayCandidates.length === 1
                  ? <>Gateway identified: <span className="font-medium">{gatewayCandidates[0].name}</span></>
                  : <>{gatewayCandidates.length} possible gateways identified</>}
              </p>
              <p className="text-xs text-[var(--dpf-muted)] mt-1">
                DPF will use the discovered device identity and recommend the best supported connection method.
              </p>
            </>
          ) : (
            <p className="text-sm text-[var(--dpf-muted)] mt-1">
              Connect your network gateway to discover all devices on your network.
              Supports Ubiquiti UniFi, SNMP, and subnet scanning.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="shrink-0 rounded-md bg-[var(--dpf-accent)] px-4 py-1.5 text-sm font-medium text-[var(--dpf-accent-contrast)] transition-opacity hover:opacity-90"
        >
          {gatewayCandidates.length > 0 ? "Review & Connect" : "Add Connection"}
        </button>
      </div>
    </div>
  );
}
