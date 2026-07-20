"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { confirmDialog, promptDialog } from "@/components/ui/Dialog";
import { InlineBusy } from "@/components/ui/InlineBusy";
import { StatusBadge } from "@/components/ui/report-kit";
import {
  approveFederationLinkAction,
  approveNearbyPairingAction,
  denyNearbyPairingAction,
  enrollWithPeerAction,
  issueFederationBootstrapAction,
  pollNearbyPairingAction,
  quarantineFederationLinkAction,
  revokeFederationLinkAction,
  setFederationDiscoveryEnabledAction,
  setFederationLinkEnvironmentAction,
  startNearbyPairingAction,
} from "@/lib/actions/federation-links";
import type { NearbyFederationCandidate } from "@/lib/federation/nearby-candidates";

export interface FederationLinkRow {
  linkId: string;
  displayName: string;
  role: string;
  linkState: string;
  peerAuthorityUrl: string;
  peerOrganizationRef: string | null;
  approvedLocal: boolean;
  approvedPeer: boolean;
  /** Slices that cross this link to the peer (the egress-enforced projection). */
  sharedSlices: string[];
  /** Retention class the peer applies to what we share. */
  sharedRetention: string;
  environmentClass: "production" | "development" | "test";
  createdAtISO: string;
}

export interface NearbyDiscoveryHealth {
  status: "healthy" | "degraded" | "waiting" | "disabled" | "unavailable";
  label: string;
  detail: string;
}

export interface NearbyPairingRow {
  pairingId: string;
  direction: "incoming" | "outgoing";
  status: string;
  matchingCode: string;
  peerDisplayName: string;
  peerAuthorityUrl: string;
  expiresAt: string;
  sharedSlices: string[];
  retentionClass: string;
  staysLocal: string[];
}

type Flash = { kind: "success" | "error"; text: string } | null;

