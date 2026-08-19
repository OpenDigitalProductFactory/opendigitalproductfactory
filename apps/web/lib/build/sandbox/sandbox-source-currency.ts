export type SandboxSourceCurrencyStatus =
  | "current"
  | "behind"
  | "ahead"
  | "diverged"
  | "dirty"
  | "unknown";

export type SandboxSourceCurrencyAction =
  | "allow"
  | "auto-refresh"
  | "pause"
  | "inspect";

export type SandboxSourceCurrencySnapshot = {
  source: "sandbox-git";
  status: SandboxSourceCurrencyStatus;
  recommendedAction: SandboxSourceCurrencyAction;
  workspace: string;
  branch: string | null;
  headSha: string | null;
  headTreeSha: string | null;
  targetRef: string;
  targetSha: string | null;
  targetTreeSha: string | null;
  mergeBaseSha: string | null;
  aheadBy: number | null;
  behindBy: number | null;
  dirty: boolean;
  localSourceChangeCount: number | null;
  checkedAt: string;
  reason: string | null;
};

export type SandboxSourceCurrencyInput = {
  workspace?: string | null;
  branch?: string | null;
  headSha?: string | null;
  headTreeSha?: string | null;
  targetRef: string;
  targetSha?: string | null;
  targetTreeSha?: string | null;
  mergeBaseSha?: string | null;
  aheadBy?: number | null;
  behindBy?: number | null;
  dirty?: boolean | null;
  localSourceChangeCount?: number | null;
  checkedAt?: string | null;
};

const SOURCE_DIFF_EXCLUDES = [
  ":!node_modules",
  ":!**/node_modules/**",
  ":!.next",
  ":!**/.next/**",
  ":!.pnpm-store",
  ":!**/.pnpm-store/**",
  ":!*.tsbuildinfo",
  ":!**/*.tsbuildinfo",
  // Next dev rewrites this tracked generated shim between .next/types and
  // .next/dev/types. It is not build source and must not stall recovery.
  ":!apps/web/next-env.d.ts",
  ":!pnpm-lock*",
  ":!**/generated/client/**",
  ":!packages/db/generated/**",
] as const;

/**
 * Whether a build/* branch already carries work that must survive a
 * start_build / review-phase resume (BI-8C6AA60E). Hard-resetting a branch that
 * is ahead (or has source deltas) of the fork point wiped generated code and
 * left ship with "no releasable changes".
 */
export function shouldPreserveBuildBranchWork(
  snapshot: Pick<
    SandboxSourceCurrencySnapshot,
    "status" | "aheadBy" | "localSourceChangeCount" | "dirty"
  >,
): boolean {
  if (snapshot.dirty) return true;
  if ((snapshot.aheadBy ?? 0) > 0) return true;
  if ((snapshot.localSourceChangeCount ?? 0) > 0) return true;
  if (snapshot.status === "ahead" || snapshot.status === "diverged") return true;
  return false;
}

