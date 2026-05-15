import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
      />,
    );

    expect(html).toContain("Work Control");
    expect(html).toContain("Adopt work");
    expect(html).toContain("feat/adopt");
  });

  it("renders empty state", () => {
    const html = renderToStaticMarkup(<WorkControlPanel capsules={[]} adoptable={[]} />);

    expect(html).toContain("No active capsules yet.");
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
      />,
    );

    expect(html).toContain("D:/DPF-orphan");
    expect(html).toContain("fix/orphan");
    expect(html).toContain("4");
  });
});
