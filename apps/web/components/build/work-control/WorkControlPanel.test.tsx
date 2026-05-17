import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WorkControlPanel } from "./WorkControlPanel";

describe("WorkControlPanel", () => {
  it("renders active capsule rows", () => {
    const html = renderToStaticMarkup(
      <WorkControlPanel
        capsules={[{
          capsuleId: "WC-1",
          title: "Adopt work",
          status: "working",
          source: "external-adoption",
          executorKind: "codex-desktop",
          branch: "feat/adopt",
          worktreePath: "D:/DPF-adopt",
          pullRequestUrl: null,
          health: "ok",
          updatedAt: "2026-05-14T00:00:00.000Z",
        }]}
        adoptable={[]}
        createAction={vi.fn()}
      />,
    );

    expect(html).toContain("Work Control");
    expect(html).toContain("Adopt work");
    expect(html).toContain("feat/adopt");
  });

  it("renders empty state", () => {
    const html = renderToStaticMarkup(<WorkControlPanel capsules={[]} adoptable={[]} createAction={vi.fn()} />);

    expect(html).toContain("No active capsules yet.");
    expect(html).toContain("Plan governed work");
  });

  it("renders adoptable worktree rows surfaced by the scanner", () => {
    const html = renderToStaticMarkup(
      <WorkControlPanel
        capsules={[]}
        adoptable={[{
          path: "D:/DPF-orphan",
          branch: "fix/orphan",
          modifiedCount: 3,
          untrackedCount: 1,
        }]}
        createAction={vi.fn()}
      />,
    );

    expect(html).toContain("D:/DPF-orphan");
    expect(html).toContain("fix/orphan");
    expect(html).toContain("4");
  });
});
