// @vitest-environment jsdom
import "@/test-setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkCapsuleLaunchPanel } from "./WorkCapsuleLaunchPanel";

describe("WorkCapsuleLaunchPanel", () => {
  it("renders the planned commands when worktree is set", () => {
    render(
      <WorkCapsuleLaunchPanel
        steps={[
          {
            label: "Create the worktree from origin/main",
            command: 'git worktree add "D:\\DPF-work-control" -b "feat/work-control" "origin/main"',
          },
          {
            label: "Seed local MCP credentials into the new worktree",
            command: 'pwsh -File scripts\\seed-worktree-mcp.ps1 -Target "D:\\DPF-work-control"',
          },
        ]}
      />,
    );

    expect(screen.getByText(/Create the worktree from origin\/main/)).toBeInTheDocument();
    expect(screen.getByText(/git worktree add/)).toBeInTheDocument();
    expect(screen.getByText(/seed-worktree-mcp\.ps1/)).toBeInTheDocument();
  });

  it("renders an empty state when no steps are present", () => {
    render(<WorkCapsuleLaunchPanel steps={[]} />);

    expect(screen.getByText(/Plan the workspace first/)).toBeInTheDocument();
  });
});
