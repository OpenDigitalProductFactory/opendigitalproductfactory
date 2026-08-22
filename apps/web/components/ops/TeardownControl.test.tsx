import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/teardown", () => ({
  previewInstallationTeardown: vi.fn(),
  executeInstallationTeardown: vi.fn(),
}));

import { TeardownControl } from "./TeardownControl";

describe("governed teardown control", () => {
  it("shows four plain-language scopes and makes retained recovery explicit", () => {
    const html = renderToStaticMarkup(<TeardownControl initialEvidence={[]} />);
    expect(html).toContain("Stop services");
    expect(html).toContain("Reset data");
    expect(html).toContain("Remove source");
    expect(html).toContain("Remove installation");
    expect(html).toContain("Recovery archive");
    expect(html).toContain("Always retained");
    expect(html).toContain("data-dpf-primary-action");
  });

  it("uses a pointer-hold confirmation rather than a typed phrase", () => {
    const html = renderToStaticMarkup(<TeardownControl initialEvidence={[]} />);
    expect(html).toContain("Press and hold");
    expect(html).toContain("Release to cancel");
    expect(html).not.toContain("Type &quot;");
    expect(html).not.toMatch(/<input[^>]+confirm/i);
  });

  it("renders post-database evidence from the external journal", () => {
    const html = renderToStaticMarkup(<TeardownControl initialEvidence={[{
      runId: "TDR-OLD12345",
      scope: "everything",
      status: "completed",
      stage: "completed",
      startedAt: "2026-08-21T10:00:00.000Z",
      completedAt: "2026-08-21T10:01:00.000Z",
    }]} />);
    expect(html).toContain("TDR-OLD12345");
    expect(html).toContain("completed");
    expect(html).toContain("Recovered from external evidence");
  });
});
