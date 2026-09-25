// Contribution-setup source (BI-D3342020) — the install has not finished
// deciding how the work built here reaches the DPF project, projected as a
// "Needs you" item that leads the person to the one place that sets it up.
//
// Founder requirement (2026-09-25): anyone who codes can contribute, and the UX
// leads them there. Setup asks once, but an install can come through setup with
// half of it done: this dev install recorded "contributing" (automated setup)
// and never connected a GitHub account, so every Build Studio pull request
// would have failed at ship with nobody asked. The item therefore keys off the
// install's actual state, never off whether setup ran.
//
// The `github-pr-sync` credential is deliberately not counted: Build Studio
// may fall back to it, but it is not a contribution identity a person chose,
// so it must not hide this question.

import type { prisma } from "@dpf/db";
import { hasContributionToken } from "@/lib/actions/platform-dev-config";
import type { AttentionItem } from "../types";

export const CONTRIBUTION_SETUP_ROUTE = "/admin/platform-development";

export type ContributionSetupState = {
  /** PlatformDevConfig.contributionMode, or null when no row exists. */
  contributionMode: string | null;
  /** Whether a person (not the seed) recorded the contribution decision. */
  decidedByPerson: boolean;
  /** An active contribution credential: env token, hive-contribution or git-backup. */
  hasContributionCredential: boolean;
};

/** Pure: which part of contribution setup is still open, if any. */
export function contributionSetupGap(state: ContributionSetupState): "decide" | "connect" | null {
  const keepsPrivate = state.contributionMode === "private" || state.contributionMode === "fork_only";
  // The seed writes "private" with no person behind it: a default, not a decision.
  if (state.contributionMode === null || (keepsPrivate && !state.decidedByPerson)) return "decide";
  if (keepsPrivate) return null;
  return state.hasContributionCredential ? null : "connect";
}

export function contributionSetupToAttentionItem(gap: "decide" | "connect", nowIso: string): AttentionItem {
  const connect = gap === "connect";
  const href = connect ? `${CONTRIBUTION_SETUP_ROUTE}#connect-github` : CONTRIBUTION_SETUP_ROUTE;
  return {
    id: `contribution-setup:${gap}`,
    source: "contribution-setup",
    title: connect ? "Connect GitHub to share what you build" : "Decide whether to share what you build",
    context: connect
      ? "This install shares its changes with the DPF project, but no GitHub account is connected, " +
        "so Build Studio cannot open pull requests. Your GitHub name is shown on each one."
      : "Choose whether the changes built here are shared with the DPF project or stay on this install. " +
        "You can change it later.",
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: connect ? "needs-credential" : "input-required",
      blastRadius: "Build Studio pull requests",
      decideEffort: connect ? "one-tap" : "review",
      irreversible: false,
    },
    createdAtIso: nowIso,
    actions: [{ kind: "open-in-context", label: connect ? "Connect GitHub" : "Choose", href }],
    deepLink: href,
    audience: { operator: true },
  };
}

type Db = typeof prisma;

export async function loadContributionSetupItems(db: Db, now: Date = new Date()): Promise<AttentionItem[]> {
  const config = await db.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { contributionMode: true, configuredById: true },
  });
  const gap = contributionSetupGap({
    contributionMode: config?.contributionMode ?? null,
    decidedByPerson: Boolean(config?.configuredById),
    hasContributionCredential: await hasContributionToken(),
  });
  return gap ? [contributionSetupToAttentionItem(gap, now.toISOString())] : [];
}
