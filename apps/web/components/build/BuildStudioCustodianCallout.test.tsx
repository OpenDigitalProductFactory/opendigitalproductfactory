import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BuildStudioCustodianCallout } from "./BuildStudioCustodianCallout";
import type { BuildStudioCustodianPrompt } from "./build-studio-custodian";

function prompt(overrides: Partial<BuildStudioCustodianPrompt> = {}): BuildStudioCustodianPrompt {
  return {
    dismissKey: "one",
    title: "I can keep this review moving.",
    whyNow: "UX verification still needs clean evidence, so another quiet click can look like nothing happened.",
    recommendedAction: "I can collect the acceptance evidence and report the one next decision.",
    primaryLabel: "Let AI Coworker handle it",
    primaryAction: "coworker",
    coworkerPrompt: "Act as custodian.",
    statusLabel: "Needs evidence",
    intent: "warning",
    details: ["UX evidence is missing.", "Acceptance evidence is missing."],
    proactivityPlan: {
      resolvedLevel: "assertive",
      policyId: "proactivity:build-studio-custodian:assertive",
      attentionWindowMinutes: 30,
      followUpCadenceMinutes: [30, 60, 120],
      maxAttempts: 3,
      spendClass: "elevated",
      channelPolicy: "urgent-channel",
      escalationTarget: "platform-operator",
      actionBoundary: "propose",
      explanation: "Build Studio work is blocked or stalled.",
      evidenceRefs: [{ kind: "activity-family", id: "build-studio-custodian" }],
    },
    ...overrides,
  };
}

describe("BuildStudioCustodianCallout", () => {
  it("renders one proactive recommendation with one primary action", () => {
    const html = renderToStaticMarkup(
      <BuildStudioCustodianCallout prompt={prompt()} onPrimaryAction={vi.fn()} onSnooze={vi.fn()} />,
    );

    expect(html).toContain("AI Coworker proactive help");
    expect(html).toContain("I can keep this review moving.");
    expect(html).toContain("UX verification still needs clean evidence");
    expect(html).toContain("Let AI Coworker handle it");
    expect(html.match(/Let AI Coworker handle it/g)).toHaveLength(1);
    expect(html).toContain("Show why");
    expect(html).toContain("Snooze");
  });

  it("keeps explanation details collapsed by default", () => {
    const html = renderToStaticMarkup(
      <BuildStudioCustodianCallout prompt={prompt()} onPrimaryAction={vi.fn()} onSnooze={vi.fn()} />,
    );

    expect(html).not.toContain("UX evidence is missing.");
    expect(html).not.toContain("Acceptance evidence is missing.");
  });
});
