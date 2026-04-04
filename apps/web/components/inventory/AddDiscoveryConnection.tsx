"use client";

import { useState } from "react";
import { ConfigureConnectionInline } from "./ConfigureConnectionInline";

export function AddDiscoveryConnection() {
  const [showForm, setShowForm] = useState(false);

  if (showForm) {
    return (
      <ConfigureConnectionInline
        gatewayName="Network Gateway"
        onComplete={() => setShowForm(false)}
      />
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
            Network Discovery
          </p>
          <p className="text-sm text-[var(--dpf-muted)] mt-1">
            Connect your network gateway to discover all devices on your network.
            Supports Ubiquiti UniFi controllers.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-md bg-[#7c8cf8] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#6b7bf7] transition-colors shrink-0"
        >
          Add Connection
        </button>
      </div>
    </div>
  );
}
