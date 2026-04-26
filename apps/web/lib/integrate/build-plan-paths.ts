import type { BuildPlanDoc } from "@/lib/explore/feature-build-types";
import { lazyFs, lazyPath } from "@/lib/shared/lazy-node";

type FileEntry = BuildPlanDoc["fileStructure"][number];
type ExistsFn = (absolutePath: string) => boolean;

export type BuildPlanPathRewrite = {
  from: string;
  to: string;
};

export type NormalizedBuildPlan = {
  plan: BuildPlanDoc;
  rewrites: BuildPlanPathRewrite[];
  unresolvedModifyPaths: string[];
};

const LEGACY_BUILD_STUDIO_PATH_ALIASES: Record<string, string> = {
  "apps/web/components/build-studio/BuildWorkspace.tsx": "apps/web/components/build/BuildStudio.tsx",
  "apps/web/components/build-studio/WorkflowGraphPanel.tsx": "apps/web/components/build/ProcessGraph.tsx",
  "apps/web/components/build-studio/DetailsPreviewPanel.tsx": "apps/web/components/build/BuildStudio.tsx",
};

const LEGACY_BUILD_STUDIO_TEXT_ALIASES: Array<{ from: RegExp; to: string }> = [
  { from: /\bBuildWorkspace\b/g, to: "BuildStudio" },
  { from: /\bWorkflowGraphPanel\b/g, to: "ProcessGraph" },
  { from: /\bDetailsPreviewPanel\b/g, to: "BuildStudio" },
];

function normalizeRelativePath(relativePath: string): string {
  return relativePath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function candidateAbsolutePaths(relativePath: string): string[] {
  const path = lazyPath();
  const normalized = normalizeRelativePath(relativePath);
  const appRelative = normalized.startsWith("apps/web/") ? normalized.slice("apps/web/".length) : null;
  const cwd = process.cwd();

  return Array.from(new Set([
    path.resolve(cwd, normalized),
    appRelative ? path.resolve(cwd, appRelative) : null,
    path.resolve(cwd, "..", normalized),
    appRelative ? path.resolve(cwd, "..", appRelative) : null,
    path.resolve(cwd, "../..", normalized),
    appRelative ? path.resolve(cwd, "../..", appRelative) : null,
    path.resolve("/workspace", normalized),
    appRelative ? path.resolve("/workspace", appRelative) : null,
    path.resolve("/app", normalized),
    appRelative ? path.resolve("/app/apps/web-src", appRelative) : null,
    path.resolve("/app/apps/web-src", normalized),
  ].filter((value): value is string => Boolean(value))));
}

function repoPathExists(relativePath: string, exists: ExistsFn = lazyFs().existsSync): boolean {
  return candidateAbsolutePaths(relativePath).some((absolutePath) => {
    try {
      return exists(absolutePath);
    } catch {
      return false;
    }
  });
}

function resolveLegacyAlias(relativePath: string, exists: ExistsFn): string {
  const normalized = normalizeRelativePath(relativePath);
  const exactAlias = LEGACY_BUILD_STUDIO_PATH_ALIASES[normalized];
  if (exactAlias && repoPathExists(exactAlias, exists)) {
    return exactAlias;
  }

  if (normalized.startsWith("apps/web/components/build-studio/")) {
    const folderAlias = normalized.replace("apps/web/components/build-studio/", "apps/web/components/build/");
    if (repoPathExists(folderAlias, exists)) {
      return folderAlias;
    }
  }

  return normalized;
}

function rewriteTaskText(text: string, rewrites: BuildPlanPathRewrite[]): string {
  const pathRewritten = rewrites.reduce((current, rewrite) => current.split(rewrite.from).join(rewrite.to), text);
  return LEGACY_BUILD_STUDIO_TEXT_ALIASES.reduce(
    (current, rewrite) => current.replace(rewrite.from, rewrite.to),
    pathRewritten,
  );
}

export function normalizeBuildPlanPaths(
  plan: BuildPlanDoc,
  options?: { exists?: ExistsFn },
): NormalizedBuildPlan {
  const exists = options?.exists ?? lazyFs().existsSync;
  const rewrites: BuildPlanPathRewrite[] = [];
  const unresolvedModifyPaths: string[] = [];

  const fileStructure = plan.fileStructure.map((entry) => {
    const originalPath = normalizeRelativePath(entry.path);
    const resolvedPath = resolveLegacyAlias(originalPath, exists);
    const resolvedEntry: FileEntry = {
      ...entry,
      path: resolvedPath,
    };

    if (resolvedPath !== originalPath) {
      rewrites.push({ from: originalPath, to: resolvedPath });
    }

    if (entry.action === "modify" && !repoPathExists(resolvedPath, exists)) {
      unresolvedModifyPaths.push(resolvedPath);
    }

    return resolvedEntry;
  });

  const tasks = plan.tasks.map((task) => ({
    ...task,
    implement: rewriteTaskText(task.implement, rewrites),
    testFirst: rewriteTaskText(task.testFirst, rewrites),
    verify: rewriteTaskText(task.verify, rewrites),
  }));

  return {
    plan: {
      ...plan,
      fileStructure,
      tasks,
    },
    rewrites,
    unresolvedModifyPaths: Array.from(new Set(unresolvedModifyPaths)),
  };
}