export function FederationLinksAdminClient({
  rows,
  nearbyCandidates = [],
  nearbyPairings = [],
  nearbyDiscoveryHealth = {
    status: "unavailable",
    label: "Not set up",
    detail: "Enable the native Edge Node to find DPF installations on this network.",
  },
}: {
  rows: FederationLinkRow[];
  nearbyCandidates?: NearbyFederationCandidate[];
  nearbyPairings?: NearbyPairingRow[];
  nearbyDiscoveryHealth?: NearbyDiscoveryHealth;
}) {
  const router = useRouter();
  const [flash, setFlash] = useState<Flash>(null);
  const [relationshipPreset, setRelationshipPreset] = useState<
    "same-organization" | "service-provider" | "channel"
  >("service-provider");
  const [role, setRole] = useState<
    "manages" | "managed-by" | "same-org-peer" | "channel-upstream" | "channel-downstream"
  >("manages");
  const [ttlMinutes, setTtlMinutes] = useState(15);
  const [issued, setIssued] = useState<{ plaintext: string; expiresAt: string } | null>(null);
  const [peerUrl, setPeerUrl] = useState("");
  const [peerToken, setPeerToken] = useState("");
  const [peerName, setPeerName] = useState("");
  const [activePairing, setActivePairing] = useState<NearbyPairingRow | null>(null);
  const [isPending, startTransition] = useTransition();

  const pairingRows = useMemo(() => {
    if (!activePairing) return nearbyPairings;
    return [activePairing, ...nearbyPairings.filter((row) => row.pairingId !== activePairing.pairingId)];
  }, [activePairing, nearbyPairings]);

  function actionPairingRow(
    result: Extract<Awaited<ReturnType<typeof startNearbyPairingAction>>, { ok: true }>,
  ): NearbyPairingRow {
    return {
      pairingId: result.pairingId,
      direction: "outgoing",
      status: result.status,
      matchingCode: result.matchingCode,
      peerDisplayName: result.peerDisplayName,
      peerAuthorityUrl: result.peerAuthorityUrl,
      expiresAt: result.expiresAt,
      sharedSlices: result.projectionSummary.sharedSlices,
      retentionClass: result.projectionSummary.retentionClass,
      staysLocal: result.projectionSummary.staysLocal,
    };
  }

  useEffect(() => {
    const outgoing = pairingRows.find(
      (row) => row.direction === "outgoing" && (row.status === "pending" || row.status === "approved"),
    );
    if (!outgoing || isPending) return;
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        const result = await pollNearbyPairingAction(outgoing.pairingId);
        if (!result.ok) {
          setFlash({ kind: "error", text: `Pairing check failed: ${result.message}` });
          return;
        }
        setActivePairing(actionPairingRow(result));
        if (result.status === "consumed") {
          setFlash({
            kind: "success",
            text: `Secure setup completed${result.linkId ? ` — link ${result.linkId}` : ""}. Approve the new connection below; it becomes trusted after both installations approve.`,
          });
          router.refresh();
        }
      });
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [isPending, pairingRows, router]);

  async function selectNearbyCandidate(candidate: NearbyFederationCandidate) {
    if (candidate.automaticPairing === "blocked-insecure-transport") return;
    const confirmed = await confirmDialog({
      title: "Connect another installation",
      message: "Is this another DPF owned by your organization? Both installations will show the same code and sharing summary before approval.",
      confirmLabel: "Yes, start secure setup",
    });
    if (!confirmed) return;
    setFlash(null);
    startTransition(async () => {
      const result = await startNearbyPairingAction({
        discoveryId: candidate.discoveryId,
        endpoint: candidate.endpoint,
      });
      if (!result.ok) {
        setFlash({ kind: "error", text: `Secure setup failed: ${result.message} Manual invitation remains available below.` });
        return;
      }
      setActivePairing(actionPairingRow(result));
      setFlash({ kind: "success", text: "Secure setup started. Confirm the same code on both installations." });
    });
  }

  async function onApprovePairing(row: NearbyPairingRow) {
    const confirmed = await confirmDialog({
      title: "Approve this installation",
      message: `Approve ${row.peerDisplayName} only if it shows the same code ${row.matchingCode} and you accept the sharing summary. The connection still remains pending until both installations approve it.`,
      confirmLabel: "Approve this installation",
    });
    if (!confirmed) return;
    startTransition(async () => {
      const result = await approveNearbyPairingAction(row.pairingId);
      setFlash(result.ok
        ? { kind: "success", text: "Pairing approved here. Waiting for the other installation to finish setup." }
        : { kind: "error", text: `Pairing approval failed: ${result.message}` });
      if (result.ok) router.refresh();
    });
  }

  async function onDenyPairing(row: NearbyPairingRow) {
    const reason = await promptDialog({
      title: "Deny this installation",
      message: `Why are you denying ${row.peerDisplayName}?`,
      required: true,
      confirmLabel: "Deny connection",
    });
    if (!reason?.trim()) return;
    startTransition(async () => {
      const result = await denyNearbyPairingAction(row.pairingId, reason.trim());
      setFlash(result.ok
        ? { kind: "success", text: "Pairing request denied. No invitation or connection was created." }
        : { kind: "error", text: `Pairing denial failed: ${result.message}` });
      if (result.ok) router.refresh();
    });
  }

  function setNearbyDiscovery(enabled: boolean) {
    setFlash(null);
    startTransition(async () => {
      const result = await setFederationDiscoveryEnabledAction(enabled);
      setFlash(
        result.ok
          ? {
              kind: "success",
              text: enabled
                ? "Nearby discovery enabled. The Edge Node will start listening shortly."
                : "Nearby discovery paused.",
            }
          : { kind: "error", text: `Discovery update failed: ${result.message}` },
      );
    });
  }

  function onConnect() {
    setFlash(null);
    startTransition(async () => {
      const result = await enrollWithPeerAction({
        peerAuthorityUrl: peerUrl.trim(),
        bootstrapToken: peerToken.trim(),
        displayName: peerName.trim() || "Peer deployment",
      });
      if (result.ok) {
        setPeerToken("");
        setFlash({
          kind: "success",
          text: `Connected — link ${result.linkId} is ${result.linkState}. Approve it below; it is trusted once both sides approve.`,
        });
      } else {
        setFlash({ kind: "error", text: `Connect failed: ${result.message}` });
      }
    });
  }

  function onIssue() {
    setFlash(null);
    setIssued(null);
    startTransition(async () => {
      const result = await issueFederationBootstrapAction({
        relationshipPreset,
        offeredRole: role,
        ttlMs: Math.max(60_000, ttlMinutes * 60_000),
      });
      if (result.ok) {
        setIssued({ plaintext: result.plaintext, expiresAt: result.expiresAt });
        setFlash({ kind: "success", text: "Invitation issued. Copy it now — it is shown once." });
      } else {
        setFlash({ kind: "error", text: `Failed: ${result.message}` });
      }
    });
  }

  async function onApprove(row: FederationLinkRow) {
    // Await the dialog OUTSIDE the transition — a dialog helper deferred inside
    // startTransition never renders interactively (BI-FE7C543C).
    const ok = await confirmDialog({
      title: "Approve federation link",
      message: `Approve our side of "${row.displayName}"? The link becomes trusted only once the peer also approves.`,
      confirmLabel: "Approve",
    });
    if (!ok) return;
    setFlash(null);
    startTransition(async () => {
      const result = await approveFederationLinkAction(row.linkId);
      setFlash(
        result.ok
          ? { kind: "success", text: `Approved (link is now ${result.linkState}).` }
          : { kind: "error", text: `Approve failed: ${result.message}` },
      );
    });
  }

  async function onQuarantine(row: FederationLinkRow) {
    // Await the dialog OUTSIDE the transition (BI-FE7C543C).
    const reason = await promptDialog({
      title: "Quarantine federation link",
      message: `Quarantine "${row.displayName}" — reason (recorded):`,
      required: true,
      confirmLabel: "Quarantine",
    });
    if (!reason?.trim()) return;
    setFlash(null);
    startTransition(async () => {
      const result = await quarantineFederationLinkAction(row.linkId, reason.trim());
      setFlash(
        result.ok
          ? { kind: "success", text: `Quarantined ${row.displayName}.` }
          : { kind: "error", text: `Quarantine failed: ${result.message}` },
      );
    });
  }

  async function onRevoke(row: FederationLinkRow) {
    // Await the dialog OUTSIDE the transition (BI-FE7C543C).
    const reason = await promptDialog({
      title: "Revoke federation link",
      message: `Revoke "${row.displayName}"? This invalidates the link token immediately and cannot be undone. Reason (recorded):`,
      required: true,
      confirmLabel: "Revoke",
    });
    if (!reason?.trim()) return;
    setFlash(null);
    startTransition(async () => {
      const result = await revokeFederationLinkAction(row.linkId, reason.trim());
      setFlash(
        result.ok
          ? { kind: "success", text: `Revoked ${row.displayName}.` }
          : { kind: "error", text: `Revoke failed: ${result.message}` },
      );
    });
  }

  function onEnvironment(row: FederationLinkRow, environmentClass: FederationLinkRow["environmentClass"]) {
    setFlash(null);
    startTransition(async () => {
      const result = await setFederationLinkEnvironmentAction(row.linkId, environmentClass);
      setFlash(result.ok
        ? { kind: "success", text: `${row.displayName} is classified as ${environmentClass}.` }
        : { kind: "error", text: `Environment update failed: ${result.message}` });
    });
  }

  return (
    <div className="space-y-6">
      {flash && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{
            borderColor: flash.kind === "success" ? "var(--dpf-success)" : "var(--dpf-error)",
            color: flash.kind === "success" ? "var(--dpf-success)" : "var(--dpf-error)",
            backgroundColor: "var(--dpf-surface-1)",
          }}
        >
          {flash.text}
        </div>
      )}

      <section
        className="rounded border p-4"
        style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-1)" }}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
              {nearbyCandidates.length > 0 ? "DPF found nearby" : "Nearby DPF installations"}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">
              Discovery is only a setup suggestion. A connection starts only after both
              installations approve it.
            </p>
          </div>
          <StatusBadge
            label={nearbyDiscoveryHealth.label}
            intent={
              nearbyDiscoveryHealth.status === "healthy"
                ? "success"
                : nearbyDiscoveryHealth.status === "degraded"
                  ? "warning"
                  : "neutral"
            }
            variant="soft"
          />
          {nearbyDiscoveryHealth.status === "disabled" && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setNearbyDiscovery(true)}
              className="rounded px-3 py-1.5 text-xs font-medium text-[var(--dpf-bg)] disabled:opacity-50"
              style={{ backgroundColor: "var(--dpf-accent)" }}
            >
              Enable nearby discovery
            </button>
          )}
          {(nearbyDiscoveryHealth.status === "healthy" ||
            nearbyDiscoveryHealth.status === "waiting" ||
            nearbyDiscoveryHealth.status === "degraded") && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setNearbyDiscovery(false)}
              className="rounded border px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] disabled:opacity-50"
              style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-2)" }}
            >
              Pause discovery
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-[var(--dpf-muted)]">
          {nearbyDiscoveryHealth.detail}{" "}
          {(nearbyDiscoveryHealth.status === "disabled" ||
            nearbyDiscoveryHealth.status === "unavailable") && (
            <Link className="font-medium text-[var(--dpf-accent)]" href="/platform/edge-nodes">
              Open Edge Nodes
            </Link>
          )}
        </p>
        {nearbyCandidates.length === 0 ? (
          <p className="mt-3 rounded border p-3 text-sm text-[var(--dpf-muted)]" style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-2)" }}>
            No nearby DPF installations are visible right now. You can still use an invitation below.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {nearbyCandidates.map((candidate) => {
              const secure = candidate.automaticPairing !== "blocked-insecure-transport";
              return (
                <div
                  key={`${candidate.discoveryId}:${candidate.endpoint}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"
                  style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-2)" }}
                >
                  <div>
                    <p className="font-mono text-xs text-[var(--dpf-text)]">{candidate.endpoint}</p>
                    <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                      <span className="font-medium">Not connected</span> · {secure
                        ? "TLS will be verified before any invitation is sent."
                        : "Automatic pairing is blocked because this endpoint is not HTTPS."}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!secure || isPending}
                    onClick={() => selectNearbyCandidate(candidate)}
                    className="rounded px-3 py-1.5 text-sm font-medium text-[var(--dpf-bg)] disabled:opacity-50"
                    style={{ backgroundColor: secure ? "var(--dpf-accent)" : "var(--dpf-muted)" }}
                  >
                    {secure && isPending ? <InlineBusy label="Starting…" tone="current" /> : secure ? "Set up this DPF" : "Secure setup required"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {pairingRows.length > 0 && (
          <div className="mt-4 space-y-3" aria-live="polite">
            {pairingRows.map((pairing) => (
              <div
                key={pairing.pairingId}
                className="rounded border p-3"
                style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-2)" }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--dpf-text)]">
                      {pairing.direction === "incoming"
                        ? `${pairing.peerDisplayName} is asking to connect`
                        : `${pairing.peerDisplayName} is waiting for approval`}
                    </p>
                    <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                      Confirm this same code on both installations:
                    </p>
                    <code className="mt-1 block text-lg font-bold tracking-widest text-[var(--dpf-text)]">
                      {pairing.matchingCode}
                    </code>
                    <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                      Expires {new Date(pairing.expiresAt).toLocaleString()}.
                    </p>
                  </div>
                  <StatusBadge label={pairing.status} intent={pairing.status === "approved" ? "success" : "neutral"} variant="soft" />
                </div>
                <div className="mt-3 rounded border p-2 text-xs text-[var(--dpf-muted)]" style={{ borderColor: "var(--dpf-border)" }}>
                  <p><span className="font-medium text-[var(--dpf-text)]">Shares:</span> {pairing.sharedSlices.join(", ")} · retain: {pairing.retentionClass}</p>
                  <p className="mt-1"><span className="font-medium text-[var(--dpf-text)]">Stays here:</span> {pairing.staysLocal.join(", ")}</p>
                </div>
                {pairing.direction === "incoming" && pairing.status === "pending" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => onApprovePairing(pairing)}
                      className="rounded px-3 py-1.5 text-sm font-medium text-[var(--dpf-bg)] disabled:opacity-50"
                      style={{ backgroundColor: "var(--dpf-accent)" }}
                    >
                      {isPending ? <InlineBusy label="Approving…" tone="current" /> : "Approve this installation"}
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => onDenyPairing(pairing)}
                      className="rounded border px-3 py-1.5 text-sm font-medium text-[var(--dpf-text)] disabled:opacity-50"
                      style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-1)" }}
                    >
                      Deny
                    </button>
                  </div>
                )}
                {pairing.direction === "outgoing" && (pairing.status === "pending" || pairing.status === "approved") && (
                  <div className="mt-3"><InlineBusy label="Checking for approval…" /></div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Issue invitation */}
      <div
        className="rounded border p-4"
        style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-1)" }}
      >
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Invite a peer deployment</h2>
        <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">
          Issue a single-use invitation token. The peer redeems it at <code>POST /api/v1/federation/enroll</code>.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--dpf-muted)]">
            Relationship preset
            <select
              value={relationshipPreset}
              onChange={(e) => {
                const preset = e.target.value as "same-organization" | "service-provider" | "channel";
                setRelationshipPreset(preset);
                setRole(
                  preset === "same-organization"
                    ? "same-org-peer"
                    : preset === "channel"
                      ? "channel-upstream"
                      : "manages",
                );
              }}
              className="mt-1 block rounded border px-2 py-1 text-sm text-[var(--dpf-text)]"
              style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-2)" }}
            >
              <option value="same-organization">same organization</option>
              <option value="service-provider">service provider / customer</option>
              <option value="channel">reseller / founder channel</option>
            </select>
          </label>
          <label className="text-xs text-[var(--dpf-muted)]">
            Our role
            <select
              value={role}
              disabled={relationshipPreset === "same-organization"}
              onChange={(e) => setRole(e.target.value as typeof role)}
              className="mt-1 block rounded border px-2 py-1 text-sm text-[var(--dpf-text)]"
              style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-2)" }}
            >
              {relationshipPreset === "same-organization" && (
                <option value="same-org-peer">same-organization peer</option>
              )}
              {relationshipPreset === "service-provider" && (
                <>
                  <option value="manages">manages (we are the service provider)</option>
                  <option value="managed-by">managed-by (we are the customer)</option>
                </>
              )}
              {relationshipPreset === "channel" && (
                <>
                  <option value="channel-upstream">channel-upstream (we receive curated demand)</option>
                  <option value="channel-downstream">channel-downstream (we share curated demand)</option>
                </>
              )}
            </select>
          </label>
          <label className="text-xs text-[var(--dpf-muted)]">
            Expires (minutes)
            <input
              type="number"
              min={1}
              value={ttlMinutes}
              onChange={(e) => setTtlMinutes(Number(e.target.value) || 15)}
              className="mt-1 block w-24 rounded border px-2 py-1 text-sm text-[var(--dpf-text)]"
              style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-2)" }}
            />
          </label>
          <button
            type="button"
            onClick={onIssue}
            disabled={isPending}
            className="rounded px-3 py-1.5 text-sm font-medium text-[var(--dpf-bg)] disabled:opacity-50"
            style={{ backgroundColor: "var(--dpf-accent)" }}
          >
            Issue invitation
          </button>
        </div>
        {relationshipPreset === "same-organization" && (
          <p className="mt-3 rounded border p-2 text-xs text-[var(--dpf-muted)]" style={{ borderColor: "var(--dpf-border)" }}>
            Shared platform demand and dispositions are offered after both installations approve.
            Local backlog details, work capsules, private planning, attachments, and customer context stay local.
          </p>
        )}
        {relationshipPreset === "channel" && (
          <p className="mt-3 rounded border p-2 text-xs text-[var(--dpf-muted)]" style={{ borderColor: "var(--dpf-border)" }}>
            Each installation independently chooses what demand crosses this link and whether a reseller may forward it. This connection does not make this partner exclusive; other partners can have separate, non-overlapping scopes.
          </p>
        )}
        {issued && (
          <div
            className="mt-3 rounded border p-2"
            style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-2)" }}
          >
            <p className="text-xs text-[var(--dpf-muted)]">Invitation token (copy now — shown once):</p>
            <code className="mt-1 block break-all font-mono text-xs text-[var(--dpf-text)]">
              {issued.plaintext}
            </code>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              Expires {new Date(issued.expiresAt).toLocaleString()}.
            </p>
          </div>
        )}
      </div>

      {/* Connect to a peer (outbound enroll) */}
      <div
        className="rounded border p-4"
        style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-1)" }}
      >
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Connect to a peer</h2>
        <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">
          Redeem an invitation a peer issued you. Their link token is stored encrypted for outbound calls.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--dpf-muted)]">
            Peer URL
            <input
              value={peerUrl}
              onChange={(e) => setPeerUrl(e.target.value)}
              placeholder="https://peer.example"
              className="mt-1 block w-56 rounded border px-2 py-1 text-sm text-[var(--dpf-text)]"
              style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-2)" }}
            />
          </label>
          <label className="text-xs text-[var(--dpf-muted)]">
            Invitation token
            <input
              value={peerToken}
              onChange={(e) => setPeerToken(e.target.value)}
              placeholder="dpffboot_…"
              className="mt-1 block w-56 rounded border px-2 py-1 font-mono text-xs text-[var(--dpf-text)]"
              style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-2)" }}
            />
          </label>
          <label className="text-xs text-[var(--dpf-muted)]">
            Peer name
            <input
              value={peerName}
              onChange={(e) => setPeerName(e.target.value)}
              placeholder="Acme MSP"
              className="mt-1 block w-40 rounded border px-2 py-1 text-sm text-[var(--dpf-text)]"
              style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-2)" }}
            />
          </label>
          <button
            type="button"
            onClick={onConnect}
            disabled={isPending || !peerUrl.trim() || !peerToken.trim()}
            className="rounded px-3 py-1.5 text-sm font-medium text-[var(--dpf-bg)] disabled:opacity-50"
            style={{ backgroundColor: "var(--dpf-accent)" }}
          >
            Connect
          </button>
        </div>
      </div>

      {/* Links table */}
      <p className="text-xs text-[var(--dpf-muted)]">
        <span className="font-medium text-[var(--dpf-text)]">Shared scope</span> is exactly what crosses each
        link to the peer — the minimum-necessary projection enforced at egress. Nothing outside it leaves this
        deployment.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Peer</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Role</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">State</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Approvals</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Shared scope</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Environment</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Peer URL</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-[var(--dpf-muted)]">
                  No federation links yet. Invite a peer above, or accept an invitation from one.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.linkId} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                <td className="p-2 text-[var(--dpf-text)]">
                  {row.displayName}
                  {row.peerOrganizationRef && (
                    <span className="ml-1 text-xs text-[var(--dpf-muted)]">({row.peerOrganizationRef})</span>
                  )}
                </td>
                <td className="p-2 text-[var(--dpf-muted)]">{row.role}</td>
                <td className="p-2">
                  <StatusBadge domain="federationLinkState" status={row.linkState} />
                </td>
                <td className="p-2 text-xs text-[var(--dpf-muted)]">
                  ours {row.approvedLocal ? "✓" : "—"} · peer {row.approvedPeer ? "✓" : "—"}
                </td>
                <td className="p-2 text-xs">
                  <div className="flex flex-wrap gap-1">
                    {row.sharedSlices.map((s) => (
                      <span
                        key={s}
                        className="rounded px-1.5 py-0.5 text-[var(--dpf-text)]"
                        style={{ backgroundColor: "var(--dpf-surface-2)", border: "1px solid var(--dpf-border)" }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                  <span className="mt-0.5 block text-[var(--dpf-muted)]">retain: {row.sharedRetention}</span>
                </td>
                <td className="p-2">
                  <select
                    aria-label={`Environment for ${row.displayName}`}
                    value={row.environmentClass}
                    disabled={isPending || row.linkState === "revoked"}
                    onChange={(event) => onEnvironment(row, event.target.value as FederationLinkRow["environmentClass"])}
                    className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-text)] disabled:opacity-50"
                  >
                    <option value="production">production</option>
                    <option value="development">development</option>
                    <option value="test">test</option>
                  </select>
                </td>
                <td className="p-2 font-mono text-xs text-[var(--dpf-muted)]">{row.peerAuthorityUrl}</td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    {row.linkState === "pending" && (
                      <button
                        type="button"
                        onClick={() => onApprove(row)}
                        disabled={isPending}
                        className="rounded px-2 py-1 text-xs font-medium text-[var(--dpf-bg)] disabled:opacity-50"
                        style={{ backgroundColor: "var(--dpf-success)" }}
                      >
                        Approve
                      </button>
                    )}
                    {(row.linkState === "pending" || row.linkState === "trusted") && (
                      <button
                        type="button"
                        onClick={() => onQuarantine(row)}
                        disabled={isPending}
                        className="rounded px-2 py-1 text-xs font-medium text-[var(--dpf-bg)] disabled:opacity-50"
                        style={{ backgroundColor: "var(--dpf-warning)" }}
                      >
                        Quarantine
                      </button>
                    )}
                    {row.linkState !== "revoked" && (
                      <button
                        type="button"
                        onClick={() => onRevoke(row)}
                        disabled={isPending}
                        className="rounded px-2 py-1 text-xs font-medium text-[var(--dpf-bg)] disabled:opacity-50"
                        style={{ backgroundColor: "var(--dpf-error)" }}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
