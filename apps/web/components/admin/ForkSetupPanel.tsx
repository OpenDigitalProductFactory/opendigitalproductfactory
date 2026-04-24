"use client";

import { useState, useTransition } from "react";

import { configureForkSetup } from "@/lib/actions/platform-dev-config";

export interface ForkSetupPanelProps {
  /** Feature flag result (resolved server-side, passed down). */
  enabled: boolean;
  /** Current value of PlatformDevConfig.contributionModel — null means "unconfigured". */
  contributionModel: string | null;
  /** Current PlatformDevConfig.contributorForkOwner. */
  contributorForkOwner: string | null;
  /** Current PlatformDevConfig.contributorForkRepo. */
  contributorForkRepo: string | null;
  /** Whether a hive-contribution token is stored. If not, admin needs the main setup flow first. */
  hasContributionToken: boolean;
}

type PanelState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ready"; forkOwner: string; forkRepo: string }
  | { kind: "deferred"; forkOwner: string; forkRepo: string }
  | { kind: "error"; message: string };

/**
 * Flag-gated setup panel for the fork-pr contribution model.
 *
 * Renders nothing unless the feature flag is on AND the install looks like
 * it needs fork-pr setup (contributionModel still null and a contribution
 * token is stored). The action itself is safe to call regardless of flag
 * state — gating is purely UX: no point showing fork setup to installs
 * that are still on the pre-fork-pr direct-push flow.
 */
export function ForkSetupPanel(props: ForkSetupPanelProps) {
  const [username, setUsername] = useState(props.contributorForkOwner ?? "");
  const [tokenInput, setTokenInput] = useState("");
  const [state, setState] = useState<PanelState>(() => {
    if (props.contributorForkOwner && props.contributorForkRepo) {
      return { kind: "ready", forkOwner: props.contributorForkOwner, forkRepo: props.contributorForkRepo };
    }
    return { kind: "idle" };
  });
  const [isPending, startTransition] = useTransition();

  if (!props.enabled) return null;
  if (!props.hasContributionToken) return null;
  // Once contributionModel is explicitly set, the main form handles the rest.
  if (props.contributionModel !== null) return null;

  const submit = () => {
    if (!username.trim() || !tokenInput.trim()) return;
    setState({ kind: "submitting" });
    startTransition(async () => {
      const result = await configureForkSetup({
        contributorForkOwner: username.trim(),
        token: tokenInput.trim(),
      });
      if (!result.success) {
        setState({ kind: "error", message: result.error });
        return;
      }
      setTokenInput("");
      if (result.status === "ready") {
        setState({ kind: "ready", forkOwner: result.forkOwner, forkRepo: result.forkRepo });
      } else {
        setState({ kind: "deferred", forkOwner: result.forkOwner, forkRepo: result.forkRepo });
      }
    });
  };

  return (
    <section
      aria-labelledby="fork-setup-heading"
      className="mb-6 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
      data-testid="fork-setup-panel"
    >
      <h3 id="fork-setup-heading" className="mb-2 text-base font-semibold text-[var(--dpf-text)]">
        Configure fork-based contribution
      </h3>
      <p className="mb-3 text-sm text-[var(--dpf-muted)]">
        Contributions will be pushed to a fork under your GitHub account, then opened as a
        pull request against the upstream repo. This keeps your token scoped to your own
        account — no upstream write access required.
      </p>
      <p className="mb-3 text-xs text-[var(--dpf-muted)]">
        Your GitHub username will be visible on every PR you contribute. If that is not
        acceptable, use a pseudonymous GitHub account for this install.
      </p>

      <div className="mb-3">
        <label htmlFor="fork-username" className="mb-1 block text-sm text-[var(--dpf-text)]">
          Your GitHub username
        </label>
        <input
          id="fork-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="jane-dev"
          className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 text-sm text-[var(--dpf-text)]"
        />
      </div>

      <div className="mb-3">
        <label htmlFor="fork-token" className="mb-1 block text-sm text-[var(--dpf-text)]">
          GitHub personal access token (public_repo scope on your account)
        </label>
        <input
          id="fork-token"
          type="password"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-xs text-[var(--dpf-text)]"
        />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={isPending || state.kind === "submitting" || !username.trim() || !tokenInput.trim()}
        className="rounded border border-[var(--dpf-accent)] bg-[var(--dpf-accent)] px-4 py-2 text-sm text-[var(--dpf-bg)] disabled:opacity-50"
      >
        {state.kind === "submitting" ? "Setting up fork…" : "Configure fork"}
      </button>

      {state.kind === "ready" && (
        <p className="mt-3 text-sm text-[var(--dpf-text)]" data-testid="fork-ready">
          Fork verified: {state.forkOwner}/{state.forkRepo}
        </p>
      )}
      {state.kind === "deferred" && (
        <p className="mt-3 text-sm text-[var(--dpf-muted)]" data-testid="fork-deferred">
          Fork is being created. This usually takes a few seconds. If your first contribution
          fails with a fork-not-found error, return here and re-check.
        </p>
      )}
      {state.kind === "error" && (
        <p className="mt-3 text-sm text-red-500" data-testid="fork-error">
          {state.message}
        </p>
      )}
    </section>
  );
}
