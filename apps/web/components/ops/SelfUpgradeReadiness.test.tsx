import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SelfUpgradeReadiness } from "./SelfUpgradeReadiness";

describe("SelfUpgradeReadiness", () => {
  it("shows actionable portal-owned failure evidence", () => {
    const html = renderToStaticMarkup(<SelfUpgradeReadiness completionEvidence={{ readiness: {
      stage: "preflight", owner: "portal", mode: "enforced", result: "failed",
      contractVersion: 1, contractDigest: `sha256:${"a".repeat(64)}`,
      failures: [{ code: "state_mount_unreadable", message: "State mount is not readable", remediation: "Repair the lifecycle state mount" }],
    } }} />);
    expect(html).toContain("Pre-drain readiness: failed");
    expect(html).toContain("Validation owner: portal");
    expect(html).toContain("contract v1");
    expect(html).toContain("Repair the lifecycle state mount");
  });

  it("discloses legacy bootstrap as unavailable", () => {
    const html = renderToStaticMarkup(<SelfUpgradeReadiness completionEvidence={{ readiness: {
      stage: "preflight", owner: "unavailable", mode: "legacy-bootstrap", result: "unavailable", failures: [],
    } }} />);
    expect(html).toContain("Legacy bootstrap — pre-drain readiness was unavailable");
    expect(html).toContain("Validation owner: unavailable");
    expect(html).not.toContain("Pre-drain readiness: ready");
  });

  // BI-DB87D925: a required service step 7d could not create used to leave no trace.
  const reconcile = (outcome: "degraded" | "complete") => ({
    targetSha: "def5678",
    at: "2026-10-02T17:00:55.000Z",
    outcome,
    required: ["portal", "prometheus", "dpf-tts"],
    created: ["prometheus"],
    failed: outcome === "degraded" ? ["dpf-tts"] : [],
  });

  it("marks a run degraded and names the services that could not be started", () => {
    const html = renderToStaticMarkup(
      <SelfUpgradeReadiness completionEvidence={{ serviceReconcile: reconcile("degraded") }} />,
    );
    expect(html).toContain('data-service-reconcile="degraded"');
    expect(html).toContain("Degraded — 1 required service could not be started");
    expect(html).toContain("Not running: dpf-tts.");
    expect(html).toContain("Started this time: prometheus.");
  });

  it("shows the degraded notice alongside readiness evidence, and nothing when the reconcile completed", () => {
    const readiness = { stage: "preflight", owner: "portal", mode: "enforced", result: "ready", failures: [] };
    const degraded = renderToStaticMarkup(
      <SelfUpgradeReadiness completionEvidence={{ readiness, serviceReconcile: reconcile("degraded") }} />,
    );
    expect(degraded).toContain('data-service-reconcile="degraded"');
    expect(degraded).toContain("Pre-drain readiness: ready");
    const complete = renderToStaticMarkup(
      <SelfUpgradeReadiness completionEvidence={{ readiness, serviceReconcile: reconcile("complete") }} />,
    );
    expect(complete).not.toContain("data-service-reconcile");
  });
});
