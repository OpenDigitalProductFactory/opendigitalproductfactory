import { describe, it, expect } from "vitest";
import {
  verificationPreflight,
  preflightDirective,
  type PreflightSignals,
} from "./verification-preflight";

// A baseline "ready to test" signal set; tests override one field at a time.
const READY: PreflightSignals = {
  acceptanceAlreadyMet: false,
  verificationAlreadyPassed: false,
  installHealthy: true,
  requiredServicesHealthy: true,
  buildArtifactPresent: true,
  explicitBlocker: null,
};

describe("verificationPreflight", () => {
  it("CAN_TEST when install + services + artifact are ready and no evidence yet", () => {
    const r = verificationPreflight(READY);
    expect(r.verdict).toBe("CAN_TEST");
    expect(r.blocker).toBeNull();
  });

  it("MUST_ADVANCE when acceptance is already met (never re-test)", () => {
    const r = verificationPreflight({ ...READY, acceptanceAlreadyMet: true });
    expect(r.verdict).toBe("MUST_ADVANCE");
    expect(r.blocker).toBeNull();
  });

  it("MUST_ADVANCE when a prior verification already passed", () => {
    const r = verificationPreflight({ ...READY, verificationAlreadyPassed: true });
    expect(r.verdict).toBe("MUST_ADVANCE");
  });

  it("evidence-sufficient wins even if a blocker is also present (no pointless re-test)", () => {
    const r = verificationPreflight({
      ...READY,
      acceptanceAlreadyMet: true,
      installHealthy: false,
      buildArtifactPresent: false,
    });
    expect(r.verdict).toBe("MUST_ADVANCE");
  });

  it("BLOCKED on an explicit blocker, before the health checks", () => {
    const r = verificationPreflight({ ...READY, explicitBlocker: "Portal is quiescing for a self-upgrade." });
    expect(r.verdict).toBe("BLOCKED");
    expect(r.blocker).toBe("explicit");
    expect(r.reason).toContain("quiescing");
  });

  it("ignores a blank explicit blocker", () => {
    const r = verificationPreflight({ ...READY, explicitBlocker: "   " });
    expect(r.verdict).toBe("CAN_TEST");
  });

  it("BLOCKED when the install is unhealthy", () => {
    const r = verificationPreflight({ ...READY, installHealthy: false });
    expect(r.verdict).toBe("BLOCKED");
    expect(r.blocker).toBe("install_unhealthy");
  });

  it("BLOCKED when a required service is down", () => {
    const r = verificationPreflight({ ...READY, requiredServicesHealthy: false });
    expect(r.verdict).toBe("BLOCKED");
    expect(r.blocker).toBe("services_unhealthy");
  });

  it("BLOCKED when there is no build artifact to test", () => {
    const r = verificationPreflight({ ...READY, buildArtifactPresent: false });
    expect(r.verdict).toBe("BLOCKED");
    expect(r.blocker).toBe("no_build_artifact");
  });

  it("install health is checked before services and artifact (most fundamental blocker first)", () => {
    const r = verificationPreflight({
      ...READY,
      installHealthy: false,
      requiredServicesHealthy: false,
      buildArtifactPresent: false,
    });
    expect(r.blocker).toBe("install_unhealthy");
  });
});

describe("preflightDirective", () => {
  it("tells the agent NOT to re-run on MUST_ADVANCE", () => {
    const d = preflightDirective(verificationPreflight({ ...READY, acceptanceAlreadyMet: true }));
    expect(d).toContain("MUST_ADVANCE");
    expect(d).toContain("Do not re-run");
  });

  it("tells the agent NOT to fake a result on BLOCKED", () => {
    const d = preflightDirective(verificationPreflight({ ...READY, installHealthy: false }));
    expect(d).toContain("BLOCKED");
    expect(d).toContain("Report this blocker");
  });

  it("greenlights testing on CAN_TEST", () => {
    const d = preflightDirective(verificationPreflight(READY));
    expect(d).toContain("CAN_TEST");
  });
});
