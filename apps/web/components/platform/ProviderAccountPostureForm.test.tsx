import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/provider-connection-posture", () => ({
  updateProviderConnectionPosture: vi.fn(),
}));

import { ProviderAccountPostureForm } from "./ProviderAccountPostureForm";

describe("ProviderAccountPostureForm", () => {
  it("explains and exposes connection-scoped OpenRouter bounds", () => {
    const html = renderToStaticMarkup(
      <ProviderAccountPostureForm
        providerId="openrouter"
        canWrite
        initial={{
          accountClass: "enterprise",
          noTraining: true,
          enabledRegions: ["eu"],
          zeroRetention: true,
          regionalProcessing: true,
          approvedUnderlyingProviderSlugs: ["anthropic"],
        }}
      />,
    );
    expect(html).toContain("Bound the router before company data is used");
    expect(html).toContain("do not prove an enterprise contract or EU entitlement");
    expect(html).toContain("Zero Data Retention enabled");
    expect(html).toContain("Approved underlying providers");
    expect(html).toContain("anthropic");
  });

  it("does not burden direct-provider setup with router-only controls", () => {
    const html = renderToStaticMarkup(
      <ProviderAccountPostureForm providerId="anthropic" canWrite initial={null} requiredRegions={[]} />,
    );
    expect(html).not.toContain("Bound the router before company data is used");
    expect(html).not.toContain("Enabled processing regions");
    expect(html).not.toContain("processing in US");
  });

  it("asks about the required region without asking the operator to invent region codes", () => {
    const html = renderToStaticMarkup(
      <ProviderAccountPostureForm providerId="anthropic" canWrite initial={null} requiredRegions={["us"]} />,
    );
    expect(html).toContain("Can this connected account guarantee processing in US?");
    expect(html).not.toContain("Example: eu, uk");
    expect(html).not.toContain('type="text"');
  });
});
