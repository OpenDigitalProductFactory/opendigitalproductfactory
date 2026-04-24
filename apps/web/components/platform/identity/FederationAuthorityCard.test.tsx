import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FederationAuthorityCard } from "./FederationAuthorityCard";

describe("FederationAuthorityCard", () => {
  it("renders Microsoft Entra as an upstream authority with setup guidance", () => {
    const html = renderToStaticMarkup(
      <FederationAuthorityCard
        title="Microsoft Entra"
        badge="Upstream authority"
        description="Bootstrap workforce identity from Microsoft Entra while keeping DPF as the authorization source of truth."
        status="unconfigured"
        ownershipLabel="Entra owns sign-in and directory bootstrap"
        dpfAuthorityLabel="DPF owns route access, coworker authority, and local groups"
        href="/platform/identity/federation#entra"
      />,
    );

    expect(html).toContain("Microsoft Entra");
    expect(html).toContain("Upstream authority");
    expect(html).toContain("Entra owns sign-in and directory bootstrap");
    expect(html).toContain("DPF owns route access, coworker authority, and local groups");
  });
});
