"use client";

import { useState, useTransition } from "react";

import { confirmDialog, promptDialog } from "@/components/ui/Dialog";
import { StatusBadge } from "@/components/ui/report-kit";
import {
  approveFederationLinkAction,
  enrollWithPeerAction,
  issueFederationBootstrapAction,
  quarantineFederationLinkAction,
  revokeFederationLinkAction,
} from "@/lib/actions/federation-links";

export interface FederationLinkRow {
  linkId: string;
  displayName: string;
  role: string;
  linkState: string;
  peerAuthorityUrl: string;
  peerOrganizationRef: string | null;
  approvedLocal: boolean;
  approvedPeer: boolean;
  createdAtISO: string;
}

type Flash = { kind: "success" | "error"; text: string } | null;

export function FederationLinksAdminClient({ rows }: { rows: FederationLinkRow[] }) {
  const [flash, setFlash] = useState<Flash>(null);
  const [role, setRole] = useState<"manages" | "managed-by">("manages");
  const [ttlMinutes, setTtlMinutes] = useState(15);
  const [issued, setIssued] = useState<{ plaintext: string; expiresAt: string } | null>(null);
  const [peerUrl, setPeerUrl] = useState("");
  const [peerToken, setPeerToken] = useState("");
  const [peerName, setPeerName] = useState("");
  const [isPending, startTransition] = useTransition();

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

  function onApprove(row: FederationLinkRow) {
    setFlash(null);
    startTransition(async () => {
      const ok = await confirmDialog({
        title: "Approve federation link",
        message: `Approve our side of "${row.displayName}"? The link becomes trusted only once the peer also approves.`,
        confirmLabel: "Approve",
      });
      if (!ok) return;
      const result = await approveFederationLinkAction(row.linkId);
      setFlash(
        result.ok
          ? { kind: "success", text: `Approved (link is now ${result.linkState}).` }
          : { kind: "error", text: `Approve failed: ${result.message}` },
      );
    });
  }

  function onQuarantine(row: FederationLinkRow) {
    setFlash(null);
    startTransition(async () => {
      const reason = await promptDialog({
        title: "Quarantine federation link",
        message: `Quarantine "${row.displayName}" — reason (recorded):`,
        required: true,
        confirmLabel: "Quarantine",
      });
      if (!reason?.trim()) return;
      const result = await quarantineFederationLinkAction(row.linkId, reason.trim());
      setFlash(
        result.ok
          ? { kind: "success", text: `Quarantined ${row.displayName}.` }
          : { kind: "error", text: `Quarantine failed: ${result.message}` },
      );
    });
  }

  function onRevoke(row: FederationLinkRow) {
    setFlash(null);
    startTransition(async () => {
      const reason = await promptDialog({
        title: "Revoke federation link",
        message: `Revoke "${row.displayName}"? This invalidates the link token immediately and cannot be undone. Reason (recorded):`,
        required: true,
        confirmLabel: "Revoke",
      });
      if (!reason?.trim()) return;
      const result = await revokeFederationLinkAction(row.linkId, reason.trim());
      setFlash(
        result.ok
          ? { kind: "success", text: `Revoked ${row.displayName}.` }
          : { kind: "error", text: `Revoke failed: ${result.message}` },
      );
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
            Our role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "manages" | "managed-by")}
              className="mt-1 block rounded border px-2 py-1 text-sm text-[var(--dpf-text)]"
              style={{ borderColor: "var(--dpf-border)", backgroundColor: "var(--dpf-surface-2)" }}
            >
              <option value="manages">manages (we are the MSP)</option>
              <option value="managed-by">managed-by (we are the customer)</option>
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
            className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--dpf-accent)" }}
          >
            Issue invitation
          </button>
        </div>
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
            className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--dpf-accent)" }}
          >
            Connect
          </button>
        </div>
      </div>

      {/* Links table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Peer</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Role</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">State</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Approvals</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Peer URL</th>
              <th className="p-2 text-left text-[var(--dpf-muted)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-[var(--dpf-muted)]">
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
                <td className="p-2 font-mono text-xs text-[var(--dpf-muted)]">{row.peerAuthorityUrl}</td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    {row.linkState === "pending" && (
                      <button
                        type="button"
                        onClick={() => onApprove(row)}
                        disabled={isPending}
                        className="rounded px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
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
                        className="rounded px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
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
                        className="rounded px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
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
