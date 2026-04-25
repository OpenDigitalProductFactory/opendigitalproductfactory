"use client";

import { useState, useTransition } from "react";

import { AdvancedTokenPaste } from "@/components/admin/AdvancedTokenPaste";
import {
  ConnectGitHubCard,
  type ConnectedState,
} from "@/components/admin/ConnectGitHubCard";
import {
  acceptDco,
  savePlatformDevConfig,
} from "@/lib/actions/platform-dev-config";

type ContributionMode = "fork_only" | "selective" | "contribute_all";

// ─── Mode Options ──────────────────────────────────────────────────────────

const MODE_OPTIONS: { value: ContributionMode; label: string; description: string }[] = [
  {
    value: "fork_only",
    label: "Keep everything here",
    description:
      "Changes you make in Build Studio stay on your platform only. Nothing is shared externally.",
  },
  {
    value: "selective",
    label: "Share selectively",
    description:
      "After building a feature, the AI will ask if you'd like to share it with the community. You decide each time.",
  },
  {
    value: "contribute_all",
    label: "Share everything",
    description:
      "Features you build are shared with the community by default. You can still keep individual ones private.",
  },
];

// ─── Wizard Steps for Contribution Setup ────────────────────────────────────
//
// 2026-04-24 GitHub auth 2FA readiness spec (Phase 5): the create-token and
// paste-token wizard steps are removed. Token acquisition now happens through
// ConnectGitHubCard (Device Flow primary) or AdvancedTokenPaste (paste fallback)
// surfaces, both rendered after DCO acceptance.
type WizardStep = "mode" | "explain" | "github-account" | "connect" | "dco" | "done";

// ─── DCO Items ──────────────────────────────────────────────────────────────

