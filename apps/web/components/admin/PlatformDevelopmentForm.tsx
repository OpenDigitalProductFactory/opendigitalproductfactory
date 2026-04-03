"use client";

import { useState, useTransition } from "react";
import {
  savePlatformDevConfig,
  acceptDco,
  saveContributionSetup,
  validateGitHubToken,
} from "@/lib/actions/platform-dev-config";

type ContributionMode = "fork_only" | "selective" | "contribute_all";

// ─── Mode Options ──────────────────────────────────────────────────────────

const MODE_OPTIONS: { value: ContributionMode; label: string; description: string }[] = [
  {
    value: "fork_only",
    label: "Keep everything here",
    description: "Changes you make in Build Studio stay on your platform only. Nothing is shared externally.",
  },
  {
    value: "selective",
    label: "Share selectively",
    description: "After building a feature, the AI will ask if you'd like to share it with the community. You decide each time.",
  },
  {
    value: "contribute_all",
    label: "Share everything",
    description: "Features you build are shared with the community by default. You can still keep individual ones private.",
  },
];

// ─── Wizard Steps for Contribution Setup ────────────────────────────────────

type WizardStep = "mode" | "explain" | "github-account" | "create-token" | "paste-token" | "dco" | "done";

// ─── DCO Items ──────────────────────────────────────────────────────────────

const DCO_PLAIN = [
  "The features I share are my original work, or based on work I have the right to share.",
  "I give permission for others to use these features under the project's open-source license.",
  "I understand that shared features (and my name as contributor) become part of the public project record.",
];

// ─── Props ──────────────────────────────────────────────────────────────────

interface PlatformDevelopmentFormProps {
  currentMode: ContributionMode | null;
  configuredAt: string | null;
  configuredByEmail: string | null;
  gitRemoteUrl?: string | null;
  dcoAcceptedAt?: string | null;
  dcoAcceptedByEmail?: string | null;
  untrackedFeatureCount?: number;
  hasGitCredential?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PlatformDevelopmentForm(props: PlatformDevelopmentFormProps) {
  const [selected, setSelected] = useState<ContributionMode>(props.currentMode ?? "selective");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  // Wizard state
  const isContributionMode = selected === "selective" || selected === "contribute_all";
  const isAlreadySetUp = isContributionMode && props.hasGitCredential && !!props.dcoAcceptedAt;
  const [wizardStep, setWizardStep] = useState<WizardStep>(isAlreadySetUp ? "done" : "mode");
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [githubUsername, setGithubUsername] = useState<string | null>(null);
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

  const handleValidateToken = () => {
    setTokenError(null);
    startTransition(async () => {
      const result = await validateGitHubToken(token.trim());
      if (result.valid) {
        setGithubUsername(result.username ?? null);
        setWizardStep("dco");
      } else {
        setTokenError(result.error ?? "Token validation failed.");
      }
    });
  };

  const handleCompleteDco = () => {
    setDcoError(null);
    startTransition(async () => {
      // Save everything: token + mode + DCO
      const setupResult = await saveContributionSetup({
        token: token.trim(),
        mode: selected,
      });
      if (!setupResult.success) {
        setDcoError(setupResult.error ?? "Setup failed.");
        return;
      }

      const dcoResult = await acceptDco();
      if (!dcoResult.accepted) {
        setDcoError(dcoResult.error ?? "Could not accept the contributor agreement.");
        return;
      }

      setWizardStep("done");
    });
  };

  const handleReconfigure = () => {
    setWizardStep("explain");
    setToken("");
    setTokenError(null);
    setGithubUsername(null);
  };

  return (
    <div className="max-w-xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">
          How do you want to manage your customisations?
        </h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          This controls what happens when Build Studio ships a feature.
        </p>
      </div>

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
              Save completed features to an online repository for safekeeping.
              If anything happens to your system, your work is protected.
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
                onChange={(e) => { setGitToken(e.target.value); setSaved(false); }}
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
                {props.untrackedFeatureCount} completed feature{props.untrackedFeatureCount === 1 ? "" : "s"} not yet backed up.
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
            To share features with the community, we need to connect your platform
            to GitHub (a service that manages code contributions).
            This takes about 5 minutes.
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
        <WizardCard
          step={1}
          total={4}
          title="How sharing works"
        >
          <div className="space-y-2 text-xs text-[var(--dpf-text)] leading-relaxed">
            <p>
              When the AI Coworker finishes building a feature for you, it can
              propose sharing that feature with the wider community of platform users.
            </p>
            <p>
              Shared features are submitted as a <strong>proposed change</strong> to
              the community repository on GitHub. A maintainer reviews the proposal
              before it becomes available to others.
            </p>
            <p>
              {selected === "selective"
                ? "You'll be asked each time whether to share or keep a feature private."
                : "Features are shared by default, but you can keep any individual one private."}
            </p>
          </div>
          <div className="flex justify-end mt-4">
            <button
              onClick={() => setWizardStep("github-account")}
              className="rounded px-4 py-1.5 text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-colors"
            >
              Next
            </button>
          </div>
        </WizardCard>
      )}

