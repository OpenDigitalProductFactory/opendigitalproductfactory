import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/capability-activation", () => ({
  updateCapabilityActivation: vi.fn(),
}));

import { CapabilityActivationToggle } from "./CapabilityActivationToggle";

describe("CapabilityActivationToggle", () => {
  it("renders an on switch when active", () => {
    const html = renderToStaticMarkup(
      <CapabilityActivationToggle capabilityKey="partner-program" active />,
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
  });

  it("renders an off switch when inactive", () => {
    const html = renderToStaticMarkup(
      <CapabilityActivationToggle capabilityKey="partner-program" active={false} />,
    );
    expect(html).toContain('aria-checked="false"');
  });
});
