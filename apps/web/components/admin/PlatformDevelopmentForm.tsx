"use client";

import { useState, useTransition } from "react";
import { savePlatformDevConfig, acceptDco } from "@/lib/actions/platform-dev-config";

type ContributionMode = "fork_only" | "selective" | "contribute_all";

const MODE_OPTIONS: { value: ContributionMode; label: string; description: string }[] = [
  {
    value: "fork_only",
    label: "Keep everything here",
    description: "Changes you make in Build Studio stay on your platform only. Nothing is shared externally.",
  },
  {
    value: "selective",
    label: "Share selectively",
    description: "The AI coworker will suggest which changes might benefit the wider community. You decide each time.",
  },
  {
    value: "contribute_all",
    label: "Share everything",
    description: "Contribute all changes back to the community by default. You can still keep individual ones private.",
  },
];

const DCO_ITEMS = [
  "The contribution was created in whole or in part by me and I have the right to submit it under the open-source licence indicated in the file.",
  "The contribution is based upon previous work that, to the best of my knowledge, is covered under an appropriate open-source licence and I have the right under that licence to submit that work with modifications.",
  "The contribution was provided directly to me by some other person who certified (1) or (2) and I have not modified it.",
  "I understand and agree that this project and the contribution are public and that a record of the contribution (including all personal information I submit with it) is maintained indefinitely and may be redistributed consistent with this project or the open-source licence(s) involved.",
  "I am granting this contribution under the terms of the project licence (Apache-2.0 unless stated otherwise in the file header).",
];

interface PlatformDevelopmentFormProps {
  currentMode: ContributionMode | null;
  configuredAt: string | null;
  configuredByEmail: string | null;
  gitRemoteUrl?: string | null;
  dcoAcceptedAt?: string | null;
  dcoAcceptedByEmail?: string | null;
  untrackedFeatureCount?: number;
}

