export type LaunchStep = {
  label: string;
  command: string;
};

type LaunchInput = {
  capsuleId: string;
  headBranch: string | null;
  worktreePath: string | null;
  baseBranch: string | null;
};

export function presentLaunchInstructions(capsule: LaunchInput, os: NodeJS.Platform): LaunchStep[] {
  if (!capsule.headBranch || !capsule.worktreePath) return [];

  const base = capsule.baseBranch ?? "main";
  const createWorktree = {
    label: `Create the worktree from origin/${base}`,
    command: `git worktree add "${capsule.worktreePath}" -b "${capsule.headBranch}" "origin/${base}"`,
  };

  if (os === "win32") {
    return [
      createWorktree,
      {
        label: "Seed local MCP credentials into the new worktree",
        command: `pwsh -File scripts\\seed-worktree-mcp.ps1 -Target "${capsule.worktreePath}"`,
      },
    ];
  }

  return [
    createWorktree,
    {
      label: "Seed local MCP credentials into the new worktree",
      command: `bash scripts/seed-worktree-mcp.sh "${capsule.worktreePath}"`,
    },
  ];
}
