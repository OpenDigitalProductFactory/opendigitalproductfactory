"use client";

import { parseOrganizationJoinPackage, type OrganizationJoinActionType, type OrganizationJoinPackagePreview } from "@dpf/db/organization-join-action";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { confirmDialog } from "@/components/ui/Dialog";
import { InlineBusy } from "@/components/ui/InlineBusy";
import {
  CheckboxField,
  FormField,
  FormStatus,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/ui/form";
import {
  authorizeOrganizationJoinNodeAction,
  cancelOrganizationJoinActionAction,
  downloadIssuedJoinPackageAction,
  getOrganizationJoinActionStatusAction,
  importOrganizationJoinFileAction,
  queueOrganizationJoinActionAction,
  type OrganizationJoinNodeSummary,
} from "@/lib/actions/organization-join";

type PanelMode = "overview" | "issue" | "import";
type Notice = { kind: "success" | "error"; text: string } | null;
type ActionState = NonNullable<OrganizationJoinNodeSummary["latestAction"]>;

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "timed-out"]);

function blocksNewRequest(action: ActionState | undefined): boolean {
  if (!action) return false;
  if (!TERMINAL_STATUSES.has(action.status)) return true;
  if (action.status !== "succeeded") return false;
  return action.actionType === "organization.join.import" || action.packageReady;
}

function safeEvidenceText(evidence: Record<string, unknown>, key: string): string | null {
  return typeof evidence[key] === "string" ? evidence[key] : null;
}

function recoveryMessage(evidence: Record<string, unknown>): string {
  switch (safeEvidenceText(evidence, "errorCode")) {
    case "join-package-expired":
      return "The join file expired. Create a new file on the organization installation.";
    case "join-package-intended-for-another-host":
      return "The join file was created for another installation.";
    case "portal-health-failed":
      return "The installation restored its previous settings because the portal health check failed.";
    case "edge-heartbeat-failed":
      return "The installation restored its previous settings because its secure host connection did not recover.";
    default:
      return "Secure setup did not finish. Review the technical details, then try again with a new join file.";
  }
}

