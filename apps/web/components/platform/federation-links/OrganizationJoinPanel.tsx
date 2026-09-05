"use client";

import { parseOrganizationJoinPackage, type OrganizationJoinActionType, type OrganizationJoinPackagePreview } from "@dpf/db/organization-join-action";
import { useEffect, useRef, useState, useTransition } from "react";

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
  issueOrganizationJoinFileAction,
  type OrganizationJoinNodeSummary,
} from "@/lib/actions/organization-join";

type PanelMode = "overview" | "issue" | "import";
type Notice = { kind: "success" | "error"; text: string } | null;
type ActionState = NonNullable<OrganizationJoinNodeSummary["latestAction"]>;

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "timed-out"]);

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

/** A trusted same-organization installation the authority may issue a join file for. */
export interface OrganizationJoinCandidate {
  hostname: string;
  displayName: string;
}

const OTHER_INSTALLATION = "__other__";

function downloadText(fileName: string, content: string) {
  const blob = new Blob([content], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function OrganizationJoinPanel({ nodes, candidates = [] }: { nodes: OrganizationJoinNodeSummary[]; candidates?: OrganizationJoinCandidate[] }) {
  const [mode, setMode] = useState<PanelMode>("overview");
  const [candidateChoice, setCandidateChoice] = useState<string>(candidates[0]?.hostname ?? OTHER_INSTALLATION);
  const [intendedPeer, setIntendedPeer] = useState("");
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

  const chosenPeer = candidateChoice === OTHER_INSTALLATION ? intendedPeer.trim() : candidateChoice;

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
    // Both sides are portal-mediated: the authority mints the file itself and
    // the member imports it itself, so neither mode selects an edge node.
    setMode(nextMode);
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

  function issueJoinFile() {
    if (!issueConfirmed || !chosenPeer) return;
    startTransition(async () => {
      const result = await issueOrganizationJoinFileAction({ intendedPeer: chosenPeer });
      setIssueConfirmed(false);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.message });
        return;
      }
      downloadText(result.data.fileName, result.data.content);
      setNotice({ kind: "success", text: `Join file for ${result.data.intendedPeer} downloaded once. Choose it on that installation within 30 minutes.` });
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
          {mode === "issue" ? (
            <form className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); issueJoinFile(); }}>
              <SelectField
                name="intended-installation"
                label="Installation that will join"
                required
                value={candidateChoice}
                onValueChange={(value) => {
                  setCandidateChoice(value);
                  setIssueConfirmed(false);
                }}
                options={[
                  ...candidates.map((candidate) => ({ value: candidate.hostname, label: `${candidate.displayName} (${candidate.hostname})` })),
                  { value: OTHER_INSTALLATION, label: "Another installation…" },
                ]}
              />
              {candidateChoice === OTHER_INSTALLATION ? (
                <TextField
                  name="intended-installation-name"
                  label="Installation name"
                  required
                  autoComplete="off"
                  value={intendedPeer}
                  onValueChange={(value) => {
                    setIntendedPeer(value);
                    setIssueConfirmed(false);
                  }}
                  placeholder="192.168.0.200"
                />
              ) : null}
              {chosenPeer ? (
                <CheckboxField
                  name="confirm-intended-installation"
                  label={<>I confirm this file is for {chosenPeer}</>}
                  checked={issueConfirmed}
                  onCheckedChange={setIssueConfirmed}
                />
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton
                  pending={isPending}
                  pendingLabel="Creating…"
                  disabled={!issueConfirmed || !chosenPeer}
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
