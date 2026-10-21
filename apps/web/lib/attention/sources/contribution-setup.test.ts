import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/platform-dev-config", () => ({ hasContributionToken: vi.fn() }));

import { contributionSetupGap, contributionSetupToAttentionItem } from "./contribution-setup";

describe("contributionSetupGap", () => {
  it("asks to connect GitHub when contributing was chosen but no credential exists (this dev install, 2026-09-25)", () => {
    expect(contributionSetupGap({ contributionMode: "contributing", decidedByPerson: true, hasContributionCredential: false })).toBe("connect");
  });

  it("asks for the decision on a platform-development install when none was made, including the seed's private default", () => {
    expect(contributionSetupGap({ contributionMode: null, decidedByPerson: false, hasContributionCredential: false, installationPurpose: "evolve-dpf" })).toBe("decide");
    expect(contributionSetupGap({ contributionMode: "private", decidedByPerson: false, hasContributionCredential: false, installationPurpose: "evolve-dpf" })).toBe("decide");
  });

  it("does not nag an install that does not develop the platform about an undecided default", () => {
    expect(contributionSetupGap({ contributionMode: "private", decidedByPerson: false, hasContributionCredential: false, installationPurpose: "operate-organization" })).toBeNull();
    expect(contributionSetupGap({ contributionMode: null, decidedByPerson: false, hasContributionCredential: false })).toBeNull();
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

// BI-985F4EC9: the nudge stays open for a platform-development install until
// its managed repository is Connected.
describe("managed repository gap", () => {
  const settled = { contributionMode: "private", decidedByPerson: true, hasContributionCredential: false, installationPurpose: "evolve-dpf" };

  it.each(["not-connected", "read-only", "no-access", "login-expired", "check-failed"] as const)(
    "stays open while the repository is %s",
    (status) => {
      expect(contributionSetupGap({ ...settled, managedRepositoryStatus: status })).toBe("repository");
    },
  );

  it("closes when the repository is Connected", () => {
    expect(contributionSetupGap({ ...settled, managedRepositoryStatus: "connected" })).toBeNull();
  });

  it("does not raise it for installs that do not develop the platform", () => {
    expect(contributionSetupGap({ ...settled, installationPurpose: "operate-organization", managedRepositoryStatus: "not-connected" })).toBeNull();
  });

  it("raises it for an organisation install that also declares evolve-dpf as a secondary purpose", () => {
    expect(contributionSetupGap({ ...settled, installationPurpose: "operate-organization", managesRepository: true, managedRepositoryStatus: "not-connected" })).toBe("repository");
  });

  it("asks the contribution question first", () => {
    expect(contributionSetupGap({ ...settled, decidedByPerson: false, managedRepositoryStatus: "not-connected" })).toBe("decide");
  });

  it("leads to the Managed repository section", () => {
    const item = contributionSetupToAttentionItem("repository", "2026-10-14T00:00:00.000Z");
    expect(item).toMatchObject({ id: "contribution-setup:repository", deepLink: "/admin/platform-development#managed-repository" });
  });
});
