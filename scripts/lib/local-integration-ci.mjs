export function integrationBranchName(candidateBranch) {
  return `local-integration/${
    candidateBranch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  }`;
}

export function defaultBuildStrategy(hostPlatform = process.platform) {
  return hostPlatform === "win32" ? "docker-build" : "host-next";
}

export function dockerBuildTag(candidateBranch) {
  return `dpf-${integrationBranchName(candidateBranch).replace(/\//g, "-")}-build`;
}

export function createLocalIntegrationPlan(input) {
  const branch = integrationBranchName(input.candidateBranch);
  const buildStrategy = input.buildStrategy ?? defaultBuildStrategy(input.hostPlatform);
  const productionBuildCommand = buildStrategy === "docker-build"
    ? ["docker", "build", "--target", "build", "-t", dockerBuildTag(input.candidateBranch), "."]
    : ["pnpm", "--filter", "web", "exec", "next", "build"];
  const commands = [
    ["git", "fetch", "origin", "main"],
    ["git", "checkout", "-B", branch, "origin/main"],
    ["git", "merge", "--no-ff", "--no-edit", input.candidateBranch],
    ...input.siblingBranches.map((sibling) => ["git", "merge", "--no-ff", "--no-edit", sibling]),
    // Step-zero sandbox freshness gate (BI-ECDF9520): after the merge changes
    // pnpm-lock.yaml, node_modules must be proven to match it before any
    // test/build result counts as product evidence. Exits 3/4 (sandbox drift /
    // not ready) instead of letting a stale install masquerade as a red build.
    ["node", "scripts/sandbox-freshness-preflight.mjs", "--converge", "--branch", branch],
    ["pnpm", "--filter", "web", "exec", "vitest", "run"],
    ["pnpm", "--filter", "web", "typecheck"],
    productionBuildCommand,
  ];
  return {
    mode: input.mode,
    integrationBranch: branch,
    buildStrategy,
    commands,
  };
}
