import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetSemanticReviewSourceSensitivityCache,
  resolveSemanticReviewSourceSensitivity,
  SOURCE_VISIBILITY_TTL_MS,
  type SemanticReviewSourceDb,
} from "./semantic-review-source-sensitivity";

const UPSTREAM = "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git";
const db = (config: { upstreamRemoteUrl: string | null; contributionMode: string | null } | null): SemanticReviewSourceDb => ({
  platformDevConfig: { findUnique: vi.fn(async () => config) },
});

beforeEach(() => resetSemanticReviewSourceSensitivityCache());

describe("semantic review source sensitivity (BI-B76DC66C)", () => {
  it("treats a public managed repository that the install contributes to as development source", async () => {
    const readVisibility = vi.fn(async () => "public" as const);
    await expect(resolveSemanticReviewSourceSensitivity({ db: db({ upstreamRemoteUrl: UPSTREAM, contributionMode: "selective" }), readVisibility }))
      .resolves.toBe("development");
    expect(readVisibility).toHaveBeenCalledWith(expect.objectContaining({ owner: "OpenDigitalProductFactory", repo: "opendigitalproductfactory" }));
  });

  it.each([
    ["no config row", null, "public"],
    ["no repository named", { upstreamRemoteUrl: null, contributionMode: "contribute_all" }, "public"],
    ["a private repository", { upstreamRemoteUrl: UPSTREAM, contributionMode: "contribute_all" }, "private"],
    ["an unreadable repository", { upstreamRemoteUrl: UPSTREAM, contributionMode: "contribute_all" }, "unknown"],
    ["an install that keeps changes private", { upstreamRemoteUrl: UPSTREAM, contributionMode: "private" }, "public"],
    ["a fork-only install", { upstreamRemoteUrl: UPSTREAM, contributionMode: "fork_only" }, "public"],
  ] as const)("keeps the internal floor for %s", async (_label, config, visibility) => {
    await expect(resolveSemanticReviewSourceSensitivity({ db: db(config), readVisibility: async () => visibility }))
      .resolves.toBe("internal");
  });

  it("keeps the internal floor when the configuration cannot be read", async () => {
    const failing: SemanticReviewSourceDb = { platformDevConfig: { findUnique: vi.fn(async () => { throw new Error("db down"); }) } };
    await expect(resolveSemanticReviewSourceSensitivity({ db: failing, readVisibility: async () => "public" })).resolves.toBe("internal");
  });

  it("reuses a public answer within the TTL and asks again after it", async () => {
    const readVisibility = vi.fn(async () => "public" as const);
    const config = db({ upstreamRemoteUrl: UPSTREAM, contributionMode: "selective" });
    let now = 1_000;
    await resolveSemanticReviewSourceSensitivity({ db: config, readVisibility, now: () => now });
    now += SOURCE_VISIBILITY_TTL_MS - 1;
    await resolveSemanticReviewSourceSensitivity({ db: config, readVisibility, now: () => now });
    expect(readVisibility).toHaveBeenCalledTimes(1);
    now += 2;
    await resolveSemanticReviewSourceSensitivity({ db: config, readVisibility, now: () => now });
    expect(readVisibility).toHaveBeenCalledTimes(2);
  });

  it("never caches a failed read", async () => {
    const readVisibility = vi.fn().mockResolvedValueOnce("unknown").mockResolvedValueOnce("public");
    const config = db({ upstreamRemoteUrl: UPSTREAM, contributionMode: "selective" });
    await expect(resolveSemanticReviewSourceSensitivity({ db: config, readVisibility })).resolves.toBe("internal");
    await expect(resolveSemanticReviewSourceSensitivity({ db: config, readVisibility })).resolves.toBe("development");
  });

  it("stops trusting a cached answer when the operator saves a different repository", async () => {
    const readVisibility = vi.fn().mockResolvedValueOnce("public").mockResolvedValueOnce("private");
    await resolveSemanticReviewSourceSensitivity({ db: db({ upstreamRemoteUrl: UPSTREAM, contributionMode: "selective" }), readVisibility });
    await expect(resolveSemanticReviewSourceSensitivity({
      db: db({ upstreamRemoteUrl: "https://github.com/acme/private-fork.git", contributionMode: "selective" }), readVisibility,
    })).resolves.toBe("internal");
  });
});
