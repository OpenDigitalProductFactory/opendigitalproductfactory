import { describe, it, expect } from "vitest";
import {
  parseRepoCoords,
  classifyEgress,
  CANONICAL_UPSTREAM_OWNER,
  CANONICAL_UPSTREAM_REPO,
} from "./contribution-egress";

describe("parseRepoCoords", () => {
  it("parses HTTPS and SSH GitHub URLs", () => {
    expect(parseRepoCoords("https://github.com/acme/portal.git")).toEqual({ owner: "acme", repo: "portal" });
    expect(parseRepoCoords("git@github.com:acme/portal.git")).toEqual({ owner: "acme", repo: "portal" });
  });
  it("returns null for non-GitHub or empty input", () => {
    expect(parseRepoCoords("https://gitlab.com/acme/portal")).toBeNull();
    expect(parseRepoCoords(null)).toBeNull();
    expect(parseRepoCoords(undefined)).toBeNull();
  });
});

describe("classifyEgress", () => {
  const upstream = "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git";

  it("classifies the configured upstream as public-hive", () => {
    expect(classifyEgress({ owner: "acme", repo: "dpf-fork" }, "https://github.com/acme/dpf-fork.git"))
      .toBe("public-hive");
  });

  it("classifies the canonical DPF upstream as public-hive even when upstream is customized", () => {
    expect(classifyEgress({ owner: CANONICAL_UPSTREAM_OWNER, repo: CANONICAL_UPSTREAM_REPO }, "https://github.com/acme/private.git"))
      .toBe("public-hive");
  });

  it("classifies the canonical DPF upstream as public-hive when upstream is unset", () => {
    expect(classifyEgress({ owner: CANONICAL_UPSTREAM_OWNER, repo: CANONICAL_UPSTREAM_REPO }, null))
      .toBe("public-hive");
  });

  it("classifies a customer's own repo as own-repo (unfiltered home)", () => {
    expect(classifyEgress({ owner: "acme", repo: "our-private-portal" }, upstream)).toBe("own-repo");
  });

  it("is case-insensitive on owner/repo", () => {
    expect(classifyEgress({ owner: "opendigitalproductfactory", repo: "OpenDigitalProductFactory" }, null))
      .toBe("public-hive");
  });
});
