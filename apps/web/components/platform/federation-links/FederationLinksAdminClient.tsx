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
  confirmNearbyPairingAction,
  denyNearbyPairingAction,
  enrollWithPeerAction,
  issueFederationBootstrapAction,
  pollNearbyPairingAction,
  quarantineFederationLinkAction,
  revokeFederationLinkAction,
  setFederationDiscoveryEnabledAction,
  setFederationLinkEnvironmentAction,
  setFederationIntroducerPolicyAction,
  startNearbyPairingAction,
} from "@/lib/actions/federation-links";
import type { NearbyFederationCandidate } from "@/lib/federation/nearby-candidates";
import type { NearbyDiscoveryHealth } from "@/lib/edge-node/readiness";
import { normalizeRecoveryAuthority } from "@/lib/federation/recovery-authority";
import { FederationLinksTable } from "./FederationLinksTable";

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
  offersIntroductions: boolean;
  acceptsIntroductions: boolean;
  createdAtISO: string;
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
  sasConfirmedAtLocal?: boolean;
  sasConfirmedAtPeer?: boolean;
}
type Flash = { kind: "success" | "error"; text: string } | null;
const PEER_CONFIRMATION_WAIT = "Waiting for the other installation…";
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
      sasConfirmedAtLocal: false,
      sasConfirmedAtPeer: false,
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
      title: "Confirm codes match",
      message: `Continue with ${row.peerDisplayName} only if its screen shows ${row.matchingCode} and you accept the sharing summary. Trust is not granted until both installations confirm.`,
      confirmLabel: "Codes match — approve",
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
  async function onConfirmOutgoingPairing(row: NearbyPairingRow) {
    const confirmed = await confirmDialog({
      title: "Confirm codes match",
      message: `Only continue if ${row.peerDisplayName} shows ${row.matchingCode}. Stop if the code differs.`,
      confirmLabel: "Codes match — continue",
    });
    if (!confirmed) return;
    startTransition(async () => {
      const result = await confirmNearbyPairingAction(row.pairingId);
      if (!result.ok) {
        setFlash({ kind: "error", text: `Code confirmation failed: ${result.message}` });
        return;
      }
      setActivePairing({ ...row, sasConfirmedAtLocal: true, status: result.status === "approved" ? "approved" : row.status });
      setFlash({ kind: "success", text: "Confirmed here. Waiting for the other installation." });
      router.refresh();
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
    const normalized = normalizeRecoveryAuthority(peerUrl);
    if (!normalized.ok) {
      setFlash({ kind: "error", text: normalized.message });
      return;
    }
    startTransition(async () => {
      const result = await enrollWithPeerAction({
        peerAuthorityUrl: normalized.authorityUrl,
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

  function onIntroducerPolicy(row: FederationLinkRow, field: "offersIntroductions" | "acceptsIntroductions", checked: boolean) {
    setFlash(null);
    startTransition(async () => {
      const result = await setFederationIntroducerPolicyAction(row.linkId, {
        offersIntroductions: field === "offersIntroductions" ? checked : row.offersIntroductions,
        acceptsIntroductions: field === "acceptsIntroductions" ? checked : row.acceptsIntroductions,
      });
      setFlash(result.ok
        ? { kind: "success", text: `Introduction policy updated for ${row.displayName}. Discovery candidates never inherit trust.` }
        : { kind: "error", text: `Introduction policy failed: ${result.message}` });
      if (result.ok) router.refresh();
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
              {nearbyCandidates.length > 0 ? "DPF installations available" : "Find DPF installations"}
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
            No DPF installations are visible right now. Discovery and trusted introducers refresh automatically. Recovery options are available below.
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
                    <p className="text-sm font-semibold text-[var(--dpf-text)]">
                      {candidate.displayName ?? "Nearby DPF installation"}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-[var(--dpf-muted)]">{candidate.endpoint}</p>
                    <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                      <span className="font-medium">Not connected</span>
                      {candidate.source === "introducer" && <> · Introduced by {candidate.introducedBy ?? "a trusted connection"}; trust is not transferred.</>}
                      {candidate.relationshipHint && <> · Suggested relationship: {candidate.relationshipHint}.</>} · {secure
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
                {pairing.direction === "incoming" && pairing.status === "pending" && !pairing.sasConfirmedAtLocal && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => onApprovePairing(pairing)}
                      className="rounded px-3 py-1.5 text-sm font-medium text-[var(--dpf-bg)] disabled:opacity-50"
                      style={{ backgroundColor: "var(--dpf-accent)" }}
                    >
                      {isPending ? <InlineBusy label="Confirming…" tone="current" /> : "Codes match — approve"}
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
                {pairing.direction === "incoming" && pairing.status === "pending" && pairing.sasConfirmedAtLocal &&
                  <div className="mt-3"><InlineBusy label={PEER_CONFIRMATION_WAIT} /></div>}
                {pairing.direction === "outgoing" && pairing.status === "pending" && !pairing.sasConfirmedAtLocal && (
                  <button
                    type="button"
                    data-dpf-primary-action
                    disabled={isPending}
                    onClick={() => onConfirmOutgoingPairing(pairing)}
                    className="mt-3 rounded px-3 py-1.5 text-sm font-medium text-[var(--dpf-bg)] disabled:opacity-50"
                    style={{ backgroundColor: "var(--dpf-accent)" }}
                  >
                    {isPending ? <InlineBusy label="Confirming…" tone="current" /> : "Codes match — continue"}
                  </button>
                )}
                {pairing.direction === "outgoing" && (pairing.status === "approved" || pairing.sasConfirmedAtLocal) &&
                  <div className="mt-3"><InlineBusy label={PEER_CONFIRMATION_WAIT} /></div>}
              </div>
            ))}
          </div>
        )}
      </section>

      <details
        className="rounded border p-4"
        style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-1)" }}
      >
        <summary className="cursor-pointer text-sm font-semibold text-[var(--dpf-text)]">
          Recovery and advanced connection options
        </summary>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          Use these only when discovery or a trusted introducer cannot reach the other installation.
        </p>
      {/* Issue invitation */}
      <div className="mt-4 rounded border p-4" style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-2)" }}>
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
        className="mt-4 rounded border p-4"
        style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-2)" }}
      >
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Connect to a peer</h2>
        <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">
          Redeem an invitation a peer issued you. Their link token is stored encrypted for outbound calls.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--dpf-muted)]">
            Installation host, IP, or origin
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
      </details>

      <FederationLinksTable
        rows={rows}
        isPending={isPending}
        onApprove={onApprove}
        onQuarantine={onQuarantine}
        onRevoke={onRevoke}
        onEnvironment={onEnvironment}
        onIntroducerPolicy={onIntroducerPolicy}
      />
    </div>
  );
}
