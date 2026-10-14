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
//
// BI-985F4EC9: an install that develops the platform also needs a working
// login to the repository it manages. Once contribution is settled, the item
// stays open as "repository" until that repository's status is Connected.

import type { prisma } from "@dpf/db";
import { hasContributionToken } from "@/lib/actions/platform-dev-config";
import type { ManagedRepositoryStatus } from "@/lib/forge/managed-repository-access";
import type { AttentionItem } from "../types";

export const CONTRIBUTION_SETUP_ROUTE = "/admin/platform-development";

export type ContributionSetupState = {
  /** PlatformDevConfig.contributionMode, or null when no row exists. */
  contributionMode: string | null;
  /** Whether a person (not the seed) recorded the contribution decision. */
  decidedByPerson: boolean;
  /** An active contribution credential: env token, hive-contribution or git-backup. */
  hasContributionCredential: boolean;
  /** The installation's declared primary purpose, when one is recorded. */
  installationPurpose?: string | null;
  /** Managed-repository status (BI-985F4EC9); omitted when it was not read. */
  managedRepositoryStatus?: ManagedRepositoryStatus | null;
};

export type ContributionSetupGap = "decide" | "connect" | "repository";

/** Pure: which part of contribution setup is still open, if any. */
export function contributionSetupGap(state: ContributionSetupState): ContributionSetupGap | null {
  const contribution = contributionGap(state);
  if (contribution) return contribution;
  const managesRepository = state.installationPurpose === "evolve-dpf";
  if (managesRepository && state.managedRepositoryStatus && state.managedRepositoryStatus !== "connected") {
    return "repository";
  }
  return null;
}

function contributionGap(state: ContributionSetupState): "decide" | "connect" | null {
  const keepsPrivate = state.contributionMode === "private" || state.contributionMode === "fork_only";
  // The seed writes "private" with no person behind it: a default, not a
  // decision. The open question is only raised on an install whose purpose is
  // developing the platform: an organisation that never codes should not be
  // nagged about contributing, and setup already asked it once.
  if (state.contributionMode === null || (keepsPrivate && !state.decidedByPerson)) {
    return state.installationPurpose === "evolve-dpf" ? "decide" : null;
  }
  if (keepsPrivate) return null;
  return state.hasContributionCredential ? null : "connect";
}

export function contributionSetupToAttentionItem(gap: ContributionSetupGap, nowIso: string): AttentionItem {
  if (gap === "repository") return managedRepositoryItem(nowIso);
  const connect = gap === "connect";
  const href = connect ? `${CONTRIBUTION_SETUP_ROUTE}#connect-github` : CONTRIBUTION_SETUP_ROUTE;
  return {
    id: `contribution-setup:${gap}`,
    source: "contribution-setup",
    // Short on purpose: the inbox has a visible-word budget (UX route sweep),
    // and the Connect GitHub card itself says the account name is public.
    title: connect ? "Connect your GitHub" : "Share what you build?",
    context: connect
      ? "Build Studio needs it to open pull requests."
      : "Choose whether changes built here go to the DPF project.",
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

function managedRepositoryItem(nowIso: string): AttentionItem {
  const href = `${CONTRIBUTION_SETUP_ROUTE}#managed-repository`;
  return {
    id: "contribution-setup:repository",
    source: "contribution-setup",
    title: "Connect your repository",
    context: "Issue intake needs a working GitHub login.",
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "needs-credential",
      blastRadius: "Managed repository issue intake",
      decideEffort: "one-tap",
      irreversible: false,
    },
    createdAtIso: nowIso,
    actions: [{ kind: "open-in-context", label: "Connect", href }],
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
  const { INSTALLATION_OPERATING_INTENT_KEY } = await import("@/lib/installation-journey/operating-intent");
  const intent = await db.platformConfig.findUnique({
    where: { key: INSTALLATION_OPERATING_INTENT_KEY },
    select: { value: true },
  });
  const purpose = (intent?.value as { primaryPurpose?: unknown } | null | undefined)?.primaryPurpose;
  // Read only for an install that manages a repository; cached five minutes,
  // so the inbox never asks GitHub on every load.
  let managedRepositoryStatus: ManagedRepositoryStatus | null = null;
  if (purpose === "evolve-dpf") {
    const { loadManagedRepositoryStatus } = await import("@/lib/forge/managed-repository-access");
    managedRepositoryStatus = (await loadManagedRepositoryStatus(db).catch(() => null))?.status ?? null;
  }
  const gap = contributionSetupGap({
    contributionMode: config?.contributionMode ?? null,
    decidedByPerson: Boolean(config?.configuredById),
    hasContributionCredential: await hasContributionToken(),
    installationPurpose: typeof purpose === "string" ? purpose : null,
    managedRepositoryStatus,
  });
  return gap ? [contributionSetupToAttentionItem(gap, now.toISOString())] : [];
}
