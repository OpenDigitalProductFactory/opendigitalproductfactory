"use client";

import { useMemo, useState, useTransition } from "react";
import {
  configureDiscoveryConnection,
  testDiscoveryConnection,
} from "@/lib/actions/discovery";
import {
  endpointForCollector,
  normalizeDiscoveryEndpoint,
  type DiscoveryCollectorType,
} from "@/lib/discovery-connection/endpoint";
import {
  choosePreselectedGateway,
  type GatewayCandidate,
} from "@/lib/discovery-connection/gateway-candidate";
import {
  CheckboxField,
  FormStatus,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/ui/form";

type ExistingConnection = {
  id: string;
  collectorType: string;
  site?: string;
  tlsInsecure?: boolean;
  hasApiKey: boolean;
};

type Props = {
  gatewayCandidates?: GatewayCandidate[];
  gatewayEntityId?: string;
  gatewayAddress?: string;
  gatewayName: string;
  onComplete: () => void;
  existing?: ExistingConnection;
};

const COLLECTOR_TYPES = [
  { value: "unifi", label: "Ubiquiti UniFi" },
  { value: "snmp", label: "SNMP (Generic)" },
  { value: "arp_scan", label: "Network Scan (ARP)" },
];

function asCollectorType(value: string): DiscoveryCollectorType {
  return value === "snmp" || value === "arp_scan" ? value : "unifi";
}

function formatConnectionFeedback(status: string, fallback?: string): string {
  switch (status) {
    case "unifi_tls_error":
      return "The UniFi gateway appears to use a self-signed certificate. Allow it for this trusted closed LAN, or install a trusted certificate on the gateway.";
    case "unifi_auth_failed":
      return "The UniFi gateway rejected the API key. Rotate the key in UniFi OS and paste the new value here.";
    case "unifi_unreachable":
      return "DPF could not reach this UniFi gateway from the portal host. Check local network reachability.";
    default:
      return fallback ?? status;
  }
}

function fallbackCandidate(
  gatewayEntityId: string | undefined,
  gatewayAddress: string | undefined,
  gatewayName: string,
): GatewayCandidate[] {
  if (!gatewayAddress) return [];
  const canonicalEndpoint = endpointForCollector("unifi", gatewayAddress);
  return [{
    entityId: gatewayEntityId ?? "detected-gateway",
    entityKey: gatewayEntityId ?? gatewayAddress,
    name: gatewayName,
    address: gatewayAddress,
    manufacturer: null,
    model: null,
    confidence: null,
    evidence: ["Detected on the local network"],
    recommendedCollector: "unifi",
    recommendation: "DPF detected this gateway on the local network.",
    canonicalEndpoint,
    matchesDetectedGateway: true,
    usable: canonicalEndpoint !== null,
  }];
}

function gatewayOptionLabel(candidate: GatewayCandidate): string {
  const identity = [candidate.manufacturer, candidate.model].filter(Boolean).join(" ");
  return [candidate.name, identity || null, candidate.address].filter(Boolean).join(" — ");
}

export function ConfigureConnectionInline({
  gatewayCandidates,
  gatewayEntityId,
  gatewayAddress,
  gatewayName,
  onComplete,
  existing,
}: Props) {
  const candidates = useMemo(
    () => gatewayCandidates ?? fallbackCandidate(gatewayEntityId, gatewayAddress, gatewayName),
    [gatewayCandidates, gatewayEntityId, gatewayAddress, gatewayName],
  );
  const initialSelection = choosePreselectedGateway(candidates);
  const initialCandidate = candidates.find((candidate) => candidate.entityId === initialSelection);
  const [selectedGatewayId, setSelectedGatewayId] = useState(initialSelection ?? "");
  const [collectorType, setCollectorType] = useState<DiscoveryCollectorType>(
    asCollectorType(existing?.collectorType ?? initialCandidate?.recommendedCollector ?? "unifi"),
  );
  const [manualEndpoint, setManualEndpoint] = useState(gatewayAddress ?? "");
  const [manualMode, setManualMode] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [site, setSite] = useState(existing?.site ?? "default");
  const [tlsInsecure, setTlsInsecure] = useState(existing?.tlsInsecure ?? false);
  const [status, setStatus] = useState<"idle" | "saving" | "testing" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [isPending, startTransition] = useTransition();

  const selectedCandidate = candidates.find((candidate) => candidate.entityId === selectedGatewayId);
  const isUnifi = collectorType === "unifi";
  const isSnmp = collectorType === "snmp";
  const isArpScan = collectorType === "arp_scan";
  const keyRequired = isUnifi && !(existing && existing.hasApiKey);
  const selectedEndpoint = selectedCandidate?.address
    ? endpointForCollector(collectorType, selectedCandidate.address)
    : null;
  const endpointInput = manualMode || !selectedEndpoint ? manualEndpoint : selectedEndpoint;

  const selectGateway = (entityId: string) => {
    const candidate = candidates.find((item) => item.entityId === entityId);
    setSelectedGatewayId(entityId);
    setManualMode(false);
    setFieldError("");
    setMessage("");
    setStatus("idle");
    if (candidate) setCollectorType(candidate.recommendedCollector);
  };

  const changeCollector = (value: string) => {
    const next = asCollectorType(value);
    setCollectorType(next);
    const derived = selectedCandidate?.address
      ? endpointForCollector(next, selectedCandidate.address)
      : null;
    setManualEndpoint(derived ?? "");
    setManualMode(next !== "unifi");
    setFieldError("");
    setMessage("");
    setStatus("idle");
  };

  const handleSave = () => {
    if (!selectedCandidate && !manualMode) {
      setMessage("Choose a gateway before saving this connection.");
      setStatus("error");
      return;
    }
    const normalized = normalizeDiscoveryEndpoint(endpointInput, collectorType);
    if (!normalized.ok) {
      setFieldError(normalized.error);
      setStatus("error");
      return;
    }
    if (keyRequired && !apiKey) {
      setMessage("Enter the UniFi API key for this gateway.");
      setStatus("error");
      return;
    }

    setFieldError("");
    startTransition(async () => {
      setStatus("saving");
      setMessage("");
      const configuration: Record<string, unknown> = {};
      if (isUnifi) Object.assign(configuration, { site, discoverClients: true, tlsInsecure });
      if (isSnmp) configuration.community = apiKey || "public";
      if (isArpScan) configuration.subnet = normalized.value;

      const result = await configureDiscoveryConnection({
        ...(existing?.id ? { id: existing.id } : {}),
        gatewayEntityId: manualMode ? undefined : selectedCandidate?.entityId,
        name: isArpScan
          ? `Subnet ${normalized.value}`
          : selectedCandidate?.name ?? gatewayName,
        collectorType,
        endpointUrl: normalized.value,
        apiKey: isUnifi ? (apiKey || undefined) : isSnmp ? apiKey || "public" : undefined,
        configuration,
      });

      if (!result.ok) {
        setStatus("error");
        setMessage(result.error);
        return;
      }

      setStatus("testing");
      setMessage("Saved. Testing connection…");
      const testResult = await testDiscoveryConnection(result.connectionId);
      if (!testResult.ok) {
        setStatus("error");
        setMessage(formatConnectionFeedback("error", testResult.error));
        return;
      }
      if (testResult.status !== "ok") {
        setStatus("error");
        setMessage(formatConnectionFeedback(testResult.status, testResult.message));
        return;
      }
      setStatus("success");
      setMessage(`Connected. Discovered ${testResult.deviceCount ?? 0} device(s).`);
      setTimeout(onComplete, 3000);
    });
  };

  return (
    <div className="mt-4 space-y-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
          Configure Discovery Connection
        </p>
        <p className="mt-1 text-sm text-[var(--dpf-text)]">
          Select the gateway DPF identified. Its network endpoint is filled in automatically.
        </p>
      </div>

      {candidates.length > 1 ? (
        <SelectField
          name="gateway"
          label="Gateway"
          value={selectedGatewayId}
          onValueChange={selectGateway}
          placeholder="Choose an identified gateway"
          options={candidates.map((candidate) => ({
            value: candidate.entityId,
            label: gatewayOptionLabel(candidate),
            disabled: !candidate.usable,
          }))}
          hint={selectedCandidate?.recommendation ?? "Choose by device name, manufacturer, model, and local address."}
          required
        />
      ) : selectedCandidate ? (
        <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3" aria-label="Selected gateway">
          <p className="font-medium text-[var(--dpf-text)]">{selectedCandidate.name}</p>
          {(selectedCandidate.manufacturer || selectedCandidate.model) && (
            <p className="text-sm text-[var(--dpf-muted)]">
              {[selectedCandidate.manufacturer, selectedCandidate.model].filter(Boolean).join(" · ")}
            </p>
          )}
          {selectedCandidate.address && (
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              Local address <span className="font-mono text-[var(--dpf-text)]">{selectedCandidate.address}</span>
            </p>
          )}
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">{selectedCandidate.recommendation}</p>
        </section>
      ) : (
        <p className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-muted)]">
          DPF did not find an identifiable gateway. Manual recovery is available below.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SelectField
          name="discovery-method"
          label="Discovery Method"
          value={collectorType}
          onValueChange={changeCollector}
          options={COLLECTOR_TYPES}
        />
        {isUnifi && (
          <TextField name="site" label="Site" value={site} onValueChange={setSite} placeholder="default" />
        )}
        {isSnmp && (
          <TextField
            name="community-string"
            label="Community String"
            value={apiKey}
            onValueChange={setApiKey}
            placeholder="public"
          />
        )}
      </div>

      {isUnifi ? (
        <details className="rounded-md border border-[var(--dpf-border)] px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-[var(--dpf-accent)]">
            Enter a gateway manually
          </summary>
          <div className="mt-3">
            <TextField
              name="gateway-address"
              label="Gateway address"
              value={manualEndpoint}
              onValueChange={(value) => {
                setManualEndpoint(value);
                setManualMode(true);
                setFieldError("");
              }}
              hint="Enter a host or IP address. A scheme and port are optional."
              error={fieldError}
              placeholder="192.168.0.1"
            />
          </div>
        </details>
      ) : (
        <TextField
          name="discovery-endpoint"
          label={isSnmp ? "Target IP or Hostname" : "Subnet to scan"}
          value={endpointInput}
          onValueChange={(value) => {
            setManualEndpoint(value);
            setManualMode(true);
            setFieldError("");
          }}
          error={fieldError}
          placeholder={isSnmp ? "192.168.0.1" : "192.168.0.0/24"}
        />
      )}

      {isUnifi && (
        <TextField
          name="api-key"
          label={keyRequired ? "API Key" : "API Key (leave blank to keep existing)"}
          type="password"
          value={apiKey}
          onValueChange={setApiKey}
          autoComplete="off"
          placeholder={keyRequired ? "Paste your UniFi OS API key" : "Stored securely"}
          required={keyRequired}
        />
      )}

      {isUnifi && (
        <CheckboxField
          name="tls-insecure"
          label="Allow self-signed controller certificate"
          checked={tlsInsecure}
          onCheckedChange={setTlsInsecure}
          hint="Use only for a trusted closed-LAN UniFi appliance without a public certificate."
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton type="button" onClick={handleSave} pending={isPending} pendingLabel="Connecting…">
          Save &amp; Test
        </SubmitButton>
        <FormStatus
          error={status === "error" ? message : null}
          success={status === "success" ? message : null}
        />
        {status === "testing" && <p className="text-sm text-[var(--dpf-muted)]">{message}</p>}
      </div>
    </div>
  );
}
