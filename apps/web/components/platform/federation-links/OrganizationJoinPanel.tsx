"use client";

// EP-ZERO-CONFIG-FEDERATION — connecting an organization's own installations.
// Spec: docs/superpowers/specs/2026-09-03-portal-mediated-organization-membership-design.md.
//
// Two portal-mediated acts, nothing else: the organization installation
// creates a one-time join file (it mints the file itself), and the joining
// installation chooses that file (it certifies itself through the organization
// installation's portal). No edge node, no host script, no "secure setup".

import { parseOrganizationJoinPackage, type OrganizationJoinPackagePreview } from "@dpf/db/organization-join-action";
import { useRef, useState, useTransition } from "react";

import {
  CheckboxField,
  FormField,
  FormStatus,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/ui/form";
import {
  importOrganizationJoinFileAction,
  issueOrganizationJoinFileAction,
} from "@/lib/actions/organization-join";

type PanelMode = "overview" | "issue" | "import";
type Notice = { kind: "success" | "error"; text: string } | null;

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

export function OrganizationJoinPanel({ candidates = [] }: { candidates?: OrganizationJoinCandidate[] }) {
  const [mode, setMode] = useState<PanelMode>("overview");
  const [candidateChoice, setCandidateChoice] = useState<string>(candidates[0]?.hostname ?? OTHER_INSTALLATION);
  const [intendedPeer, setIntendedPeer] = useState("");
  const [issueConfirmed, setIssueConfirmed] = useState(false);
  const [joinPackage, setJoinPackage] = useState<string | null>(null);
  const [packagePreview, setPackagePreview] = useState<OrganizationJoinPackagePreview | null>(null);
  const [importConfirmed, setImportConfirmed] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const chosenPeer = candidateChoice === OTHER_INSTALLATION ? intendedPeer.trim() : candidateChoice;

  function openMode(nextMode: "issue" | "import") {
    setMode(nextMode);
    setNotice(null);
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

      {mode === "issue" ? (
        <form className="mt-5 space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); issueJoinFile(); }}>
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
        <form className="mt-5 space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); importJoinFile(); }}>
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
    </section>
  );
}
