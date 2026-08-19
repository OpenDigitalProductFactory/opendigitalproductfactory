import { isRecord } from "@/lib/shared/coerce";
import { getTruthSourceAge } from "./progress-visibility-types";
import type { SandboxSourceCurrencySnapshot } from "@/lib/build/sandbox/sandbox-source-currency";

export type BuildSandboxDiffEntry = {
  path: string;
  additions: number;
  deletions: number;
};

export type IgnoredSandboxDiffEntry = {
  path: string;
  reason: "generated" | "dependency" | "cache";
};

export type BuildSandboxState = {
  source: "sandbox-git";
  branch: string | null;
  headSha: string | null;
  headAgeLabel: string | null;
  commitsAhead: number | null;
  sourceDiffstat: BuildSandboxDiffEntry[];
  ignoredDiffstat: IgnoredSandboxDiffEntry[];
  expectedPlanFiles: Array<{ path: string; status: "exists" | "missing" | "unknown" }>;
  sourceCurrency: SandboxSourceCurrencySnapshot | null;
  observedAt: string | null;
  unavailableReason: string | null;
};

export type SandboxPromotionGateResult =
  | { ok: true; message: string }
  | { ok: false; message: string; failures: string[]; state: BuildSandboxState };

export type SandboxRecordInput = {
  buildBranch: string | null;
  gitCommitHashes: string[];
  diffPatch: string | null;
  updatedAt: Date | string | null;
  planDocument: string | null;
  description: string | null;
  buildExecState?: unknown;
};

export async function getSandboxStateForBuild(buildId: string): Promise<BuildSandboxState | null> {
  const { prisma } = await import("@dpf/db");
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      buildBranch: true,
      gitCommitHashes: true,
      diffPatch: true,
      updatedAt: true,
      buildPlan: true,
      description: true,
      buildExecState: true,
    },
  });
  if (!build) {
    return null;
  }

  return buildSandboxStateFromRecord({
    buildBranch: build.buildBranch,
    gitCommitHashes: build.gitCommitHashes,
    diffPatch: build.diffPatch,
    updatedAt: build.updatedAt,
    planDocument: typeof build.buildPlan === "string" ? build.buildPlan : serializePlanDocument(build.buildPlan),
    description: build.description,
    buildExecState: build.buildExecState,
  });
}

export function buildSandboxStateFromRecord(input: SandboxRecordInput): BuildSandboxState {
  const observedAt = input.updatedAt
    ? (input.updatedAt instanceof Date ? input.updatedAt.toISOString() : input.updatedAt)
    : null;
  const { sourceDiffstat, ignoredDiffstat } = parseDiffstat(input.diffPatch ?? "");
  const expectedPaths = extractExpectedPlanFiles({
    planDocument: input.planDocument,
    description: input.description,
  });
  const changedPaths = new Set(sourceDiffstat.map((entry) => entry.path));
  const headSha = input.gitCommitHashes.at(-1) ?? null;

  return {
    source: "sandbox-git",
    branch: input.buildBranch,
    headSha,
    headAgeLabel: observedAt ? getTruthSourceAge(observedAt).label : null,
    commitsAhead: input.gitCommitHashes.length > 0 ? input.gitCommitHashes.length : null,
    sourceDiffstat,
    ignoredDiffstat,
    expectedPlanFiles: expectedPaths.map((path) => ({
      path,
      status: changedPaths.size === 0 ? "unknown" : changedPaths.has(path) ? "exists" : "missing",
    })),
    sourceCurrency: extractSourceCurrency(input.buildExecState),
    observedAt,
    unavailableReason: input.diffPatch ? null : "Live sandbox git diff is not available from the projection yet.",
  };
}

export function assertSandboxReadyForPromotion(state: BuildSandboxState): SandboxPromotionGateResult {
  const failures: string[] = [];

  if (state.sourceCurrency && state.sourceCurrency.recommendedAction !== "allow") {
    const reason = trimTrailingPeriod(state.sourceCurrency.reason ?? "no source-currency reason recorded");
    failures.push(
      `Sandbox source is ${state.sourceCurrency.status} and requires ${state.sourceCurrency.recommendedAction}: ${reason}.`,
    );
  }

  const missingPlanFiles = state.expectedPlanFiles.filter((file) => file.status === "missing");
  if (missingPlanFiles.length > 0) {
    failures.push(
      `Captured diff is missing files promised by the build plan: ${missingPlanFiles.map((file) => file.path).join(", ")}.`,
    );
  }

  const unknownPlanFiles = state.expectedPlanFiles.filter((file) => file.status === "unknown");
  if (unknownPlanFiles.length > 0) {
    failures.push(
      `Captured diff could not prove planned files are present: ${unknownPlanFiles.map((file) => file.path).join(", ")}.`,
    );
  }

  if (failures.length === 0) {
    return { ok: true, message: "Sandbox promotion integrity checks passed." };
  }

  const hasSourceCurrencyFailure = Boolean(state.sourceCurrency && state.sourceCurrency.recommendedAction !== "allow");
  const hasPlanFailure = missingPlanFiles.length > 0 || unknownPlanFiles.length > 0;
  const message = hasSourceCurrencyFailure && hasPlanFailure
    ? "Sandbox promotion blocked: source is not promotable and the captured diff is missing files promised by the build plan."
    : hasSourceCurrencyFailure
      ? "Sandbox promotion blocked: source is not promotable."
      : "Sandbox promotion blocked: captured diff is missing files promised by the build plan.";

  return {
    ok: false,
    message,
    failures,
    state,
  };
}

