"use client";

import { useState } from "react";
import { ConfigureConnectionInline } from "./ConfigureConnectionInline";

type Props = {
  /** Gateway IP detected from discovered network interfaces (e.g., "192.168.0.1") */
  detectedGateway?: string | null;
};

export function AddDiscoveryConnection({ detectedGateway }: Props) {
  const [showForm, setShowForm] = useState(false);

  if (showForm) {
    return (
      <ConfigureConnectionInline
        gatewayName={detectedGateway ? `Gateway ${detectedGateway}` : "Network Gateway"}
        gatewayAddress={detectedGateway ?? undefined}
        onComplete={() => setShowForm(false)}
      />
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
            Network Discovery
          </p>
          {detectedGateway ? (
            <>
              <p className="text-sm text-[var(--dpf-text)] mt-1">
                Gateway detected at <span className="font-mono font-medium">{detectedGateway}</span>
              </p>
              <p className="text-xs text-[var(--dpf-muted)] mt-1">
                Connect to your gateway to discover all devices on your network.
                If this is a Ubiquiti UniFi gateway, you will need an API key from
                Settings &gt; API in your UniFi console.
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
          className="rounded-md bg-[#7c8cf8] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#6b7bf7] transition-colors shrink-0"
        >
          {detectedGateway ? "Configure" : "Add Connection"}
        </button>
      </div>
    </div>
  );
}