export function classifySandboxSourceCurrency(
  input: SandboxSourceCurrencyInput,
): SandboxSourceCurrencySnapshot {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const workspace = input.workspace?.trim() || "/workspace";
  const dirty = input.dirty === true;
  const aheadBy = finiteOrNull(input.aheadBy);
  const behindBy = finiteOrNull(input.behindBy);
  const localSourceChangeCount = finiteOrNull(input.localSourceChangeCount);
  const headSha = nullableString(input.headSha);
  const headTreeSha = nullableString(input.headTreeSha);
  const targetSha = nullableString(input.targetSha);
  const targetTreeSha = nullableString(input.targetTreeSha);
  const mergeBaseSha = nullableString(input.mergeBaseSha);

  let status: SandboxSourceCurrencyStatus;
  let recommendedAction: SandboxSourceCurrencyAction;
  let reason: string | null;

  if (dirty) {
    status = "dirty";
    recommendedAction = "pause";
    reason = "Sandbox working tree has uncommitted changes.";
  } else if (!headSha || !targetSha) {
    status = "unknown";
    recommendedAction = "inspect";
    reason = `Sandbox could not resolve ${input.targetRef}.`;
  } else if (headTreeSha && targetTreeSha && headTreeSha === targetTreeSha) {
    status = "current";
    recommendedAction = "allow";
    reason = `Sandbox source tree matches ${input.targetRef}.`;
  } else if (aheadBy != null && behindBy != null) {
    if (aheadBy === 0 && behindBy === 0) {
      status = "current";
      recommendedAction = "allow";
      reason = `Sandbox is current with ${input.targetRef}.`;
    } else if (aheadBy === 0 && behindBy > 0) {
      status = "behind";
      recommendedAction = "auto-refresh";
      reason = `Sandbox is ${behindBy} ${pluralize("commit", behindBy)} behind ${input.targetRef}.`;
    } else if (aheadBy > 0 && behindBy === 0) {
      status = "ahead";
      recommendedAction = "allow";
      reason = `Sandbox has ${aheadBy} local ${pluralize("commit", aheadBy)} ahead of ${input.targetRef}.`;
    } else if (localSourceChangeCount === 0) {
      status = "behind";
      recommendedAction = "auto-refresh";
      reason = `Sandbox only has non-source local commits and is missing ${behindBy} ${pluralize("commit", behindBy)} from ${input.targetRef}.`;
    } else {
      status = "diverged";
      recommendedAction = "pause";
      reason = `Sandbox has ${aheadBy} local ${pluralize("commit", aheadBy)} and is missing ${behindBy} ${pluralize("commit", behindBy)} from ${input.targetRef}.`;
    }
  } else if (mergeBaseSha && mergeBaseSha === headSha) {
    status = "behind";
    recommendedAction = "auto-refresh";
    reason = `Sandbox is behind ${input.targetRef}.`;
  } else if (mergeBaseSha && mergeBaseSha === targetSha) {
    status = "ahead";
    recommendedAction = "allow";
    reason = `Sandbox is ahead of ${input.targetRef}.`;
  } else if (mergeBaseSha) {
    status = localSourceChangeCount === 0 ? "behind" : "diverged";
    recommendedAction = localSourceChangeCount === 0 ? "auto-refresh" : "pause";
    reason = localSourceChangeCount === 0
      ? `Sandbox can refresh to ${input.targetRef}; no local source changes were detected.`
      : `Sandbox diverged from ${input.targetRef}.`;
  } else {
    status = "unknown";
    recommendedAction = "inspect";
    reason = `Sandbox could not compute a merge base with ${input.targetRef}.`;
  }

  return {
    source: "sandbox-git",
    status,
    recommendedAction,
    workspace,
    branch: nullableString(input.branch),
    headSha,
    headTreeSha,
    targetRef: input.targetRef,
    targetSha,
    targetTreeSha,
    mergeBaseSha,
    aheadBy,
    behindBy,
    dirty,
    localSourceChangeCount,
    checkedAt,
    reason,
  };
}

