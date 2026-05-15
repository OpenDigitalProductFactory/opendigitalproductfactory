import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmployeeReachabilityPanel } from "./EmployeeReachabilityPanel";

describe("EmployeeReachabilityPanel", () => {
  it("renders verified and pending channel bindings", () => {
    const html = renderToStaticMarkup(
      <EmployeeReachabilityPanel
        bindings={[
          {
            channel: "teams",
            label: "Microsoft Teams",
            status: "verified",
            lastTestedAt: "2026-05-15T10:00:00.000Z",
            allowedUrgencies: ["priority", "urgent"],
          },
          {
            channel: "whatsapp",
            label: "WhatsApp Business",
            status: "pending",
            lastTestedAt: null,
            allowedUrgencies: ["urgent"],
          },
        ]}
      />,
    );

    expect(html).toContain("Reachability");
    expect(html).toContain("Microsoft Teams");
    expect(html).toContain("verified");
    expect(html).toContain("priority");
    expect(html).toContain("WhatsApp Business");
    expect(html).toContain("pending");
    expect(html).toContain("Not tested");
  });

  it("renders an empty state", () => {
    const html = renderToStaticMarkup(<EmployeeReachabilityPanel bindings={[]} />);

    expect(html).toContain("No employee channels are configured yet.");
  });
});
