import { describe, expect, it } from "vitest";
import type { InstallHostProfile } from "@/lib/install/host-profile";
import { resolveInstanceStance } from "@dpf/db/installation-instance-stance";
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
    [{ scope: "read" as const, scopes: ["admin_write", "sandbox_execute"] }, "observer"],
  ] as const)("derives effective authority from grants", (token, expected) => {
    expect(resolveAgentAuthorityTier(token)).toBe(expected);
  });
});

describe("buildAgentHostInstructions", () => {
  const stance = (environmentClass: "development" | "test" | "production") =>
    resolveInstanceStance({ schemaVersion: 1, profileFingerprint: "test", evidence: [], environmentClass, primaryPurpose: "evolve-dpf", secondaryPurposes: [],
      relationshipIntents: [], confidence: "high", confirmationStatus: "confirmed" }, { sourceCapable: false });

  it.each(["development", "test"] as const)("owns routine granted %s exercise", (environment) => {
    const copy = buildAgentHostInstructions(CONSUMER, { scope: "admin", scopes: ["admin_write"] }, stance(environment));
    expect(copy).toContain("Routine already-authorized work");
    expect(copy).toContain("without another operator hand-off");
    expect(copy).toContain("issue_ux_verification_sign_in");
    expect(copy).toContain("never grants authority");
  });

  it("retains production credential handling and does not promise DEV autonomy", () => {
    const copy = buildAgentHostInstructions(CONSUMER, { scope: "admin", scopes: ["admin_write"] }, stance("production"));
    expect(copy).toContain("operator-only");
    expect(copy).not.toContain("Routine already-authorized work");
  });

  it("does not instruct an observer to mint sessions on DEV", () => {
    const copy = buildAgentHostInstructions(CONSUMER, { scope: "read", scopes: ["sandbox_execute"] }, stance("development"));
    expect(copy).toContain("Read and report only");
    expect(copy).not.toContain("Routine already-authorized work");
  });

  it("states cautious unknown installation context explicitly", () => {
    const copy = buildAgentHostInstructions(CONSUMER, { scope: "admin", scopes: ["admin_write"] });
    expect(copy).toContain("INSTALLATION IDENTITY: unverified");
  });
  it("carries scoped investment and conflict guidance on both host surfaces", () => {
    for (const host of [CONSUMER, SOURCE]) {
      const copy = buildAgentHostInstructions(host, { scope: "admin", scopes: [] });
      expect(copy).toContain("80% refactoring");
      expect(copy).toContain("default 20% refactoring, 80% new capability");
      expect(copy).toContain("never infer them from the installation");
      expect(copy).toContain("record the superseded guidance and overlapping work");
    }
  });
  it("distinguishes delegated routine administration from retained approval boundaries", () => {
    const copy = buildAgentHostInstructions(CONSUMER, { scope: "admin", scopes: ["admin_write"] });
    expect(copy).toContain("Reuse current delegation");
    expect(copy).toContain("do not request fresh approval solely because an action administers this install");
    expect(copy).toContain("Credential or authority changes, destructive actions and restricted data retain their required gates");
    expect(copy).toContain("A development label never grants additional authority");
  });
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