function ActionProgress({
  action,
  node,
  busy,
  onCancel,
  onDownload,
}: {
  action: ActionState;
  node: OrganizationJoinNodeSummary;
  busy: boolean;
  onCancel: () => void;
  onDownload: () => void;
}) {
  const verification = [
    ["certificateTrust", "Certificate trust"],
    ["overlayPersistence", "Saved organization settings"],
    ["portalHealth", "Portal health"],
    ["edgeHeartbeat", "Secure host connection"],
  ] as const;

  let message = `Secure setup status: ${action.status}.`;
  if (action.status === "queued") message = `Approved and waiting for ${node.displayName}`;
  if (action.status === "claimed" || action.status === "running") message = `${node.displayName} is applying and checking the secure setup.`;
  if (action.status === "succeeded" && action.actionType === "organization.join.issue") {
    message = action.packageReady ? "The one-time join file is ready to download." : "The join file has already been downloaded or expired.";
  }
  if (action.status === "succeeded" && action.actionType === "organization.join.import") {
    message = "This installation joined the organization and passed its local checks.";
  }
  if (action.status === "failed" || action.status === "timed-out") message = recoveryMessage(action.evidence);
  if (action.status === "cancelled") message = "The secure setup request was cancelled before it started.";

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4" aria-live="polite">
      <p className="text-sm font-medium text-[var(--dpf-text)]">{message}</p>
      {action.status === "succeeded" && action.actionType === "organization.join.import" ? (
        <ul className="mt-3 grid gap-1 text-sm text-[var(--dpf-muted)] sm:grid-cols-2">
          {verification.map(([key, label]) => (
            <li key={key}>{action.evidence[key] === true ? "Passed" : "Not confirmed"}: {label}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {action.status === "queued" ? (
          <button type="button" className="rounded-md border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-text)]" disabled={busy} onClick={onCancel}>
            {busy ? <InlineBusy label="Cancelling…" /> : "Cancel request"}
          </button>
        ) : null}
        {action.status === "succeeded" && action.actionType === "organization.join.issue" && action.packageReady ? (
          <button type="button" className="rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-[var(--dpf-bg)]" disabled={busy} onClick={onDownload}>
            {busy ? <InlineBusy label="Preparing file…" tone="current" /> : "Download join file"}
          </button>
        ) : null}
      </div>
      <details className="mt-3 text-sm text-[var(--dpf-muted)]">
        <summary className="cursor-pointer text-[var(--dpf-accent)]">Technical details</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all">
          <dt>Installation</dt><dd>{node.nodeId}</dd>
          <dt>Request</dt><dd>{action.actionKey}</dd>
          <dt>Status</dt><dd>{action.status}</dd>
          {safeEvidenceText(action.evidence, "errorCode") ? <><dt>Error code</dt><dd>{safeEvidenceText(action.evidence, "errorCode")}</dd></> : null}
        </dl>
      </details>
    </div>
  );
}

export function OrganizationJoinPanel({ nodes }: { nodes: OrganizationJoinNodeSummary[] }) {
  const [mode, setMode] = useState<PanelMode>("overview");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [intendedPeer, setIntendedPeer] = useState("");
  const [ttlSeconds, setTtlSeconds] = useState(600);
  const [issueConfirmed, setIssueConfirmed] = useState(false);
  const [joinPackage, setJoinPackage] = useState<string | null>(null);
  const [packagePreview, setPackagePreview] = useState<OrganizationJoinPackagePreview | null>(null);
  const [importConfirmed, setImportConfirmed] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [actions, setActions] = useState<Record<string, ActionState>>(() => Object.fromEntries(
    nodes.flatMap((node) => node.latestAction ? [[node.edgeNodeId, node.latestAction]] : []),
  ));
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const authorityNodes = useMemo(() => nodes.filter((node) => node.role === "authority"), [nodes]);
  const selectedNode = nodes.find((node) => node.edgeNodeId === selectedNodeId) ?? null;

  useEffect(() => {
    const active = Object.entries(actions).find(([, action]) => !TERMINAL_STATUSES.has(action.status));
    if (!active) return;
    const [edgeNodeId, action] = active;
    const timer = window.setTimeout(() => {
      void getOrganizationJoinActionStatusAction(action.actionKey).then((result) => {
        if (!result.ok) {
          setNotice({ kind: "error", text: result.message });
          return;
        }
        setActions((current) => ({
          ...current,
          [edgeNodeId]: {
            ...action,
            actionType: result.actionType as OrganizationJoinActionType,
            status: result.status,
            approvalState: result.approvalState,
            packageReady: result.packageReady,
            evidence: result.evidence,
          },
        }));
      });
    }, 2_500);
    return () => window.clearTimeout(timer);
  }, [actions]);

  function openMode(nextMode: "issue" | "import") {
    // Joining is portal-mediated: choosing the file is the whole act, so the
    // import side selects no installation. Issuing still runs on the authority's
    // host action until that side is portal-mediated too.
    setMode(nextMode);
    setSelectedNodeId(nextMode === "issue" ? authorityNodes[0]?.edgeNodeId ?? null : null);
    setNotice(null);
  }

  async function authorize(node: OrganizationJoinNodeSummary) {
    if (!node.actionType) {
      setNotice({ kind: "error", text: node.readinessMessage });
      return;
    }
    const confirmed = await confirmDialog({
      title: "Enable secure setup",
      message: `Allow only the ${node.actionType === "organization.join.issue" ? "join-file creation" : "organization join"} action on ${node.displayName}?`,
      confirmLabel: "Enable secure setup",
    });
    if (!confirmed) return;
    startTransition(async () => {
      const result = await authorizeOrganizationJoinNodeAction({
        edgeNodeId: node.edgeNodeId,
        actionType: node.actionType!,
        operatorConfirmed: true,
      });
      setNotice(result.ok
        ? { kind: "success", text: `Secure setup enabled for ${node.displayName}. Refresh this page to continue.` }
        : { kind: "error", text: result.message });
    });
  }

  function queueIssue() {
    if (!selectedNode || !issueConfirmed || !intendedPeer.trim()) return;
    startTransition(async () => {
      const result = await queueOrganizationJoinActionAction({
        actionType: "organization.join.issue",
        edgeNodeId: selectedNode.edgeNodeId,
        parameters: { intendedPeer: intendedPeer.trim(), ttlSeconds },
        operatorConfirmed: true,
      });
      if (!result.ok) {
        setNotice({ kind: "error", text: result.message });
        return;
      }
      setActions((current) => ({
        ...current,
        [selectedNode.edgeNodeId]: {
          actionKey: result.actionKey,
          actionType: "organization.join.issue",
          status: "queued",
          approvalState: "approved",
          packageReady: false,
          evidence: { intendedPeer: intendedPeer.trim() },
          createdAt: new Date().toISOString(),
        },
      }));
      setNotice({ kind: "success", text: "Join file request approved. The installation will create it shortly." });
    });
  }

  async function readJoinFile(file: File | undefined) {
    setNotice(null);
    setJoinPackage(null);
    setPackagePreview(null);
    setImportConfirmed(false);
    if (!file) return;
    if (file.size > 64 * 1024) {
      setNotice({ kind: "error", text: "This join file is larger than DPF allows." });
      return;
    }
    const raw = await file.text();
    const parsed = parseOrganizationJoinPackage(raw);
    if (!parsed.ok) {
      setNotice({ kind: "error", text: parsed.reason === "join-package-expired" ? "This join file has expired. Create a new one." : "This is not a valid DPF organization join file." });
      return;
    }
    setJoinPackage(raw);
    setPackagePreview(parsed.value);
  }

  function importJoinFile() {
    if (!joinPackage || !importConfirmed) return;
    startTransition(async () => {
      const result = await importOrganizationJoinFileAction(joinPackage);
      setJoinPackage(null);
      setPackagePreview(null);
      setImportConfirmed(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (!result.ok) {
        setNotice({ kind: "error", text: result.message });
        return;
      }
      setNotice({ kind: "success", text: result.data.message });
    });
  }

  function cancel(node: OrganizationJoinNodeSummary, action: ActionState) {
    startTransition(async () => {
      const result = await cancelOrganizationJoinActionAction(action.actionKey);
      if (!result.ok) setNotice({ kind: "error", text: result.message });
      else setActions((current) => ({ ...current, [node.edgeNodeId]: { ...action, status: "cancelled" } }));
    });
  }

  function download(node: OrganizationJoinNodeSummary, action: ActionState) {
    startTransition(async () => {
      const result = await downloadIssuedJoinPackageAction(action.actionKey);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.message });
        return;
      }
      const url = URL.createObjectURL(new Blob([result.content], { type: "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      link.click();
      URL.revokeObjectURL(url);
      setActions((current) => ({ ...current, [node.edgeNodeId]: { ...action, packageReady: false } }));
      setNotice({ kind: "success", text: "Join file downloaded once. Move it to the installation that will join." });
    });
  }

  const visibleNodes = mode === "issue" ? authorityNodes : mode === "import" ? [] : nodes;

  return (
    <section className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5" aria-labelledby="organization-join-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="organization-join-heading" className="text-lg font-semibold text-[var(--dpf-text)]">Connect your own installations</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--dpf-muted)]">
            Create a short-lived file on your organization installation, then choose it on the installation joining your organization. No commands, certificate copying, or CA password handling.
          </p>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            This establishes machine trust. It does not share backlog data; sharing is chosen and approved separately in Delivery Flow.
          </p>
        </div>
        {mode !== "overview" ? (
          <button type="button" className="min-h-11 rounded-md px-3 text-sm text-[var(--dpf-accent)]" onClick={() => setMode("overview")}>Back to choices</button>
        ) : null}
      </div>

      {notice && mode === "overview" ? (
        <FormStatus
          error={notice.kind === "error" ? notice.text : null}
          success={notice.kind === "success" ? notice.text : null}
          className="mt-4 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
        />
      ) : null}

      {mode === "overview" ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button type="button" aria-label="Create join file" className="rounded-lg border border-[var(--dpf-border)] p-4 text-left hover:border-[var(--dpf-accent)]" onClick={() => openMode("issue")}>
            <span className="block font-medium text-[var(--dpf-text)]">Create join file</span>
            <span className="mt-1 block text-sm text-[var(--dpf-muted)]">Use your organization installation to create a one-time file for another installation.</span>
          </button>
          <button type="button" aria-label="Join this installation" className="rounded-lg border border-[var(--dpf-border)] p-4 text-left hover:border-[var(--dpf-accent)]" onClick={() => openMode("import")}>
            <span className="block font-medium text-[var(--dpf-text)]">Join this installation</span>
            <span className="mt-1 block text-sm text-[var(--dpf-muted)]">Choose the one-time file on the installation that will join your organization.</span>
          </button>
        </div>
      ) : null}

      {mode === "overview" ? nodes.filter((node) => !node.ready).map((node) => (
        <div key={node.edgeNodeId} className="mt-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
          <p className="text-sm font-medium text-[var(--dpf-text)]">{node.displayName}</p>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">{node.readinessMessage}</p>
          {node.trustState === "trusted" && node.actionType ? (
            <button type="button" className="mt-3 rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-[var(--dpf-bg)]" disabled={isPending} onClick={() => void authorize(node)}>
              {isPending ? <InlineBusy label="Enabling…" tone="current" /> : "Enable secure setup"}
            </button>
          ) : null}
        </div>
      )) : null}

      {mode !== "overview" ? (
        <div className="mt-5 space-y-4">
          {visibleNodes.length > 1 ? (
            <SelectField
              name="organization-join-installation"
              label="Installation"
              value={selectedNodeId ?? ""}
              onValueChange={setSelectedNodeId}
              options={visibleNodes.map((node) => ({ value: node.edgeNodeId, label: node.displayName }))}
              required
            />
          ) : null}
          {mode === "issue" && !selectedNode ? <p className="text-sm text-[var(--dpf-muted)]">No installation has reported the required organization role yet.</p> : null}
          {selectedNode && !selectedNode.ready ? (
            <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
              <p className="text-sm text-[var(--dpf-text)]">{selectedNode.readinessMessage}</p>
              {selectedNode.trustState === "trusted" && selectedNode.actionType ? (
                <button type="button" className="mt-3 rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-[var(--dpf-bg)]" disabled={isPending} onClick={() => void authorize(selectedNode)}>
                  {isPending ? <InlineBusy label="Enabling…" tone="current" /> : "Enable secure setup"}
                </button>
              ) : null}
            </div>
          ) : null}
          {selectedNode && actions[selectedNode.edgeNodeId] ? (
            <ActionProgress action={actions[selectedNode.edgeNodeId]} node={selectedNode} busy={isPending} onCancel={() => cancel(selectedNode, actions[selectedNode.edgeNodeId])} onDownload={() => download(selectedNode, actions[selectedNode.edgeNodeId])} />
          ) : null}

          {mode === "issue" && selectedNode?.ready && !blocksNewRequest(actions[selectedNode.edgeNodeId]) ? (
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); queueIssue(); }}>
              <TextField
                name="intended-installation"
                label="Installation name"
                required
                autoComplete="off"
                value={intendedPeer}
                onValueChange={(value) => {
                  setIntendedPeer(value);
                  setIssueConfirmed(false);
                }}
                placeholder="windows-office.local"
              />
              <SelectField
                name="join-file-expiry"
                label="Join file expiry"
                required
                value={String(ttlSeconds)}
                onValueChange={(value) => setTtlSeconds(Number(value))}
                options={[
                  { value: "300", label: "5 minutes" },
                  { value: "600", label: "10 minutes" },
                  { value: "900", label: "15 minutes" },
                ]}
              />
              {intendedPeer.trim() ? (
                <CheckboxField
                  name="confirm-intended-installation"
                  label={<>I confirm this file is for {intendedPeer.trim()}</>}
                  checked={issueConfirmed}
                  onCheckedChange={setIssueConfirmed}
                />
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton
                  pending={isPending}
                  pendingLabel="Creating…"
                  disabled={!issueConfirmed || !intendedPeer.trim()}
                  data-dpf-primary-action
                >
                  Create one-time file
                </SubmitButton>
                <FormStatus
                  error={notice?.kind === "error" ? notice.text : null}
                  success={notice?.kind === "success" ? notice.text : null}
                />
              </div>
            </form>
          ) : null}

          {mode === "import" ? (
            <form className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); importJoinFile(); }}>
              <FormField name="organization-join-file" label="Choose a .dpfjoin file" required>
                {(control) => (
                  <input
                    {...control}
                    ref={fileInputRef}
                    type="file"
                    accept=".dpfjoin,application/octet-stream"
                    className="block w-full text-sm text-[var(--dpf-muted)]"
                    onChange={(event) => void readJoinFile(event.target.files?.[0])}
                  />
                )}
              </FormField>
              {packagePreview ? (
                <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4 text-sm text-[var(--dpf-text)]">
                  <p className="font-medium">Join file preview</p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all text-[var(--dpf-muted)]">
                    <dt>Organization host</dt><dd>{new URL(packagePreview.caUrl).host}</dd>
                    <dt>For installation</dt><dd>{packagePreview.intendedPeer}</dd>
                    <dt>Expires</dt><dd>{packagePreview.expiresAt.toLocaleString()}</dd>
                    <dt>Trust fingerprint</dt><dd>{packagePreview.rootFingerprint.slice(0, 12)}…</dd>
                  </dl>
                </div>
              ) : null}
              {packagePreview ? (
                <CheckboxField
                  name="confirm-organization-join"
                  label={<>I confirm this file is for {packagePreview.intendedPeer} and I want this installation to join that organization.</>}
                  checked={importConfirmed}
                  onCheckedChange={setImportConfirmed}
                />
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton
                  pending={isPending}
                  pendingLabel="Joining…"
                  disabled={!packagePreview || !importConfirmed}
                  data-dpf-primary-action
                >
                  Join organization
                </SubmitButton>
                <FormStatus
                  error={notice?.kind === "error" ? notice.text : null}
                  success={notice?.kind === "success" ? notice.text : null}
                />
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      {mode === "overview" ? nodes.flatMap((node) => actions[node.edgeNodeId] ? [
        <div key={node.edgeNodeId} className="mt-4"><ActionProgress action={actions[node.edgeNodeId]} node={node} busy={isPending} onCancel={() => cancel(node, actions[node.edgeNodeId])} onDownload={() => download(node, actions[node.edgeNodeId])} /></div>,
      ] : []) : null}
    </section>
  );
}