      {/* Step 2: GitHub account */}
      {isContributionMode && wizardStep === "github-account" && (
        <WizardCard
          step={2}
          total={4}
          title="GitHub account"
        >
          <div className="space-y-3 text-xs text-[var(--dpf-text)] leading-relaxed">
            <p>
              Contributions are submitted through <strong>GitHub</strong>, a free service
              used by millions of developers to collaborate on software.
            </p>
            <p>
              If you don't have an account yet, create one first:
            </p>
            <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
              <ol className="list-decimal list-inside space-y-1.5 text-xs">
                <li>
                  Go to{" "}
                  <span className="font-mono text-[var(--dpf-accent)]">github.com/signup</span>
                </li>
                <li>Follow the steps to create a free account</li>
                <li>Come back here when you're done</li>
              </ol>
            </div>
          </div>
          <div className="flex justify-between mt-4">
            <button
              onClick={() => setWizardStep("explain")}
              className="rounded px-3 py-1.5 text-sm font-medium border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:bg-[var(--dpf-border)] transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => setWizardStep("create-token")}
              className="rounded px-4 py-1.5 text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-colors"
            >
              I have a GitHub account
            </button>
          </div>
        </WizardCard>
      )}

      {/* Step 3: Create a token */}
      {isContributionMode && wizardStep === "create-token" && (
        <WizardCard
          step={3}
          total={4}
          title="Create an access token"
        >
          <div className="space-y-3 text-xs text-[var(--dpf-text)] leading-relaxed">
            <p>
              GitHub uses <strong>personal access tokens</strong> instead of passwords.
              This gives the platform permission to submit contributions on your behalf.
            </p>
            <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
              <ol className="list-decimal list-inside space-y-2 text-xs">
                <li>
                  Go to{" "}
                  <span className="font-mono text-[var(--dpf-accent)]">github.com/settings/tokens/new</span>
                  <br />
                  <span className="text-[var(--dpf-muted)] ml-4">
                    (or: GitHub menu &gt; Settings &gt; Developer settings &gt; Personal access tokens &gt; Tokens (classic) &gt; Generate new token)
                  </span>
                </li>
                <li>
                  Set the name to{" "}
                  <span className="font-mono bg-[var(--dpf-bg)] px-1 rounded">Digital Product Factory</span>
                </li>
                <li>
                  Under <strong>Select scopes</strong>, check the box next to{" "}
                  <span className="font-mono bg-[var(--dpf-bg)] px-1 rounded">repo</span>
                  <br />
                  <span className="text-[var(--dpf-muted)] ml-4">(this allows creating branches and pull requests)</span>
                </li>
                <li>
                  Click <strong>Generate token</strong> at the bottom of the page
                </li>
                <li>
                  <strong>Copy the token</strong> (it starts with{" "}
                  <span className="font-mono">ghp_</span>)
                  <br />
                  <span className="text-[var(--dpf-muted)] ml-4">
                    GitHub only shows it once, so copy it before leaving the page
                  </span>
                </li>
              </ol>
            </div>
          </div>
          <div className="flex justify-between mt-4">
            <button
              onClick={() => setWizardStep("github-account")}
              className="rounded px-3 py-1.5 text-sm font-medium border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:bg-[var(--dpf-border)] transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => setWizardStep("paste-token")}
              className="rounded px-4 py-1.5 text-sm font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-colors"
            >
              I've created a token
            </button>
          </div>
        </WizardCard>
      )}

      {/* Step 3b: Paste the token */}
      {isContributionMode && wizardStep === "paste-token" && (
        <WizardCard
          step={3}
          total={4}
          title="Paste your token"
        >
          <div className="space-y-3">
            <p className="text-xs text-[var(--dpf-text)] leading-relaxed">
              Paste the token you just created. It will be encrypted and stored securely
              on your platform — it's never shared with anyone.
            </p>
            <input
              type="password"
              value={token}
              onChange={(e) => { setToken(e.target.value); setTokenError(null); }}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 text-sm font-mono text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none"
              autoFocus
            />
            {tokenError && (
              <div className="rounded border border-red-400/50 bg-red-400/10 px-3 py-2">
                <p className="text-xs text-red-600 dark:text-red-400">{tokenError}</p>
              </div>
            )}
          </div>
          <div className="flex justify-between mt-4">
            <button
              onClick={() => setWizardStep("create-token")}
              className="rounded px-3 py-1.5 text-sm font-medium border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:bg-[var(--dpf-border)] transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleValidateToken}
              disabled={isPending || !token.trim()}
              className={[
                "rounded px-4 py-1.5 text-sm font-medium transition-colors",
                isPending || !token.trim()
                  ? "bg-[var(--dpf-border)] text-[var(--dpf-muted)] cursor-not-allowed"
                  : "bg-[var(--dpf-accent)] text-white hover:opacity-90",
              ].join(" ")}
            >
              {isPending ? "Checking..." : "Verify token"}
            </button>
          </div>
        </WizardCard>
      )}

      {/* Step 4: DCO acceptance */}
      {isContributionMode && wizardStep === "dco" && (
        <WizardCard
          step={4}
          total={4}
          title="Contributor agreement"
        >
          <div className="space-y-3">
            {githubUsername && (
              <div className="rounded border border-green-500/50 bg-green-500/10 px-3 py-2">
                <p className="text-xs text-green-600 dark:text-green-400">
                  Connected to GitHub as <strong>{githubUsername}</strong>
                </p>
              </div>
            )}
            <p className="text-xs text-[var(--dpf-text)] leading-relaxed">
              Before sharing features, please confirm that you agree to the following:
            </p>
            <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 space-y-2">
              {DCO_PLAIN.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-[var(--dpf-text)]">
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
              onClick={() => setWizardStep("paste-token")}
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

      {/* Done state */}
      {isContributionMode && wizardStep === "done" && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <span className="text-green-500 text-lg leading-none">*</span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
                Sharing is set up
              </h3>
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
          Last configured {new Date(props.configuredAt).toLocaleDateString()} by {props.configuredByEmail ?? "unknown"}
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
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
          {props.title}
        </h3>
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
