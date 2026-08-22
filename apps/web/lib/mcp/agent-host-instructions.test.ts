import { describe, expect, it } from "vitest";
import type { InstallHostProfile } from "@/lib/install/host-profile";
import {
  buildAgentHostInstructions,
  resolveAgentAuthorityTier,
} from "./agent-host-instructions";

const CONSUMER: InstallHostProfile = {
  kind: "consumer",
  installMode: "consumer",
  sourceCapable: false,
  releaseImage: true,
  reason: "consumer-release-install",
};

const SOURCE: InstallHostProfile = {
  kind: "source",
  installMode: "customizer",
  sourceCapable: true,
  releaseImage: false,
  reason: "git-source-present",
};

describe("resolveAgentAuthorityTier", () => {
  it.each([
    [{ scope: "admin" as const, scopes: ["backlog_read"] }, "admin"],
    [{ scope: "write" as const, scopes: ["sandbox_execute", "work_capsule_adopt"] }, "development"],
    [{ scope: "write" as const, scopes: ["marketing_write"] }, "employee"],
    [{ scope: "read" as const, scopes: ["backlog_read"] }, "observer"],
  ] as const)("derives effective authority from grants", (token, expected) => {
    expect(resolveAgentAuthorityTier(token)).toBe(expected);
  });
});

describe("buildAgentHostInstructions", () => {
  it("makes a consumer runtime safe for a development agent", () => {
    const copy = buildAgentHostInstructions(CONSUMER, {
      scope: "write",
      scopes: ["sandbox_execute", "work_capsule_adopt", "code_graph_read"],
    });

    expect(copy).toContain("CONSUMER RUNTIME HOST");
    expect(copy).toContain("not a source checkout");
    expect(copy).toContain("separate source checkout and governed worktree");
    expect(copy).toContain("effective authority: development");
    expect(copy).toContain("MCP is authoritative");
  });

  it("describes source-backed work without consumer prohibitions", () => {
    const copy = buildAgentHostInstructions(SOURCE, {
      scope: "write",
      scopes: ["sandbox_execute", "work_capsule_adopt"],
    });

    expect(copy).toContain("SOURCE-CAPABLE HOST");
    expect(copy).toContain("effective authority: development");
    expect(copy).not.toContain("not a source checkout");
  });

  it("tells an observer that reads do not authorize mutations", () => {
    const copy = buildAgentHostInstructions(CONSUMER, {
      scope: "read",
      scopes: ["backlog_read"],
    });

    expect(copy).toContain("effective authority: observer");
    expect(copy).toContain("Do not mutate");
  });

  it("fails closed for an unknown host", () => {
    const copy = buildAgentHostInstructions({
      kind: "unknown",
      installMode: null,
      sourceCapable: false,
      releaseImage: false,
      reason: "insufficient-install-evidence",
    }, { scope: "admin", scopes: ["admin_write"] });

    expect(copy).toContain("UNVERIFIED HOST");
    expect(copy).toContain("Do not edit host files or run source-based upgrade work");
  });
});

