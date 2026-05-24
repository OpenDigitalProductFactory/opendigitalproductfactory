import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PortalContextStrip } from "./PortalContextStrip";
import type { PortalContextEnvelope } from "@/lib/portal-context";

describe("PortalContextStrip", () => {
  it("renders route-only Build Studio context with no_active_build signal and theme tokens", () => {
    const html = renderToStaticMarkup(<PortalContextStrip envelope={makeEnvelope()} />);

    expect(html).toContain("Portal context");
    expect(html).toContain("Build Studio");
    expect(html).toContain("No active build");
    expect(html).toContain("Select build");
    expect(html).toContain("text-[var(--dpf-text)]");
    expect(html).toContain("border-[var(--dpf-border)]");
    expect(html).not.toMatch(/text-gray|bg-white|#[0-9a-fA-F]{3,6}/);
  });

  it("D11 (2026-05-23): does NOT render the no_active_build AttentionChip when the buildLabel chip already says 'No active build' (dedupe)", () => {
    // Repro: PortalContextStrip used to render "No active build" twice when
    // the user was on /build with no featureBuild anchor — once as the
    // buildLabel chip (left of strip) and again as a yellow warning
    // AttentionChip (right of it). Looked like the strip was broken /
    // double-announcing the same state. The fix suppresses only the
    // AttentionChip rendering (the right-side action button stays — it
    // is genuinely useful).
    const html = renderToStaticMarkup(<PortalContextStrip envelope={makeEnvelope()} />);
    // The buildLabel chip says "No active build" exactly once.
    const noActiveMatches = html.match(/No active build/g) ?? [];
    expect(noActiveMatches.length).toBe(1);
    // The "Select build" action button is preserved — it is the actionable
    // affordance the user needs to recover from the no-build state.
    expect(html).toContain("Select build");
  });

  it("D11 (2026-05-23): still renders the AttentionChip for OTHER signal kinds (only no_active_build is deduped)", () => {
    // Regression guard: the D11 fix must NOT suppress unrelated warnings.
    // A lease_expired signal should still produce an AttentionChip even
    // when the buildLabel chip might happen to show the same featureBuild.
    const html = renderToStaticMarkup(<PortalContextStrip envelope={makeEnvelope({
      attention: [{
        kind: "lease_expired",
        severity: "warning",
        message: "Work capsule lease expired.",
      }],
    })} />);
    expect(html).toContain("Lease expired");
  });

  it("warning AttentionChip does NOT use the same token for background and foreground (regression: yellow-on-yellow chip)", () => {
    // Repro: AttentionChip rendered a solid yellow rectangle because
    // bg-[var(--dpf-state-warning)] resolved to the same CSS variable as
    // text-[var(--dpf-warning)] (--dpf-state-warning was aliased to --dpf-warning).
    // The token separation lives in globals.css; this assertion pins the
    // component contract so a future refactor can't reintroduce the alias.
    const html = renderToStaticMarkup(<PortalContextStrip envelope={makeEnvelope({
      attention: [{
        kind: "lease_expired",
        severity: "warning",
        message: "Work capsule lease expired.",
      }],
    })} />);

    // The chip must render and use distinct fg/bg tokens.
    expect(html).toContain("bg-[var(--dpf-state-warning)]");
    expect(html).toContain("text-[var(--dpf-warning)]");
    // Must not collapse to a single var-source (the bug).
    expect(html).not.toMatch(/bg-\[var\(--dpf-warning\)\][^"]*text-\[var\(--dpf-warning\)\]/);
    // And the signal label must be in the DOM so the chip isn't visually empty.
    // signalLabel() in PortalContextStrip.tsx returns "Lease expired" (Capital L)
    // for kind="lease_expired"; the assertion matches that canonical label.
    expect(html).toContain("Lease expired");
  });

  it("error AttentionChip uses distinct fg/bg tokens (same class of bug)", () => {
    const html = renderToStaticMarkup(<PortalContextStrip envelope={makeEnvelope({
      attention: [{
        kind: "missing_evidence",
        severity: "error",
        message: "Required design doc is missing.",
      }],
    })} />);

    expect(html).toContain("bg-[var(--dpf-state-error)]");
    expect(html).toContain("text-[var(--dpf-error)]");
    expect(html).not.toMatch(/bg-\[var\(--dpf-error\)\][^"]*text-\[var\(--dpf-error\)\]/);
    expect(html).toContain("Missing evidence");
  });
});

function makeEnvelope(overrides: Partial<PortalContextEnvelope> = {}): PortalContextEnvelope {
  return {
    envelopeId: "env-1",
    resolvedAt: "2026-05-17T18:23:30.000Z",
    route: {
      pathname: "/build",
      routeContext: "/build",
      domain: "Build Studio",
      sensitivity: "internal",
      docsPath: null,
    },
    organization: {
      organizationId: "ORG-1",
      name: "Digital Product Factory",
      archetypeId: "software-platform-operator",
    },
    user: {
      userId: "user-1",
      principalId: "principal-1",
      platformRole: "HR-000",
    },
    anchors: [],
    work: {
      backlogItem: null,
      epic: null,
      capsule: null,
      featureBuild: null,
      taskRun: null,
      agentThread: null,
      branch: null,
    },
    evidence: [],
    authority: {
      canActOnCapsule: true,
      canActOnBuild: true,
      canReviewPromotion: true,
      grantedToolKeys: [],
      proposalModeActive: false,
    },
    coworkers: [],
    attention: [
      {
        kind: "no_active_build",
        severity: "info",
        message: "No Build Studio work object is anchored in the URL.",
        actionLabel: "Select build",
        actionHref: "/build",
      },
    ],
    promptDigest: "Route: /build\nAttention: no_active_build(info)",
    ...overrides,
  };
}