function buildDcoItems(pseudonym: string | null): string[] {
  const identityItem = pseudonym
    ? `I understand that shared features become part of the public project. My contributions carry a stable pseudonym (${pseudonym}) so the community can recognize repeat contributors, but reveal nothing about my real identity.`
    : "I understand that shared features become part of the public project. My contributions carry a stable pseudonym so the community can recognize repeat contributors, but reveal nothing about my real identity.";
  return [
    "The features I share are my original work, or based on work I have the right to share.",
    "I give permission for others to use these features under the Apache License 2.0, the same license as the platform itself.",
    identityItem,
  ];
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface PlatformDevelopmentFormProps {
  policyState: "policy_pending" | "private" | "contributing";
  currentMode: ContributionMode | null;
  configuredAt: string | null;
  configuredByEmail: string | null;
  gitRemoteUrl?: string | null;
  dcoAcceptedAt?: string | null;
  dcoAcceptedByEmail?: string | null;
  untrackedFeatureCount?: number;
  hasGitCredential?: boolean;
  hasContributionToken?: boolean;
  pseudonym?: string | null;
  /**
   * Server-resolved snapshot of the current GitHub credential. Non-null only
   * when the stored token is a Device-Flow token (`gho_` prefix) — paste-mode
   * PATs are not surfaced as "connected as @user" because we don't proactively
   * probe their owner. See the parent page for the resolution logic.
   */
  initialConnected?: ConnectedState | null;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PlatformDevelopmentForm(props: PlatformDevelopmentFormProps) {
  const [selected, setSelected] = useState<ContributionMode>(props.currentMode ?? "selective");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  // Wizard state
  const isContributionMode = selected === "selective" || selected === "contribute_all";
  const isAlreadySetUp = isContributionMode && !!props.dcoAcceptedAt;
  const [wizardStep, setWizardStep] = useState<WizardStep>(isAlreadySetUp ? "done" : "mode");
  const [dcoError, setDcoError] = useState<string | null>(null);

  // Fork-only git backup state
  const [gitUrl, setGitUrl] = useState(props.gitRemoteUrl ?? "");
  const [gitToken, setGitToken] = useState("");

  const handleModeSelect = (mode: ContributionMode) => {
    setSelected(mode);
    setSaved(false);
    if (mode === "fork_only") {
      setWizardStep("mode");
    }
  };

  const handleForkOnlySave = () => {
    setSaved(false);
    startTransition(async () => {
      await savePlatformDevConfig("fork_only");

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

  const handleStartWizard = () => {
    setWizardStep("explain");
  };

  const handleCompleteDco = () => {
    setDcoError(null);
    startTransition(async () => {
      // Persist contribution mode if not already saved.
      await savePlatformDevConfig(selected);

      const dcoResult = await acceptDco();
      if (!dcoResult.accepted) {
        setDcoError(dcoResult.error ?? "Could not accept the contributor agreement.");
        return;
      }

      setWizardStep("done");
    });
  };

  const handleReconfigure = () => {
    // Route into the connect step so admins can rotate / replace their token.
    setWizardStep("connect");
  };

  return (
    <div className="max-w-xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">
          Platform development policy
        </h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          This governs how features move from the shared development workspace into production
          and, if enabled, into community contribution workflows.
        </p>
      </div>

      {props.policyState === "policy_pending" && (
        <div className="rounded-lg border border-[var(--dpf-accent)]/30 bg-[var(--dpf-accent)]/5 p-4">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">
            Finish this before shipping features
          </h3>
          <p className="text-xs text-[var(--dpf-text)] leading-relaxed">
            Build Studio and, in customizable installs, VS Code can both work in the same shared
            workspace before this is configured. Production promotion and Hive Mind contribution
            stay blocked until you choose how this install should be governed.
          </p>
        </div>
      )}

      {/* Mode Selection — always visible */}
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
              onChange={() => handleModeSelect(opt.value)}
              className="mt-0.5 accent-[var(--dpf-accent)]"
            />
            <div>
              <span className="text-sm font-medium text-[var(--dpf-text)]">{opt.label}</span>
              <p className="text-xs text-[var(--dpf-muted)] mt-0.5">{opt.description}</p>
            </div>
          </label>
        ))}
      </div>

      {/* ─── Fork Only: Git Backup ──────────────────────────────────────── */}
      {selected === "fork_only" && (
        <div className="space-y-3 rounded-lg border border-[var(--dpf-border)] p-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">
              Backup your work (optional)
            </h3>
            <p className="text-xs text-[var(--dpf-muted)]">
              Save completed features to an online repository for safekeeping. If anything happens
              to your system, your work is protected.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--dpf-text)] mb-1">
              Repository URL
            </label>
            <input
              type="url"
              value={gitUrl}
              onChange={(e) => {
                setGitUrl(e.target.value);
                setSaved(false);
              }}
              placeholder="https://github.com/your-name/your-repo.git"
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
                onChange={(e) => {
                  setGitToken(e.target.value);
                  setSaved(false);
                }}
                placeholder="ghp_... or glpat-..."
                className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none"
              />
              <p className="text-xs text-[var(--dpf-muted)] mt-1">
                Encrypted and stored securely. Leave blank to keep the existing credential.
              </p>
            </div>
          )}

          {!gitUrl && (props.untrackedFeatureCount ?? 0) > 0 && (
            <div className="rounded border border-amber-400/50 bg-amber-400/10 px-3 py-2">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {props.untrackedFeatureCount} completed feature
                {props.untrackedFeatureCount === 1 ? "" : "s"} not yet backed up.
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleForkOnlySave}
              disabled={isPending}
              className={[
                "rounded px-4 py-1.5 text-sm font-medium transition-colors",
                isPending
                  ? "bg-[var(--dpf-border)] text-[var(--dpf-muted)] cursor-not-allowed"
                  : "bg-[var(--dpf-accent)] text-white hover:opacity-90",
              ].join(" ")}
            >
              {isPending ? "Saving..." : "Save"}
            </button>
            {saved && <span className="text-xs text-green-500">Saved</span>}
          </div>
        </div>
      )}

      {/* ─── Contribution Modes: Guided Wizard ──────────────────────────── */}
      {isContributionMode && wizardStep === "mode" && !isAlreadySetUp && (
        <div className="rounded-lg border border-[var(--dpf-accent)]/30 bg-[var(--dpf-accent)]/5 p-4">
          <p className="text-sm text-[var(--dpf-text)] mb-3">
            To share features with the community, we need to connect your platform to GitHub. Your
            code still lives in this install&apos;s shared workspace; GitHub is only used when you
            choose to contribute governed changes upstream.
          </p>
          <button
            onClick={handleStartWizard}
            className="rounded px-4 py-1.5 text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-colors"
          >
            Set up sharing
          </button>
        </div>
      )}

      {/* Step 1: Explain what contributions are */}
      {isContributionMode && wizardStep === "explain" && (
        <WizardCard step={1} total={3} title="How sharing works">
          <div className="space-y-2 text-xs text-[var(--dpf-text)] leading-relaxed">
            <p>
              When the AI Coworker finishes building a feature for you, it can propose sharing
              that feature with the wider community of platform users. The shared workspace for
              this install remains your system of local record.
            </p>
            <p>
              Shared features are submitted as a <strong>proposed change</strong> to the community
              repository. A maintainer reviews the proposal before it becomes available to others.
            </p>
            <p>
              Your contributions are <strong>pseudonymous</strong>
              {props.pseudonym ? (
                <>
                  {" "}— they appear on the community repository as{" "}
                  <span className="font-mono text-[var(--dpf-accent)]">{props.pseudonym}</span>.
                </>
              ) : (
                <> — they appear under a stable handle derived from this install.</>
              )}{" "}
              The handle is the same across all your contributions so the community can recognize
              repeat contributors, but reveals nothing about you or your organization.
            </p>
            <p>
              {selected === "selective"
                ? "You'll be asked each time whether to share or keep a feature private."
                : "Features are shared by default, but you can keep any individual one private."}
            </p>
          </div>
          <div className="flex justify-between items-center mt-4">
            <button
              onClick={() => setWizardStep("github-account")}
              className="text-xs text-[var(--dpf-accent)] hover:underline"
            >
              Use my GitHub account for attributed contributions
            </button>
            <button
              onClick={() => setWizardStep("dco")}
              className="rounded px-4 py-1.5 text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-colors"
            >
              Next
            </button>
          </div>
        </WizardCard>
      )}

      {/* Step 2: GitHub account info (informational only) */}
      {isContributionMode && wizardStep === "github-account" && (
        <WizardCard step={2} total={3} title="GitHub account">
          <div className="space-y-3 text-xs text-[var(--dpf-text)] leading-relaxed">
            <p>
              Contributions are submitted through <strong>GitHub</strong>. If you don&apos;t have
              an account yet, create one first at{" "}
              <span className="font-mono text-[var(--dpf-accent)]">github.com/signup</span>.
            </p>
            <p>
              Once you have an account, click <strong>Next</strong> to authorize this install via
              GitHub&apos;s standard Device Flow — no copy-pasting tokens.
            </p>
          </div>
          <div className="flex justify-between mt-4">
            <button
              onClick={() => setWizardStep("explain")}
              className="rounded px-3 py-1.5 text-sm font-medium border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:bg-[var(--dpf-border)] transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => setWizardStep("dco")}
              className="rounded px-4 py-1.5 text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-colors"
            >
              Next
            </button>
          </div>
        </WizardCard>
      )}

      {/* Step: DCO acceptance */}
      {isContributionMode && wizardStep === "dco" && (
        <WizardCard step={3} total={3} title="Contributor agreement">
          <div className="space-y-3">
            {props.pseudonym && (
              <div className="rounded border border-[var(--dpf-accent)]/40 bg-[var(--dpf-accent)]/5 px-3 py-2">
                <p className="text-xs text-[var(--dpf-text)] leading-relaxed">
                  Contributions from this install will appear publicly as{" "}
                  <span className="font-mono text-[var(--dpf-accent)]">{props.pseudonym}</span>.
                </p>
              </div>
            )}
            <p className="text-xs text-[var(--dpf-text)] leading-relaxed">
              Before sharing features, please confirm that you agree to the following:
            </p>
            <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 space-y-2">
              {buildDcoItems(props.pseudonym ?? null).map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-xs text-[var(--dpf-text)]"
                >
                  <span className="text-[var(--dpf-accent)] font-bold mt-0.5">{i + 1}.</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
            {dcoError && (
              <div className="rounded border border-red-400/50 bg-red-400/10 px-3 py-2">
                <p className="text-xs text-red-600 dark:text-red-400">{dcoError}</p>
              </div>
            )}
          </div>
          <div className="flex justify-between mt-4">
            <button
              onClick={() => setWizardStep("explain")}
              className="rounded px-3 py-1.5 text-sm font-medium border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:bg-[var(--dpf-border)] transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleCompleteDco}
              disabled={isPending}
              className={[
                "rounded px-4 py-1.5 text-sm font-medium transition-colors",
                isPending
                  ? "bg-[var(--dpf-border)] text-[var(--dpf-muted)] cursor-not-allowed"
                  : "bg-[var(--dpf-accent)] text-white hover:opacity-90",
              ].join(" ")}
            >
              {isPending ? "Setting up..." : "I agree -- complete setup"}
            </button>
          </div>
        </WizardCard>
      )}

      {/* Step / state: Connect GitHub (Device Flow primary, Advanced paste fallback) */}
      {isContributionMode && (wizardStep === "connect" || wizardStep === "done") && (
        <div className="space-y-4" data-testid="github-connect-block">
          {/* Anchor target for TokenExpiryBanner's "Reconnect GitHub" link. */}
          <div id="connect-github">
            <ConnectGitHubCard initialConnected={props.initialConnected ?? null} />
          </div>
          {/* Anchor target for TokenExpiryBanner's "Update token" link. */}
          <div id="advanced-token">
            <AdvancedTokenPaste mode={selected} />
          </div>
        </div>
      )}

      {/* Done state — sharing summary, configured by */}
      {isContributionMode && wizardStep === "done" && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <span className="text-green-500 text-lg leading-none">*</span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Sharing is set up</h3>
              <p className="text-xs text-[var(--dpf-muted)] mt-0.5">
                {selected === "selective"
                  ? "When the AI Coworker finishes building a feature, it will ask if you'd like to share it with the community."
                  : "Features you build will be shared with the community by default. You can keep any individual feature private when asked."}
              </p>
            </div>
          </div>

          {props.dcoAcceptedAt && (
            <p className="text-xs text-[var(--dpf-muted)]">
              Contributor agreement accepted
              {props.dcoAcceptedByEmail ? ` by ${props.dcoAcceptedByEmail}` : ""}
              {" on "}
              {new Date(props.dcoAcceptedAt).toLocaleDateString()}.
            </p>
          )}

          {/* Lightweight reset hook for admins who want to walk through the
              wizard again (mode change, DCO re-acceptance, etc). The Connect
              card above is the primary token surface; this just gives an
              escape hatch back to the explain step. */}
          <button
            onClick={handleReconfigure}
            className="text-xs text-[var(--dpf-accent)] hover:underline"
          >
            Reconfigure sharing settings
          </button>
        </div>
      )}

      {/* Last configured info */}
      {props.configuredAt && (
        <p className="text-xs text-[var(--dpf-muted)]">
          Last configured {new Date(props.configuredAt).toLocaleDateString()} by{" "}
          {props.configuredByEmail ?? "unknown"}
        </p>
      )}
    </div>
  );
}

// ─── Wizard Card Component ──────────────────────────────────────────────────

function WizardCard(props: {
  step: number;
  total: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{props.title}</h3>
        <span className="text-xs text-[var(--dpf-muted)]">
          Step {props.step} of {props.total}
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-1 rounded-full bg-[var(--dpf-border)] overflow-hidden">
        <div
          className="h-full rounded-full bg-[var(--dpf-accent)] transition-all duration-300"
          style={{ width: `${(props.step / props.total) * 100}%` }}
        />
      </div>
      {props.children}
    </div>
  );
}
