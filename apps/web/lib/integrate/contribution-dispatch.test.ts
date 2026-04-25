import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveContributionDispatch } from "./contribution-dispatch";

const UPSTREAM_OWNER = "OpenDigitalProductFactory";
const UPSTREAM_REPO = "opendigitalproductfactory";

function withFlag<T>(value: string | undefined, fn: () => T): T {
  const orig = process.env.CONTRIBUTION_MODEL_ENABLED;
  if (value === undefined) delete process.env.CONTRIBUTION_MODEL_ENABLED;
  else process.env.CONTRIBUTION_MODEL_ENABLED = value;
  try {
    return fn();
  } finally {
    if (orig === undefined) delete process.env.CONTRIBUTION_MODEL_ENABLED;
    else process.env.CONTRIBUTION_MODEL_ENABLED = orig;
  }
}

describe("resolveContributionDispatch", () => {
  const baseInput = {
    upstreamOwner: UPSTREAM_OWNER,
    upstreamRepo: UPSTREAM_REPO,
    contributorForkOwner: null as string | null,
    contributorForkRepo: null as string | null,
    forkVerifiedAt: null as Date | null,
  };

  beforeEach(() => {
    delete process.env.CONTRIBUTION_MODEL_ENABLED;
  });
  afterEach(() => {
    delete process.env.CONTRIBUTION_MODEL_ENABLED;
  });

  it("flag OFF — direct path with head === base, regardless of contributionModel", () => {
    const result = withFlag(undefined, () =>
      resolveContributionDispatch({ ...baseInput, contributionModel: "fork-pr" }),
    );
    expect(result).toEqual({
      kind: "direct",
      headOwner: UPSTREAM_OWNER,
      headRepo: UPSTREAM_REPO,
      baseOwner: UPSTREAM_OWNER,
      baseRepo: UPSTREAM_REPO,
    });
  });

  it("flag ON + contributionModel === null — returns error, no dispatch", () => {
    const result = withFlag("true", () =>
      resolveContributionDispatch({ ...baseInput, contributionModel: null }),
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.error).toMatch(/not configured/i);
  });

  it("flag ON + maintainer-direct — direct path with head === base", () => {
    const result = withFlag("true", () =>
      resolveContributionDispatch({ ...baseInput, contributionModel: "maintainer-direct" }),
    );
    expect(result).toEqual({
      kind: "direct",
      headOwner: UPSTREAM_OWNER,
      headRepo: UPSTREAM_REPO,
      baseOwner: UPSTREAM_OWNER,
      baseRepo: UPSTREAM_REPO,
    });
  });

  it("flag ON + fork-pr + fork config missing — returns error", () => {
    const result = withFlag("true", () =>
      resolveContributionDispatch({ ...baseInput, contributionModel: "fork-pr" }),
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.error).toMatch(/fork is configured|fork setup/i);
  });

  it("flag ON + fork-pr + verified within 24h — fork path, no reverification, needs merge-upstream", () => {
    const now = new Date("2026-04-24T10:00:00Z");
    const verified = new Date(now.getTime() - 60 * 60 * 1000); // 1 h ago
    const result = withFlag("true", () =>
      resolveContributionDispatch({
        ...baseInput,
        contributionModel: "fork-pr",
        contributorForkOwner: "jane-dev",
        contributorForkRepo: UPSTREAM_REPO,
        forkVerifiedAt: verified,
        now,
      }),
    );
    expect(result.kind).toBe("fork");
    if (result.kind === "fork") {
      expect(result.headOwner).toBe("jane-dev");
      expect(result.headRepo).toBe(UPSTREAM_REPO);
      expect(result.baseOwner).toBe(UPSTREAM_OWNER);
      expect(result.baseRepo).toBe(UPSTREAM_REPO);
      expect(result.needsForkReverification).toBe(false);
      expect(result.needsMergeUpstream).toBe(true);
    }
  });

  it("flag ON + fork-pr + verified more than 24h ago — fork path with reverification flag set", () => {
    const now = new Date("2026-04-24T10:00:00Z");
    const verified = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25 h ago
    const result = withFlag("true", () =>
      resolveContributionDispatch({
        ...baseInput,
        contributionModel: "fork-pr",
        contributorForkOwner: "jane-dev",
        contributorForkRepo: UPSTREAM_REPO,
        forkVerifiedAt: verified,
        now,
      }),
    );
    expect(result.kind).toBe("fork");
    if (result.kind === "fork") expect(result.needsForkReverification).toBe(true);
  });

  it("flag ON + fork-pr + forkVerifiedAt null — fork path with reverification flag set (fresh or deferred)", () => {
    const result = withFlag("true", () =>
      resolveContributionDispatch({
        ...baseInput,
        contributionModel: "fork-pr",
        contributorForkOwner: "jane-dev",
        contributorForkRepo: UPSTREAM_REPO,
        forkVerifiedAt: null,
      }),
    );
    expect(result.kind).toBe("fork");
    if (result.kind === "fork") expect(result.needsForkReverification).toBe(true);
  });

  it("flag ON + unrecognized contributionModel — error", () => {
    const result = withFlag("true", () =>
      resolveContributionDispatch({ ...baseInput, contributionModel: "mystery-mode" }),
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.error).toMatch(/unrecognized/i);
  });
});
