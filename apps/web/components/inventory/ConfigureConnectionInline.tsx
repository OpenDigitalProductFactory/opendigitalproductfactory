"use client";

import { useState, useTransition } from "react";
import {
  configureDiscoveryConnection,
  testDiscoveryConnection,
} from "@/lib/actions/discovery";

type ExistingConnection = {
  /** DiscoveryConnection.id — present means edit by id (URL changes allowed). */
  id: string;
  collectorType: string;
  site?: string;
  /** True if the row already has an encrypted API key; lets the form show "leave blank to keep". */
  hasApiKey: boolean;
};

type Props = {
  gatewayEntityId?: string;
  gatewayAddress?: string;
  gatewayName: string;
  onComplete: () => void;
  /**
   * When set, the form starts in edit mode: collectorType + site + endpoint are pre-filled
   * and the API key field becomes optional (omitted on save = keep existing).
   */
  existing?: ExistingConnection;
};

const COLLECTOR_TYPES = [
  { value: "unifi", label: "Ubiquiti UniFi" },
  { value: "snmp", label: "SNMP (Generic)" },
  { value: "arp_scan", label: "Network Scan (ARP)" },
] as const;

export function ConfigureConnectionInline({
  gatewayEntityId,
  gatewayAddress,
  gatewayName,
  onComplete,
  existing,
}: Props) {
  const isEditMode = !!existing;
  const [collectorType, setCollectorType] = useState(existing?.collectorType ?? "unifi");
  const [endpointUrl, setEndpointUrl] = useState(
    gatewayAddress ? (gatewayAddress.startsWith("http") ? gatewayAddress : `https://${gatewayAddress}`) : "",
  );
  const [apiKey, setApiKey] = useState("");
  const [site, setSite] = useState(existing?.site ?? "default");
  const [status, setStatus] = useState<"idle" | "saving" | "testing" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const isUnifi = collectorType === "unifi";
  const isSnmp = collectorType === "snmp";
  const isArpScan = collectorType === "arp_scan";

  // API key requirement is relaxed in edit mode when one already exists:
  // omitting it on save preserves the stored ciphertext (server-side upsert
  // only overwrites `encryptedApiKey` when a new value is supplied).
  const keyRequired = isUnifi && !(isEditMode && existing?.hasApiKey);

  const handleSave = () => {
    if (keyRequired && (!endpointUrl || !apiKey)) {
      setMessage("Controller URL and API key are required");
      setStatus("error");
      return;
    }
    if (isUnifi && !keyRequired && !endpointUrl) {
      setMessage("Controller URL is required");
      setStatus("error");
      return;
    }
    if (isSnmp && !endpointUrl) {
      setMessage("Target IP address is required");
      setStatus("error");
      return;
    }
    if (isArpScan && !endpointUrl) {
      setMessage("Subnet is required (e.g., 192.168.0.0/24)");
      setStatus("error");
      return;
    }

    startTransition(async () => {
      setStatus("saving");
      setMessage("");

      const configuration: Record<string, unknown> = {};
      if (isUnifi) { configuration.site = site; configuration.discoverClients = true; }
      if (isSnmp) configuration.community = apiKey || "public";
      if (isArpScan) configuration.subnet = endpointUrl;

      const result = await configureDiscoveryConnection({
        ...(existing?.id ? { id: existing.id } : {}),
        gatewayEntityId,
        name: isArpScan ? `Subnet ${endpointUrl}` : gatewayName,
        collectorType,
        endpointUrl: isArpScan ? endpointUrl : endpointUrl,
        // In edit mode without a fresh key, send undefined so the server-side
        // upsert keeps the existing encryptedApiKey.
        apiKey: isUnifi
          ? (apiKey || undefined)
          : isSnmp ? apiKey || "public" : undefined,
        configuration,
      });

      if (!result.ok) {
        setStatus("error");
        setMessage(result.error);
        return;
      }

      // Test the connection
      setStatus("testing");
      setMessage("Saved. Testing connection...");

      const testResult = await testDiscoveryConnection(result.connectionId);
      if (!testResult.ok) {
        setStatus("error");
        setMessage(testResult.error);
        return;
      }

      if (testResult.status === "ok") {
        setStatus("success");
        setMessage(
          `Connected. Discovered ${testResult.deviceCount ?? 0} device(s). The next discovery sweep will pull full topology.`,
        );
        setTimeout(onComplete, 3000);
      } else {
        setStatus("error");
        setMessage(testResult.message ?? "Connection test failed");
      }
    });
  };

  return (
    <div className="mt-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 space-y-3">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
        Configure Discovery Connection
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-[var(--dpf-muted)]">Discovery Method</span>
          <select
            value={collectorType}
            onChange={(e) => setCollectorType(e.target.value)}
            className="mt-1 block w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
          >
            {COLLECTOR_TYPES.map((ct) => (
              <option key={ct.value} value={ct.value}>
                {ct.label}
              </option>
            ))}
          </select>
        </label>

        {isUnifi && (
          <label className="block">
            <span className="text-xs text-[var(--dpf-muted)]">Site</span>
            <input
              type="text"
              value={site}
              onChange={(e) => setSite(e.target.value)}
              placeholder="default"
              className="mt-1 block w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
            />
          </label>
        )}

        {isSnmp && (
          <label className="block">
            <span className="text-xs text-[var(--dpf-muted)]">Community String</span>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="public"
              className="mt-1 block w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
            />
          </label>
        )}
      </div>

      <label className="block">
        <span className="text-xs text-[var(--dpf-muted)]">
          {isUnifi ? "Controller URL" : isSnmp ? "Target IP or Hostname" : "Subnet to scan"}
        </span>
        <input
          type={isUnifi ? "url" : "text"}
          value={endpointUrl}
          onChange={(e) => setEndpointUrl(e.target.value)}
          placeholder={isUnifi ? "https://192.168.0.1" : isSnmp ? "192.168.0.1" : "192.168.0.0/24"}
          className="mt-1 block w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
        />
      </label>

      {isUnifi && (
        <label className="block">
          <span className="text-xs text-[var(--dpf-muted)]">
            API Key{!keyRequired && <span className="ml-1 text-[10px]">(leave blank to keep existing)</span>}
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={keyRequired ? "Paste your UniFi OS API key" : "•••••••••••••••• (stored)"}
            className="mt-1 block w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
          />
        </label>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="rounded-md bg-[#7c8cf8] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#6b7bf7] disabled:opacity-50 transition-colors"
        >
          {isPending ? "Connecting..." : "Save & Test"}
        </button>

        {message && (
          <p
            className={`text-xs ${
              status === "success"
                ? "text-emerald-400"
                : status === "error"
                  ? "text-[#fb7185]"
                  : "text-[var(--dpf-muted)]"
            }`}
          >
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
