"use client";

import { useState, useTransition } from "react";

import { saveContributionSetup } from "@/lib/actions/platform-dev-config";

// Advanced token-paste disclosure — Tier 2 / Tier 3 of the 2026-04-24 GitHub
// auth 2FA readiness spec. Demoted from the primary form path; collapsed by
// default. Two labeled sections (fine-grained PAT, classic PAT) with
// tier-appropriate copy. Both submit through the existing
// `saveContributionSetup` action.
//
// The two forms intentionally share a single submit action — auth-method
// detection happens server-side in `validateGitHubToken` via prefix
// inspection. The labels just steer the user toward the right token type.

type ContributionMode = "fork_only" | "selective" | "contribute_all";

const FINE_GRAINED_HELP =
  "Create a fine-grained PAT at github.com/settings/personal-access-tokens with Repository Access limited to your fork and Contents: read and write. Expiry: 90 days or more.";

const CLASSIC_WARNING =
  "Classic PATs have no expiry and broad scope. Prefer Device Flow or fine-grained PATs. Continue only if your environment requires this.";

export interface AdvancedTokenPasteProps {
  /** Mode the install is in. Persisted alongside the token. */
  mode: ContributionMode;
}

interface SectionState {
  token: string;
  pending: boolean;
  error: string | null;
  username: string | null;
}

const emptySection: SectionState = {
  token: "",
  pending: false,
  error: null,
  username: null,
};

export function AdvancedTokenPaste({ mode }: AdvancedTokenPasteProps) {
  const [fineGrained, setFineGrained] = useState<SectionState>(emptySection);
  const [classic, setClassic] = useState<SectionState>(emptySection);
  const [, startTransition] = useTransition();

  const submitToken = (
    section: "fine-grained" | "classic",
    state: SectionState,
    setState: (s: SectionState) => void,
  ) => {
    const token = state.token.trim();
    if (!token) return;
    setState({ ...state, pending: true, error: null, username: null });
    startTransition(async () => {
      const result = await saveContributionSetup({ token, mode });
      if (!result.success) {
        setState({
          ...state,
          pending: false,
          error: result.error ?? "Token validation failed.",
          username: null,
        });
        return;
      }
      setState({
        token: "",
        pending: false,
        error: null,
        username: result.username ?? null,
      });
    });
  };

  return (
    <details
      className="rounded-lg border border-[var(--dpf-border)] p-4"
      data-testid="advanced-token-paste"
    >
      <summary className="cursor-pointer text-sm font-medium text-[var(--dpf-text)]">
        Advanced: paste a token
      </summary>
      <p className="mt-2 text-xs text-[var(--dpf-muted)]">
        For policy-restricted environments, machine users, or air-gapped installs that
        can't use the primary OAuth Device Flow path.
      </p>

      {/* ─── Fine-grained PAT ─────────────────────────────────────────────── */}
      <section
        className="mt-4 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
        data-testid="fine-grained-pat-section"
      >
        <h4 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">
          Fine-grained PAT (advanced)
        </h4>
        <p className="text-xs text-[var(--dpf-muted)] leading-relaxed mb-3">
          {FINE_GRAINED_HELP}
        </p>
        <input
          type="password"
          value={fineGrained.token}
          onChange={(e) =>
            setFineGrained({ ...fineGrained, token: e.target.value, error: null })
          }
          placeholder="github_pat_xxxxxxxxxxxxxxxxxxxxxx"
          className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-xs text-[var(--dpf-text)]"
          data-testid="fine-grained-pat-input"
        />
        {fineGrained.error && (
          <p
            className="mt-2 text-xs text-red-600 dark:text-red-400"
            data-testid="fine-grained-pat-error"
          >
            {fineGrained.error}
          </p>
        )}
        {fineGrained.username && (
          <p
            className="mt-2 text-xs text-green-600 dark:text-green-400"
            data-testid="fine-grained-pat-success"
          >
            Saved. Connected as <strong>{fineGrained.username}</strong>.
          </p>
        )}
        <button
          type="button"
          onClick={() => submitToken("fine-grained", fineGrained, setFineGrained)}
          disabled={fineGrained.pending || !fineGrained.token.trim()}
          className="mt-3 rounded border border-[var(--dpf-accent)] bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          data-testid="fine-grained-pat-submit"
        >
          {fineGrained.pending ? "Saving…" : "Save fine-grained PAT"}
        </button>
      </section>

      {/* ─── Classic PAT ─────────────────────────────────────────────────── */}
      <section
        className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 p-3"
        data-testid="classic-pat-section"
      >
        <h4 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">
          Classic PAT (emergency)
        </h4>
        <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed mb-3">
          {CLASSIC_WARNING}
        </p>
        <input
          type="password"
          value={classic.token}
          onChange={(e) => setClassic({ ...classic, token: e.target.value, error: null })}
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-xs text-[var(--dpf-text)]"
          data-testid="classic-pat-input"
        />
        {classic.error && (
          <p
            className="mt-2 text-xs text-red-600 dark:text-red-400"
            data-testid="classic-pat-error"
          >
            {classic.error}
          </p>
        )}
        {classic.username && (
          <p
            className="mt-2 text-xs text-green-600 dark:text-green-400"
            data-testid="classic-pat-success"
          >
            Saved. Connected as <strong>{classic.username}</strong>.
          </p>
        )}
        <button
          type="button"
          onClick={() => submitToken("classic", classic, setClassic)}
          disabled={classic.pending || !classic.token.trim()}
          className="mt-3 rounded border border-amber-500 bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          data-testid="classic-pat-submit"
        >
          {classic.pending ? "Saving…" : "Save classic PAT"}
        </button>
      </section>
    </details>
  );
}
