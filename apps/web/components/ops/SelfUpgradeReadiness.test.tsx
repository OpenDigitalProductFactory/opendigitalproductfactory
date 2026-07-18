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
});
