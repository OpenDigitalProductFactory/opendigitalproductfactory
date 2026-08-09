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
  tlsInsecure?: boolean;
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

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f /* "/" */) end--;
  return value.slice(0, end);
}

function stripScheme(value: string): string {
  if (value.startsWith("https://")) return value.slice(8);
  if (value.startsWith("http://")) return value.slice(7);
  if (value.startsWith("HTTPS://")) return value.slice(8);
  if (value.startsWith("HTTP://")) return value.slice(7);
  return value;
}

function stripPath(value: string): string {
  const slashIndex = value.indexOf("/");
  return slashIndex >= 0 ? value.slice(0, slashIndex) : value;
}

function isIpv4Octet(value: string): boolean {
  if (value.length === 0 || value.length > 3) return false;
  for (const char of value) {
    if (char < "0" || char > "9") return false;
  }
  const octet = Number(value);
  return octet >= 0 && octet <= 255;
}

function toIpv4Subnet(value: string): string {
  const host = stripPath(stripScheme(trimTrailingSlashes(value.trim())));
  if (host.includes("/")) return host;
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every(isIpv4Octet)) return "";
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

function isIpv4Cidr(value: string): boolean {
  const [ip, cidr, extra] = value.trim().split("/");
  if (!ip || !cidr || extra !== undefined) return false;
  const prefix = Number(cidr);
  if (!Number.isInteger(prefix) || prefix < 16 || prefix > 32) return false;
  const parts = ip.split(".");
  return parts.length === 4 && parts.every(isIpv4Octet);
}

function defaultEndpointForCollector(collectorType: string, gatewayAddress?: string): string {
  const raw = gatewayAddress?.trim();
  if (!raw) return "";
  if (collectorType === "unifi") return raw.startsWith("http") ? trimTrailingSlashes(raw) : `https://${raw}`;
  if (collectorType === "snmp") return stripPath(stripScheme(trimTrailingSlashes(raw)));
  if (collectorType === "arp_scan") return toIpv4Subnet(raw);
  return raw;
}

function formatConnectionFeedback(status: string, fallback?: string): string {
  switch (status) {
    case "unifi_tls_error":
      return "The UniFi controller appears to use a self-signed certificate. Enable self-signed certificate support for this closed LAN, or install a trusted certificate on the controller.";
    case "unifi_auth_failed":
      return "The UniFi controller rejected the API key. Rotate the key in UniFi OS and paste the new value here.";
    case "unifi_unreachable":
      return "The portal could not reach the UniFi controller from this host. Check the controller URL and local network reachability.";
    default:
      return fallback ?? status;
  }
}

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
    defaultEndpointForCollector(existing?.collectorType ?? "unifi", gatewayAddress),
  );
  const [apiKey, setApiKey] = useState("");
  const [site, setSite] = useState(existing?.site ?? "default");
  const [tlsInsecure, setTlsInsecure] = useState(existing?.tlsInsecure ?? false);
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
    if (isArpScan && !isIpv4Cidr(endpointUrl)) {
      setMessage("Subnet must be CIDR notation, for example 192.168.0.0/24");
      setStatus("error");
      return;
    }

    startTransition(async () => {
      setStatus("saving");
      setMessage("");

      const configuration: Record<string, unknown> = {};
      if (isUnifi) {
        configuration.site = site;
        configuration.discoverClients = true;
        configuration.tlsInsecure = tlsInsecure;
      }
      if (isSnmp) configuration.community = apiKey || "public";
      if (isArpScan) configuration.subnet = endpointUrl;

      const result = await configureDiscoveryConnection({
        ...(existing?.id ? { id: existing.id } : {}),
        gatewayEntityId,
        name: isArpScan ? `Subnet ${endpointUrl}` : gatewayName,
        collectorType,
        endpointUrl,
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
        setMessage(formatConnectionFeedback("error", testResult.error));
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
        setMessage(formatConnectionFeedback(testResult.status, testResult.message ?? "Connection test failed"));
      }
    });
  };

  return (
    <div
      className="mt-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 space-y-3"
      data-surface-node-id="connection.form"
    >
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
        Configure Discovery Connection
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-xs text-[var(--dpf-muted)]">Discovery Method</span>
          <select
            data-surface-node-id="connection.method"
            value={collectorType}
            onChange={(e) => {
              const nextCollectorType = e.target.value;
              setCollectorType(nextCollectorType);
              setEndpointUrl(defaultEndpointForCollector(nextCollectorType, gatewayAddress));
              setStatus("idle");
              setMessage("");
            }}
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
              data-surface-node-id="connection.site"
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
              type="password"
              autoComplete="new-password"
              data-surface-node-id="connection.community"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="public"
              className="mt-1 block w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
            />
          </label>
        )}
      </div>

      {isSnmp && (
        <p className="text-xs leading-5 text-[var(--dpf-muted)]">
          SNMP discovers network devices. SMTP sends outbound email and is configured elsewhere.
        </p>
      )}

      <label className="block">
        <span className="text-xs text-[var(--dpf-muted)]">
          {isUnifi ? "Controller URL" : isSnmp ? "Target IP or Hostname" : "Subnet to scan"}
        </span>
        <input
          data-surface-node-id="connection.target"
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
            data-surface-node-id="connection.community"
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={keyRequired ? "Paste your UniFi OS API key" : "•••••••••••••••• (stored)"}
            className="mt-1 block w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
          />
        </label>
      )}

      {isUnifi && (
        <label className="flex items-start gap-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <input
            data-surface-node-id="connection.tls-insecure"
            type="checkbox"
            checked={tlsInsecure}
            onChange={(e) => setTlsInsecure(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] accent-[var(--dpf-accent)]"
          />
          <span className="min-w-0">
            <span className="block text-xs font-medium text-[var(--dpf-text)]">
              Allow self-signed controller certificate
            </span>
            <span className="mt-0.5 block text-[11px] leading-4 text-[var(--dpf-muted)]">
              Use for trusted closed-LAN UniFi appliances that do not have a public certificate.
            </span>
          </span>
        </label>
      )}

      <div className="flex items-center gap-3">
        <button
          data-surface-node-id="connection.save-and-test"
          onClick={handleSave}
          disabled={isPending}
          className="rounded-md bg-[var(--dpf-accent)] px-4 py-1.5 text-sm font-medium text-[var(--dpf-on-accent,var(--dpf-surface-1))] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Connecting..." : "Save & Test"}
        </button>

        {message && (
          <p
            className={`text-xs ${
              status === "success"
                ? "text-[var(--dpf-success)]"
                : status === "error"
                  ? "text-[var(--dpf-error)]"
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
