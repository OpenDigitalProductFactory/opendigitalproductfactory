export function integrationBranchName(candidateBranch) {
  return `local-integration/${
    candidateBranch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  }`;
}

export function createLocalIntegrationPlan(input) {
  const branch = integrationBranchName(input.candidateBranch);
  const commands = [
    ["git", "fetch", "origin", "main"],
    ["git", "checkout", "-B", branch, "origin/main"],
    ["git", "merge", "--no-ff", "--no-edit", input.candidateBranch],
    ...input.siblingBranches.map((sibling) => ["git", "merge", "--no-ff", "--no-edit", sibling]),
    ["pnpm", "--filter", "web", "exec", "vitest", "run"],
    ["pnpm", "--filter", "web", "typecheck"],
    ["pnpm", "--filter", "web", "exec", "next", "build"],
  ];
  return {
    mode: input.mode,
    integrationBranch: branch,
    commands,
  };
}
