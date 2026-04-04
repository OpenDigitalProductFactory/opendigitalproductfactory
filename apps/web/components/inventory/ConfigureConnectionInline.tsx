"use client";

import { useState, useTransition } from "react";
import {
  configureDiscoveryConnection,
  testDiscoveryConnection,
} from "@/lib/actions/discovery";

type Props = {
  gatewayEntityId?: string;
  gatewayAddress?: string;
  gatewayName: string;
  onComplete: () => void;
};

const COLLECTOR_TYPES = [
  { value: "unifi", label: "Ubiquiti UniFi" },
] as const;

export function ConfigureConnectionInline({
  gatewayEntityId,
  gatewayAddress,
  gatewayName,
  onComplete,
}: Props) {
  const [collectorType, setCollectorType] = useState("unifi");
  const [endpointUrl, setEndpointUrl] = useState(
    gatewayAddress ? `https://${gatewayAddress}` : "",
  );
  const [apiKey, setApiKey] = useState("");
  const [site, setSite] = useState("default");
  const [status, setStatus] = useState<"idle" | "saving" | "testing" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    if (!endpointUrl || !apiKey) {
      setMessage("Endpoint URL and API key are required");
      setStatus("error");
      return;
    }

    startTransition(async () => {
      setStatus("saving");
      setMessage("");

      const result = await configureDiscoveryConnection({
        gatewayEntityId,
        name: gatewayName,
        collectorType,
        endpointUrl,
        apiKey,
        configuration: { site },
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
          <span className="text-xs text-[var(--dpf-muted)]">Equipment Type</span>
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
      </div>

      <label className="block">
        <span className="text-xs text-[var(--dpf-muted)]">Controller URL</span>
        <input
          type="url"
          value={endpointUrl}
          onChange={(e) => setEndpointUrl(e.target.value)}
          placeholder="https://192.168.0.1"
          className="mt-1 block w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
        />
      </label>

      <label className="block">
        <span className="text-xs text-[var(--dpf-muted)]">API Key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Paste your UniFi OS API key"
          className="mt-1 block w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
        />
      </label>

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
