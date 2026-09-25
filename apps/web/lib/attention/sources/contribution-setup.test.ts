import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/platform-dev-config", () => ({ hasContributionToken: vi.fn() }));

import { contributionSetupGap, contributionSetupToAttentionItem } from "./contribution-setup";

describe("contributionSetupGap", () => {
  it("asks to connect GitHub when contributing was chosen but no credential exists (this dev install, 2026-09-25)", () => {
    expect(contributionSetupGap({ contributionMode: "contributing", decidedByPerson: true, hasContributionCredential: false })).toBe("connect");
  });

  it("asks for the decision when none was made, including the seed's private default", () => {
    expect(contributionSetupGap({ contributionMode: null, decidedByPerson: false, hasContributionCredential: false })).toBe("decide");
    expect(contributionSetupGap({ contributionMode: "private", decidedByPerson: false, hasContributionCredential: false })).toBe("decide");
  });

  it("stays quiet once a person kept changes private, or contribution is fully set up", () => {
    expect(contributionSetupGap({ contributionMode: "private", decidedByPerson: true, hasContributionCredential: false })).toBeNull();
    expect(contributionSetupGap({ contributionMode: "contributing", decidedByPerson: true, hasContributionCredential: true })).toBeNull();
  });
});

describe("contributionSetupToAttentionItem", () => {
  it("leads straight to the Connect GitHub card", () => {
    const item = contributionSetupToAttentionItem("connect", "2026-09-25T00:00:00.000Z");
    expect(item).toMatchObject({ source: "contribution-setup", deepLink: "/admin/platform-development#connect-github" });
    expect(item.actions[0]).toMatchObject({ label: "Connect GitHub", href: "/admin/platform-development#connect-github" });
  });
});
