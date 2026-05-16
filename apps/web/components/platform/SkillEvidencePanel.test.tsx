import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SkillEvidencePanel } from "./SkillEvidencePanel";
import type { SkillEvidenceResult } from "@/lib/skills/evidence-search";

const evidence: SkillEvidenceResult[] = [
  {
    kind: "tool_execution",
    id: "tool-1",
    label: "apply_patch failed",
    summary: "Patch failed after timeout while applying skill guidance.",
    createdAt: "2026-05-15T12:05:00.000Z",
    refs: {
      skillId: "build-page",
      threadId: "thread-1",
      taskRunId: "TR-1",
      toolExecutionId: "tool-1",
    },
  },
  {
    kind: "improvement_proposal",
    id: "IP-SKL-1",
    label: "Proposal IP-SKL-1: Tighten retry guidance",
    summary: "Use clearer retry guidance when patching fails.",
    createdAt: "2026-05-15T12:10:00.000Z",
    refs: {
      skillId: "build-page",
      proposalId: "IP-SKL-1",
      threadId: "thread-1",
    },
  },
];

describe("SkillEvidencePanel", () => {
  it("renders an empty state when no evidence exists", () => {
    const html = renderToStaticMarkup(<SkillEvidencePanel evidence={[]} />);

    expect(html).toContain("No linked evidence yet");
  });

  it("renders evidence rows with labels, summaries, and refs", () => {
    const html = renderToStaticMarkup(
      <SkillEvidencePanel
        evidence={evidence}
        activeScope={{ threadId: "thread-1", query: "timeout" }}
      />,
    );

    expect(html).toContain("apply_patch failed");
    expect(html).toContain("Patch failed after timeout");
    expect(html).toContain("Proposal IP-SKL-1");
    expect(html).toContain("thread-1");
    expect(html).toContain("timeout");
  });

  it("uses only theme tokens and no hardcoded hex colors", () => {
    const html = renderToStaticMarkup(<SkillEvidencePanel evidence={evidence} />);

    expect(html).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(html).toContain("var(--dpf-");
  });
});