export function PlatformDevelopmentForm(props: PlatformDevelopmentFormProps) {
  const [selected, setSelected] = useState<ContributionMode>(props.currentMode ?? "selective");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [gitUrl, setGitUrl] = useState(props.gitRemoteUrl ?? "");
  const [gitToken, setGitToken] = useState("");
  const [showDcoDialog, setShowDcoDialog] = useState(false);
  const [dcoAccepted, setDcoAccepted] = useState(!!props.dcoAcceptedAt);
  const [dcoAcceptedAt, setDcoAcceptedAt] = useState(props.dcoAcceptedAt);
  const [dcoAcceptedByEmail, setDcoAcceptedByEmail] = useState(props.dcoAcceptedByEmail);
  const [dcoError, setDcoError] = useState<string | null>(null);

  const hasChanged =
    selected !== props.currentMode ||
    gitUrl !== (props.gitRemoteUrl ?? "") ||
    gitToken !== "";

  const handleSave = () => {
    setSaved(false);
    startTransition(async () => {
      await savePlatformDevConfig(selected);

      if (gitUrl !== (props.gitRemoteUrl ?? "")) {
        const { saveGitRemoteUrl } = await import("@/lib/actions/platform-dev-config");
        await saveGitRemoteUrl(gitUrl || null);
      }

      if (gitToken) {
        const { saveGitBackupCredential } = await import("@/lib/actions/platform-dev-config");
        await saveGitBackupCredential(gitToken);
        setGitToken("");
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  const handleAcceptDco = () => {
    setDcoError(null);
    startTransition(async () => {
      const result = await acceptDco();
      if (result.accepted) {
        setDcoAccepted(true);
        setDcoAcceptedAt(new Date().toISOString());
        setDcoAcceptedByEmail("you");
        setShowDcoDialog(false);
      } else {
        setDcoError(result.error ?? "Failed to accept DCO");
      }
    });
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">
          How do you want to manage your customisations?
        </h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          This controls what happens when Build Studio ships a feature.
        </p>
      </div>

      <div className="space-y-3">
        {MODE_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={[
              "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
              selected === opt.value
                ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)]/5"
                : "border-[var(--dpf-border)] hover:border-[var(--dpf-muted)]",
            ].join(" ")}
          >
            <input
              type="radio"
              name="contributionMode"
              value={opt.value}
              checked={selected === opt.value}
              onChange={() => { setSelected(opt.value); setSaved(false); }}
              className="mt-0.5 accent-[var(--dpf-accent)]"
            />
            <div>
              <span className="text-sm font-medium text-[var(--dpf-text)]">{opt.label}</span>
              <p className="text-xs text-[var(--dpf-muted)] mt-0.5">{opt.description}</p>
            </div>
          </label>
        ))}
      </div>

      {/* Git Repository URL — shown when fork_only is selected */}
      {selected === "fork_only" && (
        <div className="space-y-3 rounded-lg border border-[var(--dpf-border)] p-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">
              Git backup repository
            </h3>
            <p className="text-xs text-[var(--dpf-muted)]">
              Push completed features to a private git repository for safekeeping.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--dpf-text)] mb-1">
              Repository URL
            </label>
            <input
              type="url"
              value={gitUrl}
              onChange={(e) => { setGitUrl(e.target.value); setSaved(false); }}
              placeholder="https://github.com/your-org/your-repo.git"
              className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none"
            />
          </div>

          {gitUrl && (
            <div>
              <label className="block text-xs font-medium text-[var(--dpf-text)] mb-1">
                Access token
              </label>
              <input
                type="password"
                value={gitToken}
                onChange={(e) => { setGitToken(e.target.value); setSaved(false); }}
                placeholder="ghp_... or glpat-..."
                className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none"
              />
              <p className="text-xs text-[var(--dpf-muted)] mt-1">
                Token is encrypted at rest. Leave blank to keep the existing credential.
              </p>
            </div>
          )}

          {!gitUrl && (props.untrackedFeatureCount ?? 0) > 0 && (
            <div className="rounded border border-amber-400/50 bg-amber-400/10 px-3 py-2">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {props.untrackedFeatureCount} completed feature{props.untrackedFeatureCount === 1 ? "" : "s"} not yet backed up to a git repository.
              </p>
            </div>
          )}
        </div>
      )}

      {/* DCO Status — shown when selective or contribute_all is selected */}
      {(selected === "selective" || selected === "contribute_all") && (
        <div className="space-y-3 rounded-lg border border-[var(--dpf-border)] p-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">
              Developer Certificate of Origin (DCO)
            </h3>
            <p className="text-xs text-[var(--dpf-muted)]">
              Contributions require DCO sign-off to certify you have the right to submit the work.
            </p>
          </div>

          {dcoAccepted ? (
            <div className="rounded border border-green-500/50 bg-green-500/10 px-3 py-2">
              <p className="text-xs text-green-600 dark:text-green-400">
                DCO accepted by {dcoAcceptedByEmail ?? "unknown"} on{" "}
                {dcoAcceptedAt ? new Date(dcoAcceptedAt).toLocaleDateString() : "unknown date"}.
              </p>
            </div>
          ) : selected !== props.currentMode ? (
            <div className="rounded border border-amber-400/50 bg-amber-400/10 px-3 py-2">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Save your contribution mode first, then accept the DCO.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded border border-amber-400/50 bg-amber-400/10 px-3 py-2">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  DCO has not been accepted. Contributions cannot be submitted until the DCO is signed.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDcoDialog(true)}
                className="rounded px-3 py-1.5 text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-colors"
              >
                Accept DCO
              </button>
            </div>
          )}
        </div>
      )}

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isPending || (!hasChanged && props.currentMode !== null)}
          className={[
            "rounded px-4 py-1.5 text-sm font-medium transition-colors",
            isPending || (!hasChanged && props.currentMode !== null)
              ? "bg-[var(--dpf-border)] text-[var(--dpf-muted)] cursor-not-allowed"
              : "bg-[var(--dpf-accent)] text-white hover:opacity-90",
          ].join(" ")}
        >
          {isPending ? "Saving..." : "Save"}
        </button>
        {saved && <span className="text-xs text-green-500">Saved</span>}
      </div>

      {props.configuredAt && (
        <p className="text-xs text-[var(--dpf-muted)]">
          Last configured {new Date(props.configuredAt).toLocaleDateString()} by {props.configuredByEmail ?? "unknown"}
        </p>
      )}

      {/* DCO acceptance dialog */}
      {showDcoDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-lg rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-6 shadow-xl">
            <h3 className="text-base font-semibold text-[var(--dpf-text)] mb-3">
              Developer Certificate of Origin v1.1
            </h3>
            <p className="text-xs text-[var(--dpf-muted)] mb-3">
              By signing off, you certify the following:
            </p>
            <ol className="list-decimal list-inside space-y-2 mb-4">
              {DCO_ITEMS.map((item, i) => (
                <li key={i} className="text-xs text-[var(--dpf-text)] leading-relaxed">
                  {item}
                </li>
              ))}
            </ol>
            {dcoError && (
              <p className="text-xs text-red-500 mb-3">{dcoError}</p>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowDcoDialog(false); setDcoError(null); }}
                disabled={isPending}
                className="rounded px-3 py-1.5 text-sm font-medium border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:bg-[var(--dpf-border)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAcceptDco}
                disabled={isPending}
                className="rounded px-3 py-1.5 text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-colors disabled:opacity-50"
              >
                {isPending ? "Accepting..." : "I Accept"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