export function buildSandboxSourceCurrencyProbeCommand(args: {
  workspace?: string;
  targetRef?: string;
} = {}): string {
  const workspace = args.workspace?.trim() || "/workspace";
  const targetRef = args.targetRef?.trim() || "origin/main";
  const quotedWorkspace = shellQuote(workspace);
  const diffExcludes = SOURCE_DIFF_EXCLUDES.map(shellQuote).join(" ");

  return [
    `cd ${quotedWorkspace}`,
    `git config --global --add safe.directory ${quotedWorkspace} >/dev/null 2>&1 || true`,
    `if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then printf 'reason=not-git-repo\\n'; exit 0; fi`,
    `branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)`,
    `headSha=$(git rev-parse HEAD 2>/dev/null || true)`,
    `headTreeSha=$(git rev-parse HEAD^{tree} 2>/dev/null || true)`,
    `targetSha=$(git rev-parse ${targetRef} 2>/dev/null || true)`,
    `targetTreeSha=$(git rev-parse ${targetRef}^{tree} 2>/dev/null || true)`,
    `mergeBaseSha=$(git merge-base HEAD ${targetRef} 2>/dev/null || true)`,
    `aheadBehind=$(git rev-list --left-right --count HEAD...${targetRef} 2>/dev/null || true)`,
    `dirty=false`,
    `if [ -n "$(git status --porcelain --untracked-files=all -- . ${diffExcludes} 2>/dev/null)" ]; then dirty=true; fi`,
    `localSourceChangeCount=`,
    `if [ -n "$mergeBaseSha" ]; then localSourceChangeCount=$(git diff --name-only "$mergeBaseSha"..HEAD -- . ${diffExcludes} 2>/dev/null | wc -l | tr -d ' '); fi`,
    `printf 'branch=%s\\n' "$branch"`,
    `printf 'headSha=%s\\n' "$headSha"`,
    `printf 'headTreeSha=%s\\n' "$headTreeSha"`,
    `printf 'targetSha=%s\\n' "$targetSha"`,
    `printf 'targetTreeSha=%s\\n' "$targetTreeSha"`,
    `printf 'mergeBaseSha=%s\\n' "$mergeBaseSha"`,
    `printf 'aheadBehind=%s\\n' "$aheadBehind"`,
    `printf 'dirty=%s\\n' "$dirty"`,
    `printf 'localSourceChangeCount=%s\\n' "$localSourceChangeCount"`,
  ].join(" && ");
}

export function parseSandboxSourceCurrencyProbeOutput(
  output: string,
  args: {
    targetRef: string;
    checkedAt?: string;
    workspace?: string;
  },
): SandboxSourceCurrencySnapshot {
  const fields = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    fields.set(line.slice(0, index), line.slice(index + 1));
  }

  const [aheadBy, behindBy] = parseAheadBehind(fields.get("aheadBehind") ?? "");

  return classifySandboxSourceCurrency({
    workspace: args.workspace,
    branch: fields.get("branch"),
    headSha: fields.get("headSha"),
    headTreeSha: fields.get("headTreeSha"),
    targetRef: args.targetRef,
    targetSha: fields.get("targetSha"),
    targetTreeSha: fields.get("targetTreeSha"),
    mergeBaseSha: fields.get("mergeBaseSha"),
    aheadBy,
    behindBy,
    dirty: fields.get("dirty") === "true",
    localSourceChangeCount: parseInteger(fields.get("localSourceChangeCount")),
    checkedAt: args.checkedAt,
  });
}

export function formatSandboxSourceCurrencySummary(
  snapshot: SandboxSourceCurrencySnapshot,
): string {
  const branch = snapshot.branch ?? "unknown branch";
  const head = shortSha(snapshot.headSha);
  const target = `${snapshot.targetRef}${snapshot.targetSha ? `@${shortSha(snapshot.targetSha)}` : ""}`;
  const counts = snapshot.aheadBy != null && snapshot.behindBy != null
    ? ` (${snapshot.aheadBy} ahead, ${snapshot.behindBy} behind)`
    : "";
  const reason = snapshot.reason ? ` ${snapshot.reason}` : "";

  return [
    `Sandbox source ${snapshot.status}: ${branch}@${head} vs ${target}${counts}.`,
    `Action: ${snapshot.recommendedAction}.`,
    reason.trim(),
  ].filter(Boolean).join(" ");
}

function parseAheadBehind(value: string): [number | null, number | null] {
  const match = value.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) {
    return [null, null];
  }
  return [parseInteger(match[1]), parseInteger(match[2])];
}

function parseInteger(value: string | undefined): number | null {
  if (value == null || value.trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function pluralize(noun: string, count: number | null): string {
  return count === 1 ? noun : `${noun}s`;
}

function shortSha(value: string | null): string {
  return value ? value.slice(0, 7) : "unknown";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}