export function parseDiffstat(diffPatch: string): {
  sourceDiffstat: BuildSandboxDiffEntry[];
  ignoredDiffstat: IgnoredSandboxDiffEntry[];
} {
  const sourceDiffstat: BuildSandboxDiffEntry[] = [];
  const ignoredDiffstat: IgnoredSandboxDiffEntry[] = [];
  const blocks = diffPatch.split(/^diff --git /m).filter((block) => block.trim());

  for (const block of blocks) {
    const header = block.match(/^a\/(.+?)\s+b\/(.+?)$/m);
    const path = header?.[2] ?? header?.[1];
    if (!path) {
      continue;
    }

    const ignoredReason = getIgnoredReason(path);
    if (ignoredReason) {
      ignoredDiffstat.push({ path, reason: ignoredReason });
      continue;
    }

    let additions = 0;
    let deletions = 0;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("+++") || line.startsWith("---")) {
        continue;
      }
      if (line.startsWith("+")) {
        additions++;
      } else if (line.startsWith("-")) {
        deletions++;
      }
    }
    sourceDiffstat.push({ path, additions, deletions });
  }

  return { sourceDiffstat, ignoredDiffstat };
}

export function extractExpectedPlanFiles(args: {
  planDocument: string | null;
  description: string | null;
}): string[] {
  const paths = new Set<string>();
  const section = extractFileStructureSection(args.planDocument);
  if (section) {
    for (const line of section.split(/\r?\n/)) {
      if (!/^\s*-\s*(?:Create|Modify):?/i.test(line)) {
        continue;
      }
      for (const path of extractFilePaths(line)) {
        paths.add(path);
      }
    }
  }

  if (paths.size === 0 && args.description) {
    for (const path of extractFilePaths(args.description)) {
      paths.add(path);
    }
  }

  return [...paths];
}

function extractFileStructureSection(planDocument: string | null): string | null {
  if (!planDocument) {
    return null;
  }
  const match = planDocument.match(/## File Structure\s*\r?\n([\s\S]*?)(?:\r?\n## |\s*$)/i);
  return match?.[1] ?? null;
}

function extractFilePaths(value: string): string[] {
  return [...value.matchAll(/\b(?:apps|packages)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g)]
    .map((match) => match[0].replace(/[),.;:]$/, ""));
}

function trimTrailingPeriod(value: string): string {
  return value.replace(/\.+$/, "");
}

function getIgnoredReason(path: string): IgnoredSandboxDiffEntry["reason"] | null {
  if (path.includes("/.next/") || path.startsWith(".next/") || path.includes("/coverage/")) {
    return "generated";
  }
  if (path.includes("node_modules/") || path.includes(".pnpm-store/")) {
    return "dependency";
  }
  if (path.endsWith(".log") || path.includes("/.cache/")) {
    return "cache";
  }
  return null;
}

export function serializePlanDocument(plan: unknown): string | null {
  if (!plan || typeof plan !== "object") {
    return null;
  }
  const record = plan as { fileStructure?: Array<{ action?: string; path?: string; purpose?: string }> };
  if (!Array.isArray(record.fileStructure)) {
    return null;
  }
  const lines = record.fileStructure
    .map((file) => `- ${file.action === "modify" ? "Modify" : "Create"} \`${file.path ?? ""}\`: ${file.purpose ?? ""}`);
  return `## File Structure\n${lines.join("\n")}`;
}

function extractSourceCurrency(value: unknown): SandboxSourceCurrencySnapshot | null {
  const sourceCurrency = isRecord(value) ? value.sourceCurrency : null;
  if (!isRecord(sourceCurrency)) {
    return null;
  }
  if (sourceCurrency.source !== "sandbox-git") {
    return null;
  }
  if (typeof sourceCurrency.status !== "string" || typeof sourceCurrency.targetRef !== "string") {
    return null;
  }
  return sourceCurrency as SandboxSourceCurrencySnapshot;
}
